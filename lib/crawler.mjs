// Crawler for Amazon deals listed on mydealz.de.
// Plain ESM so it runs both inside Next.js (server) and as a standalone Node script (scripts/push.mjs).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MD = "https://www.mydealz.de";
const AMAZON_MERCHANT_ID = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, { redirect = "follow" } = {}) {
  return fetch(url, {
    redirect,
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    },
  });
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function mdImage(img) {
  if (!img?.path || !img?.name) return null;
  return `https://static.mydealz.de/${img.path}/${img.name}/re/300x300/qt/60/${img.name}.jpg`;
}

/** Parse the deal cards embedded as JSON in data-vue3 attributes. */
export function parseListHtml(html) {
  const deals = [];
  for (const m of html.matchAll(/data-vue3='([^']*)'/g)) {
    let data;
    try {
      data = JSON.parse(decodeEntities(m[1]));
    } catch {
      continue;
    }
    const t = data?.props?.thread;
    if (!t?.threadId || t.merchant?.merchantId !== AMAZON_MERCHANT_ID) continue;
    deals.push({
      threadId: Number(t.threadId),
      mdTitle: t.title,
      slug: t.titleSlug || null,
      price: typeof t.price === "number" ? t.price : null,
      oldPrice: typeof t.nextBestPrice === "number" && t.nextBestPrice > 0 ? t.nextBestPrice : null,
      percentage: t.percentage || null,
      temperature: typeof t.temperature === "number" ? Math.round(t.temperature) : 0,
      publishedAt: t.publishedAt || null,
      hotDate: t.hotDate || null,
      isExpired: t.isExpired ? 1 : 0,
      commentCount: t.commentCount || 0,
      voucherCode: t.voucherCode || null,
      mdImage: mdImage(t.mainImage),
    });
  }
  return deals;
}

export async function fetchListPage(page) {
  const res = await get(`${MD}/search/deals?merchant-id=${AMAZON_MERCHANT_ID}&page=${page}`);
  if (!res.ok) throw new Error(`mydealz list page ${page}: HTTP ${res.status}`);
  return parseListHtml(await res.text());
}

const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/exec\/obidos\/asin\/)([A-Z0-9]{10})(?![A-Z0-9])/;

/** Follow mydealz's outbound redirect (without visiting Amazon) until an ASIN appears. */
export async function resolveAsin(threadId) {
  let url = `${MD}/visit/threadmain/${threadId}`;
  for (let hop = 0; hop < 4; hop++) {
    const res = await get(url, { redirect: "manual" });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const loc = res.headers.get("location");
    if (!loc) return null;
    let decoded = loc;
    try {
      decoded = decodeURIComponent(decodeURIComponent(loc));
    } catch {}
    const m = decoded.match(ASIN_RE);
    if (m) return m[1];
    if (/amazon\.[a-z.]+\/s[?/]/.test(decoded)) return null; // search/listing link, no single product
    url = new URL(loc, url).toString();
    if (/amazon\./.test(new URL(url).hostname)) return null;
  }
  return null;
}

/** Title + main image from the Amazon product page. Returns null when blocked (captcha). */
export async function fetchAmazon(asin) {
  const res = await get(`https://www.amazon.de/dp/${asin}`);
  if (!res.ok) return null;
  const html = await res.text();
  const t = html.match(/id="productTitle"[^>]*>\s*([^<]+?)\s*</);
  if (!t) return null;
  const img =
    html.match(/"hiRes":"(https:[^"]+)"/)?.[1] ||
    html.match(/data-old-hires="(https:[^"]+)"/)?.[1] ||
    html.match(/"large":"(https:[^"]+)"/)?.[1] ||
    null;
  return { title: decodeEntities(t[1]), image: img };
}

/**
 * Crawl the newest Amazon deals.
 * @param {{pages?: number, maxAgeDays?: number, known?: Map<number, {asin: string|null, noAsin?: boolean, hasAmz: boolean}>, log?: (m: string) => void}} opts
 */
export async function crawl({ pages = 3, maxAgeDays = 2, known = new Map(), log = console.log } = {}) {
  const cutoff = maxAgeDays > 0 ? Math.floor(Date.now() / 1000) - maxAgeDays * 86400 : 0;
  const deals = [];
  const seen = new Set();
  let fetchedPages = 0;
  let skippedOld = 0;

  for (let p = 1; p <= pages; p++) {
    const list = await fetchListPage(p);
    fetchedPages++;
    if (list.length === 0) break;
    let keptOnPage = 0;
    for (const d of list) {
      if (seen.has(d.threadId)) continue;
      seen.add(d.threadId);
      if (cutoff && d.publishedAt && d.publishedAt < cutoff) {
        skippedOld++;
        continue;
      }
      deals.push(d);
      keptOnPage++;
    }
    if (cutoff && keptOnPage === 0) break;
    if (p < pages) await sleep(1500);
  }
  log(
    `list: ${deals.length} Amazon deals from ${fetchedPages} page(s)` +
      (skippedOld ? ` (skipped ${skippedOld} older than ${maxAgeDays}d)` : ""),
  );

  let resolved = 0, enriched = 0;
  for (const d of deals) {
    const k = known.get(d.threadId);
    d.asin = k?.asin ?? null;
    if (!d.asin && !k?.noAsin) {
      try {
        d.asin = await resolveAsin(d.threadId);
        if (!d.asin) d.noAsin = true;
        resolved++;
      } catch (e) {
        log(`asin ${d.threadId}: ${e.message}`);
      }
      await sleep(1000);
    }
    if (d.asin && !k?.hasAmz) {
      try {
        const a = await fetchAmazon(d.asin);
        if (a) (d.amzTitle = a.title), (d.amzImage = a.image), enriched++;
      } catch (e) {
        log(`amazon ${d.asin}: ${e.message}`);
      }
      await sleep(1500);
    }
  }
  log(`resolved ${resolved} ASIN(s), enriched ${enriched} from Amazon`);
  return deals;
}
