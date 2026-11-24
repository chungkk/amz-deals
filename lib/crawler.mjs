// Crawler for Amazon deals listed on mydealz.de and mein-deal.com.
// Plain ESM so it runs both inside Next.js (server) and as a standalone Node script (scripts/push.mjs).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MD = "https://www.mydealz.de";
const AMAZON_MERCHANT_ID = 3;
const MEINDEAL = "https://www.mein-deal.com";
const MEINDEAL_AMAZON_TAG_ID = 43684;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, { redirect = "follow", accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } = {}) {
  return fetch(url, {
    redirect,
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": UA,
      accept,
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

/** Parse the deal cards embedded as JSON in data-vue3 attributes (mydealz.de). */
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
    const threadId = Number(t.threadId);
    const slug = t.titleSlug || null;
    deals.push({
      threadId,
      source: "mydealz",
      sourceUrl: `${MD}/deals/${slug ? slug + "-" : ""}${threadId}`,
      mdTitle: t.title,
      slug,
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

function parseGermanNumber(s) {
  const cleaned = s.replace(/\.(?=\d{3}(?:,|$))/g, "").replace(",", ".");
  const num = Number(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function parseMeinDealPrices(title) {
  const oldMatch = title.match(/(?:statt|uvp|pvg|sonst(?:\s+mindestens)?)\s*(?:ab\s*)?([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)\s*€/i);
  const curMatch = title.match(/(?:für|ab|nur)\s*([0-9]+(?:\.[0-9]{3})*(?:,[0-9]{1,2})?)\s*€/i);
  const price = curMatch ? parseGermanNumber(curMatch[1]) : null;
  const oldPrice = oldMatch ? parseGermanNumber(oldMatch[1]) : null;
  const percentage = price != null && oldPrice != null && oldPrice > price ? Math.round(100 * (1 - price / oldPrice)) : null;
  return { price, oldPrice, percentage };
}

function extractMeinDealOutUrl(html) {
  const direct = html.match(/https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"'<> ]+/i);
  if (direct) return direct[0];
  const out = html.match(/https?:\/\/(?:www\.)?mein-deal\.com\/out\/[^"'<> ]+/i);
  return out ? out[0] : null;
}

function extractMeinDealVoucher(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const m = text.match(/(?:Gutscheincode|Rabattcode|Aktionscode)\s*[:„"]?\s*([A-Z0-9-]{4,20})\b/);
  return m ? m[1] : null;
}

/** Fetch Amazon-tagged posts from mein-deal.com WordPress REST API. */
export async function fetchMeinDealPage(page, perPage = 30) {
  const url = `${MEINDEAL}/wp-json/wp/v2/posts?tags=${MEINDEAL_AMAZON_TAG_ID}&per_page=${perPage}&page=${page}&_embed=wp:featuredmedia`;
  const res = await get(url, { accept: "application/json" });
  if (res.status === 400) return []; // WordPress rest_post_invalid_page_number
  if (!res.ok) throw new Error(`mein-deal page ${page}: HTTP ${res.status}`);
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];

  const deals = [];
  for (const p of posts) {
    const id = Number(p?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const title = decodeEntities(String(p.title?.rendered || "")).trim();
    if (!title) continue;
    const html = String(p.content?.rendered || "");
    const { price, oldPrice, percentage } = parseMeinDealPrices(title);
    const publishedMs = p.date_gmt ? Date.parse(`${p.date_gmt}Z`) : p.date ? Date.parse(p.date) : NaN;
    const publishedAt = Number.isFinite(publishedMs) ? Math.floor(publishedMs / 1000) : null;
    const rawImg = p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null;
    const mdImg = rawImg ? rawImg.replace(/(\/wp-content\/uploads)\/+/g, "$1/") : null;

    deals.push({
      threadId: -id, // Negative ID prevents any collision with positive mydealz threadId
      source: "meindeal",
      sourceUrl: p.link || `${MEINDEAL}/?p=${id}`,
      mdTitle: title,
      slug: p.slug || null,
      price,
      oldPrice,
      percentage,
      temperature: 0,
      publishedAt,
      hotDate: null,
      isExpired: 0,
      commentCount: 0,
      voucherCode: extractMeinDealVoucher(html),
      mdImage: mdImg,
      _outUrl: extractMeinDealOutUrl(html),
    });
  }
  return deals;
}

const ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/exec\/obidos\/asin\/)([A-Z0-9]{10})(?![A-Z0-9])/;

/** Follow an outbound redirect chain (without loading Amazon pages) until an ASIN appears. */
export async function resolveUrlAsin(startUrl) {
  if (!startUrl) return null;
  const directMatch = startUrl.match(ASIN_RE);
  if (directMatch) return directMatch[1];

  let url = startUrl;
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

/** Follow mydealz's outbound redirect until an ASIN appears. */
export function resolveAsin(threadId) {
  return resolveUrlAsin(`${MD}/visit/threadmain/${threadId}`);
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

async function collectSource(name, pages, cutoff, fetchPage, seen, log) {
  const collected = [];
  let fetchedPages = 0;
  let skippedOld = 0;
  for (let p = 1; p <= pages; p++) {
    const list = await fetchPage(p);
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
      collected.push(d);
      keptOnPage++;
    }
    if (cutoff && keptOnPage === 0) break;
    if (p < pages) await sleep(1200);
  }
  log(
    `${name}: ${collected.length} Amazon deals from ${fetchedPages} page(s)` +
      (skippedOld ? ` (skipped ${skippedOld} old)` : ""),
  );
  return collected;
}

/**
 * Crawl the newest Amazon deals from enabled sources.
 * @param {{pages?: number, maxAgeDays?: number, sources?: string[], known?: Map<number, {asin: string|null, noAsin?: boolean, hasAmz: boolean}>, log?: (m: string) => void}} opts
 */
export async function crawl({
  pages = 3,
  maxAgeDays = 2,
  sources = ["mydealz", "meindeal"],
  known = new Map(),
  log = console.log,
} = {}) {
  const cutoff = maxAgeDays > 0 ? Math.floor(Date.now() / 1000) - maxAgeDays * 86400 : 0;
  const deals = [];
  const seen = new Set();
  const errors = [];

  if (sources.includes("mydealz")) {
    try {
      deals.push(...(await collectSource("mydealz", pages, cutoff, fetchListPage, seen, log)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`mydealz: ${msg}`);
      log(`mydealz error: ${msg}`);
    }
  }

  if (sources.includes("meindeal")) {
    try {
      deals.push(...(await collectSource("meindeal", pages, cutoff, (p) => fetchMeinDealPage(p, 30), seen, log)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`meindeal: ${msg}`);
      log(`meindeal error: ${msg}`);
    }
  }

  if (deals.length === 0 && errors.length > 0 && errors.length >= sources.length) {
    throw new Error(errors.join(" | "));
  }

  let resolved = 0, enriched = 0;
  for (const d of deals) {
    const k = known.get(d.threadId);
    d.asin = k?.asin ?? null;
    if (!d.asin && !k?.noAsin) {
      try {
        d.asin = d.source === "meindeal" ? await resolveUrlAsin(d._outUrl) : await resolveAsin(d.threadId);
        if (!d.asin) d.noAsin = true;
        resolved++;
      } catch (e) {
        log(`asin ${d.source}#${Math.abs(d.threadId)}: ${e.message}`);
      }
      await sleep(800);
    }
    if (d.asin && !k?.hasAmz) {
      try {
        const a = await fetchAmazon(d.asin);
        if (a) (d.amzTitle = a.title), (d.amzImage = a.image), enriched++;
      } catch (e) {
        log(`amazon ${d.asin}: ${e.message}`);
      }
      await sleep(1200);
    }
    delete d._outUrl;
  }
  log(`resolved ${resolved} ASIN(s), enriched ${enriched} from Amazon`);
  return deals;
}
