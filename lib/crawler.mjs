// Crawler for German Amazon deals: mydealz.de (+ Preisfehler), mein-deal.com, monsterdealz.de,
// dealdoktor.de, de.camelcamelcamel.com RSS, Amazon PA-API 5.0, and optional Keepa API.
// Plain ESM so it runs both inside Next.js (server) and as a standalone Node script (scripts/push.mjs).

import { getItemsByAsin, hasPaApiCreds, searchDealsPaApi } from "./paapi.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const MD = "https://www.mydealz.de";
const AMAZON_MERCHANT_ID = 3;
const MEINDEAL = "https://www.mein-deal.com";
const MEINDEAL_AMAZON_TAG_ID = 43684;
const MONSTERDEALZ = "https://www.monsterdealz.de";
const MONSTERDEALZ_AMAZON_TAG_ID = 56;
const DEALDOKTOR = "https://www.dealdoktor.de";
const CAMEL_FEEDS = [
  "https://de.camelcamelcamel.com/top_drops/feed?t=relative&i=1&s=relative",
  "https://de.camelcamelcamel.com/top_drops/feed?t=absolute&i=1&s=absolute",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const count = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: count }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await worker(items[i], i);
      }
    }),
  );
}

function get(
  url,
  { redirect = "follow", accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", timeoutMs = 20000 } = {},
) {
  return fetch(url, {
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "user-agent": UA,
      accept,
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
    },
  });
}

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asinHash(asin) {
  let h = 2166136261;
  const s = String(asin || "").toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 90_000_000) + 1;
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
    const title = String(t.title || "");
    deals.push({
      threadId,
      source: "mydealz",
      sourceUrl: `${MD}/deals/${slug ? slug + "-" : ""}${threadId}`,
      mdTitle: title,
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
      isPriceError: /preisfehler|fehlerpreis/i.test(title),
    });
  }
  return deals;
}

export async function fetchListPage(page) {
  const res = await get(`${MD}/search/deals?merchant-id=${AMAZON_MERCHANT_ID}&page=${page}`);
  if (!res.ok) throw new Error(`mydealz list page ${page}: HTTP ${res.status}`);
  return parseListHtml(await res.text());
}

/** Fetch mydealz.de Preisfehler (price error) group and keep only Amazon deals. */
export async function fetchMydealzPreisfehler() {
  const res = await get(`${MD}/gruppe/preisfehler`);
  if (!res.ok) throw new Error(`mydealz preisfehler: HTTP ${res.status}`);
  return parseListHtml(await res.text()).map((d) => ({ ...d, isPriceError: true }));
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

function extractOutUrl(html, outPattern) {
  const direct = html.match(/https?:\/\/(?:www\.)?amazon\.[a-z.]+\/[^"'<> ]+/i);
  if (direct) return direct[0];
  const out = html.match(outPattern);
  return out ? out[0] : null;
}

function extractGermanVoucher(html) {
  const text = html.replace(/<[^>]+>/g, " ");
  const m = text.match(/(?:Gutscheincode|Rabattcode|Aktionscode|Code)\s*[:„"]?\s*([A-Z0-9-]{4,20})\b/);
  return m ? m[1] : null;
}

function parseWpPosts(posts, { source, baseUrl, outPattern, threadIdOffset, requireAmazon = false }) {
  const deals = [];
  for (const p of posts) {
    const id = Number(p?.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const title = decodeEntities(String(p.title?.rendered || "")).trim();
    if (!title) continue;
    const html = String(p.content?.rendered || "");
    const outUrl = extractOutUrl(html, outPattern);
    if (requireAmazon && !outUrl) continue;

    const { price, oldPrice, percentage } = parseMeinDealPrices(title);
    const publishedMs = p.date_gmt ? Date.parse(`${p.date_gmt}Z`) : p.date ? Date.parse(p.date) : NaN;
    const publishedAt = Number.isFinite(publishedMs) ? Math.floor(publishedMs / 1000) : null;
    const rawImg = p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null;
    const mdImg = rawImg ? rawImg.replace(/(\/wp-content\/uploads)\/+/g, "$1/") : null;

    deals.push({
      threadId: -(threadIdOffset + id),
      source,
      sourceUrl: p.link || `${baseUrl}/?p=${id}`,
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
      voucherCode: extractGermanVoucher(html),
      mdImage: mdImg,
      isPriceError: /preisfehler|fehlerpreis/i.test(title),
      _outUrl: outUrl,
      _requireAmazon: requireAmazon,
    });
  }
  return deals;
}

/** Fetch Amazon-tagged posts from mein-deal.com WordPress REST API. */
export async function fetchMeinDealPage(page, perPage = 30) {
  const url = `${MEINDEAL}/wp-json/wp/v2/posts?tags=${MEINDEAL_AMAZON_TAG_ID}&per_page=${perPage}&page=${page}&_embed=wp:featuredmedia`;
  const res = await get(url, { accept: "application/json" });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`mein-deal page ${page}: HTTP ${res.status}`);
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];
  return parseWpPosts(posts, {
    source: "meindeal",
    baseUrl: MEINDEAL,
    outPattern: /https?:\/\/(?:www\.)?mein-deal\.com\/out\/[^"'<> ]+/i,
    threadIdOffset: 0,
  });
}

/** Fetch Amazon-tagged posts from monsterdealz.de WordPress REST API. */
export async function fetchMonsterDealzPage(page, perPage = 30) {
  const url = `${MONSTERDEALZ}/wp-json/wp/v2/posts?tags=${MONSTERDEALZ_AMAZON_TAG_ID}&per_page=${perPage}&page=${page}&_embed=wp:featuredmedia`;
  const res = await get(url, { accept: "application/json" });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`monsterdealz page ${page}: HTTP ${res.status}`);
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];
  return parseWpPosts(posts, {
    source: "monsterdealz",
    baseUrl: MONSTERDEALZ,
    outPattern: /https?:\/\/(?:www\.)?monsterdealz\.de\/goto\/deal\/\d+\/?/i,
    threadIdOffset: 100_000_000,
    requireAmazon: true,
  });
}

/** Fetch Amazon-matching posts from dealdoktor.de WordPress REST API. */
export async function fetchDealDoktorPage(page, perPage = 30) {
  const url = `${DEALDOKTOR}/wp-json/wp/v2/posts?search=amazon&orderby=date&order=desc&per_page=${perPage}&page=${page}&_embed=wp:featuredmedia`;
  const res = await get(url, { accept: "application/json" });
  if (res.status === 400) return [];
  if (!res.ok) throw new Error(`dealdoktor page ${page}: HTTP ${res.status}`);
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];
  return parseWpPosts(posts, {
    source: "dealdoktor",
    baseUrl: DEALDOKTOR,
    outPattern: /https?:\/\/(?:www\.)?dealdoktor\.de\/goto\/deal\/\d+\/?/i,
    threadIdOffset: 200_000_000,
    requireAmazon: true,
  });
}

/** Fetch Top Price Drops for Amazon.de from de.camelcamelcamel.com RSS. */
export async function fetchCamelDrops(pages = 1) {
  const feeds = pages >= 2 ? CAMEL_FEEDS : CAMEL_FEEDS.slice(0, 1);
  const deals = [];
  const seenAsin = new Set();

  for (let i = 0; i < feeds.length; i++) {
    if (i > 0) await sleep(2500);
    const res = await get(feeds[i], { accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8" });
    if (!res.ok) throw new Error(`camel feed ${i + 1}: HTTP ${res.status}`);
    const xml = await res.text();

    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const itemXml = m[1];
      const link = decodeEntities((itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "").trim());
      // Extract ASIN strictly from <link> (never from <description>'s obfuscated /go link)
      const asinMatch = link.match(/\/product\/([A-Z0-9]{10})(?:$|[?#])/);
      if (!asinMatch) continue;
      const asin = asinMatch[1].toUpperCase();
      if (seenAsin.has(asin)) continue;
      seenAsin.add(asin);

      const rawTitle = decodeEntities((itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").trim());
      if (!rawTitle) continue;
      const tm = rawTitle.match(/^(.*?)\s*-\s*down\s+([0-9.]+)%\s*\([^)]+\)\s*to\s*([0-9.,]+)\s*€\s*from\s*([0-9.,]+)\s*€/i);
      const mdTitle = tm ? tm[1].trim() : rawTitle;
      const percentage = tm ? Math.round(Number(tm[2])) : null;
      const price = tm ? parseGermanNumber(tm[3]) : null;
      const oldPrice = tm ? parseGermanNumber(tm[4]) : null;

      const pubRaw = (itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "").trim();
      const pubMs = pubRaw ? Date.parse(pubRaw) : NaN;
      const publishedAt = Number.isFinite(pubMs) ? Math.floor(pubMs / 1000) : Math.floor(Date.now() / 1000);

      deals.push({
        threadId: -(300_000_000 + asinHash(asin)),
        source: "camel",
        sourceUrl: link,
        asin,
        mdTitle,
        slug: null,
        price,
        oldPrice,
        percentage,
        temperature: 0,
        publishedAt,
        hotDate: null,
        isExpired: 0,
        commentCount: 0,
        voucherCode: null,
        mdImage: null,
        isPriceError: percentage != null && percentage >= 50,
      });
    }
  }
  return deals;
}

/** Search discounted products on Amazon.de using PA-API 5.0 SearchItems. */
export async function fetchPaApiDeals({ keywords = "", minSavingPercent = 30, paapiCreds, log = console.log }) {
  if (!hasPaApiCreds(paapiCreds)) return [];
  const terms = String(keywords)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);
  const deals = [];
  const seenAsin = new Set();

  for (let i = 0; i < terms.length; i++) {
    try {
      const items = await searchDealsPaApi(
        { keywords: terms[i], minSavingPercent, minReviewsRating: 4, itemCount: 10 },
        paapiCreds,
      );
      for (const item of items) {
        if (!item.asin || !item.title || !item.inStock || seenAsin.has(item.asin)) continue;
        seenAsin.add(item.asin);
        deals.push({
          threadId: -(400_000_000 + asinHash(item.asin)),
          source: "paapi",
          sourceUrl: `https://www.amazon.de/dp/${item.asin}`,
          asin: item.asin,
          amzTitle: item.title,
          amzImage: item.image,
          mdTitle: item.title,
          brand: item.brand,
          price: item.price,
          oldPrice: item.oldPrice,
          percentage: item.percentage,
          publishedAt: now,
          isExpired: 0,
          isPriceError: item.percentage != null && item.percentage >= 55,
        });
      }
    } catch (e) {
      log(`paapi search "${terms[i]}": ${e instanceof Error ? e.message : String(e)}`);
    }
    if (i + 1 < terms.length) await sleep(1200);
  }
  log(`paapi: ${deals.length} deals from ${terms.length} keyword(s)`);
  return deals;
}

/** Optional Keepa API /deal integration (domainId = 3 for amazon.de). */
export async function fetchKeepaDeals({ apiKey, minDropPct = 40, pages = 1, log = console.log }) {
  if (!apiKey || !String(apiKey).trim()) return [];
  const maxPages = Math.max(1, Math.min(2, Number(pages) || 1));
  const now = Math.floor(Date.now() / 1000);
  const deals = [];
  const seenAsin = new Set();

  for (let p = 0; p < maxPages; p++) {
    const selection = {
      page: p,
      domainId: 3,
      priceTypes: [0],
      dateRange: 0,
      deltaPercentRange: [Math.max(10, Math.min(95, Number(minDropPct) || 40)), 99],
      currentRange: [300, 100000],
      minRating: 40,
      hasReviews: true,
      isRangeEnabled: true,
      sortType: 4,
    };
    const res = await fetch(`https://api.keepa.com/deal?key=${encodeURIComponent(apiKey.trim())}`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify(selection),
    });
    if (!res.ok) throw new Error(`keepa page ${p}: HTTP ${res.status}`);
    const data = await res.json();
    const dr = data?.deals?.dr;
    if (!Array.isArray(dr) || dr.length === 0) break;

    for (const item of dr) {
      const asin = typeof item?.asin === "string" ? item.asin.trim().toUpperCase() : "";
      if (!/^[A-Z0-9]{10}$/.test(asin) || seenAsin.has(asin)) continue;
      seenAsin.add(asin);

      const rawCur = Array.isArray(item.current) ? Number(item.current[0]) : NaN;
      const price = Number.isFinite(rawCur) && rawCur > 0 ? Math.round(rawCur) / 100 : null;
      const rawPct = Array.isArray(item.deltaPercent)
        ? Number(Array.isArray(item.deltaPercent[0]) ? item.deltaPercent[0][0] : item.deltaPercent[0])
        : NaN;
      const percentage = Number.isFinite(rawPct) && rawPct > 0 ? Math.round(rawPct) : null;
      const rawAvg = Array.isArray(item.avg)
        ? Number(Array.isArray(item.avg[0]) ? item.avg[0][0] : item.avg[0])
        : NaN;
      const oldPrice = Number.isFinite(rawAvg) && rawAvg > 0 ? Math.round(rawAvg) / 100 : null;
      const title = String(item.title || `Amazon Deal ${asin}`).trim();

      deals.push({
        threadId: -(500_000_000 + asinHash(asin)),
        source: "keepa",
        sourceUrl: `https://www.amazon.de/dp/${asin}`,
        asin,
        mdTitle: title,
        price,
        oldPrice,
        percentage,
        publishedAt: now,
        isExpired: 0,
        isPriceError: percentage != null && percentage >= 55,
        isLowest: Boolean(item.isLowest),
      });
    }
    if (dr.length < 150) break;
  }
  log(`keepa: ${deals.length} deals`);
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
    const res = await get(url, { redirect: "manual", timeoutMs: 10000 });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    const loc = res.headers.get("location");
    if (!loc) return null;
    let decoded = loc;
    try {
      decoded = decodeURIComponent(decodeURIComponent(loc));
    } catch {}
    const m = decoded.match(ASIN_RE);
    if (m) return m[1];
    if (/amazon\.[a-z.]+\/s[?/]/.test(decoded)) return null;
    url = new URL(loc, url).toString();
    if (/amazon\./.test(new URL(url).hostname)) return null;
  }
  return null;
}

/** Follow mydealz's outbound redirect until an ASIN appears. */
export function resolveAsin(threadId) {
  return resolveUrlAsin(`${MD}/visit/threadmain/${threadId}`);
}

function resolveDealAsin(d) {
  if (d.source === "mydealz") return resolveAsin(d.threadId);
  if (d._outUrl) return resolveUrlAsin(d._outUrl);
  return Promise.resolve(null);
}

/** Title + main image from the Amazon product page. Returns null when blocked (captcha). */
export async function fetchAmazon(asin) {
  const res = await get(`https://www.amazon.de/dp/${asin}`, { timeoutMs: 10000 });
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
 * @param {{pages?: number, maxAgeDays?: number, sources?: string[], known?: Map<number, {asin: string|null, noAsin?: boolean, hasAmz: boolean}>, paapi?: {accessKey?: string, secretKey?: string, partnerTag?: string, keywords?: string, minSavingPct?: number}, keepa?: {apiKey?: string, minDropPct?: number}, skipAmzEnrich?: boolean, maxHtmlEnrich?: number, onProgress?: (m: string) => void, log?: (m: string) => void}} opts
 */
export async function crawl({
  pages = 3,
  maxAgeDays = 2,
  sources = ["mydealz", "meindeal", "monsterdealz", "dealdoktor", "camel"],
  known = new Map(),
  paapi,
  keepa,
  skipAmzEnrich = false,
  maxHtmlEnrich = 25,
  onProgress = () => {},
  log = console.log,
} = {}) {
  const cutoff = maxAgeDays > 0 ? Math.floor(Date.now() / 1000) - maxAgeDays * 86400 : 0;
  const deals = [];
  const seen = new Set();
  const errors = [];

  onProgress("Đang lấy danh sách deal từ các nguồn…");

  const runCollector = async (name, fn) => {
    try {
      const res = await fn();
      deals.push(...res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${name}: ${msg}`);
      log(`${name} error: ${msg}`);
    }
  };

  if (sources.includes("mydealz")) {
    await runCollector("mydealz", () => collectSource("mydealz", pages, cutoff, fetchListPage, seen, log));
    await runCollector("mydealz-preisfehler", async () => {
      const pf = await fetchMydealzPreisfehler();
      const added = [];
      for (const d of pf) {
        if (cutoff && d.publishedAt && d.publishedAt < cutoff) continue;
        if (seen.has(d.threadId)) {
          const existing = deals.find((x) => x.threadId === d.threadId);
          if (existing) existing.isPriceError = true;
          continue;
        }
        seen.add(d.threadId);
        added.push(d);
      }
      log(`mydealz-preisfehler: ${pf.length} Amazon error deal(s) (${added.length} new)`);
      return added;
    });
  }

  if (sources.includes("meindeal")) {
    await runCollector("meindeal", () => collectSource("meindeal", pages, cutoff, (p) => fetchMeinDealPage(p, 30), seen, log));
  }

  if (sources.includes("monsterdealz")) {
    await runCollector("monsterdealz", () =>
      collectSource("monsterdealz", pages, cutoff, (p) => fetchMonsterDealzPage(p, 30), seen, log),
    );
  }

  if (sources.includes("dealdoktor")) {
    await runCollector("dealdoktor", () =>
      collectSource("dealdoktor", pages, cutoff, (p) => fetchDealDoktorPage(p, 30), seen, log),
    );
  }

  if (sources.includes("camel")) {
    await runCollector("camel", async () => {
      const list = await fetchCamelDrops(pages);
      const kept = [];
      for (const d of list) {
        if (seen.has(d.threadId)) continue;
        seen.add(d.threadId);
        if (cutoff && d.publishedAt && d.publishedAt < cutoff) continue;
        kept.push(d);
      }
      log(`camel: ${kept.length} Amazon top drops`);
      return kept;
    });
  }

  if (sources.includes("paapi") && hasPaApiCreds(paapi)) {
    await runCollector("paapi", async () => {
      const list = await fetchPaApiDeals({
        keywords: paapi.keywords,
        minSavingPercent: paapi.minSavingPct ?? 30,
        paapiCreds: paapi,
        log,
      });
      return list.filter((d) => {
        if (seen.has(d.threadId)) return false;
        seen.add(d.threadId);
        return true;
      });
    });
  }

  if (sources.includes("keepa") && keepa?.apiKey) {
    await runCollector("keepa", async () => {
      const list = await fetchKeepaDeals({
        apiKey: keepa.apiKey,
        minDropPct: keepa.minDropPct ?? 40,
        pages,
        log,
      });
      return list.filter((d) => {
        if (seen.has(d.threadId)) return false;
        seen.add(d.threadId);
        return true;
      });
    });
  }

  if (deals.length === 0 && errors.length > 0 && errors.length >= sources.length) {
    throw new Error(errors.join(" | "));
  }

  let resolved = 0;
  const needResolve = [];
  for (const d of deals) {
    const k = known.get(d.threadId);
    if (!d.asin) d.asin = k?.asin ?? null;
    if (!d.asin && !k?.noAsin) needResolve.push(d);
  }
  let resolveDone = 0;
  if (needResolve.length > 0) {
    onProgress(`Phân giải ASIN: 0/${needResolve.length}`);
    await runPool(needResolve, 5, async (d) => {
      try {
        d.asin = await resolveDealAsin(d);
        if (!d.asin) d.noAsin = true;
        else resolved++;
      } catch (e) {
        log(`asin ${d.source}#${Math.abs(d.threadId)}: ${e instanceof Error ? e.message : String(e)}`);
      }
      resolveDone++;
      if (resolveDone % 5 === 0 || resolveDone === needResolve.length) {
        onProgress(`Phân giải ASIN: ${resolveDone}/${needResolve.length}`);
      }
      await sleep(250);
    });
  }

  // Drop posts from general deal blogs that resolved to non-Amazon merchants
  const finalDeals = deals.filter((d) => {
    const keep = !(d._requireAmazon && !d.asin);
    delete d._outUrl;
    delete d._requireAmazon;
    return keep;
  });

  let enriched = 0;
  if (!skipAmzEnrich) {
    const needEnrich = finalDeals.filter((d) => d.asin && !known.get(d.threadId)?.hasAmz && !d.amzTitle);
    if (needEnrich.length > 0 && hasPaApiCreds(paapi)) {
      onProgress(`Lấy thông tin PA-API: ${needEnrich.length} ASIN`);
      const itemsMap = await getItemsByAsin(
        needEnrich.map((d) => d.asin),
        paapi,
        { log },
      );
      for (const d of needEnrich) {
        const item = itemsMap.get(String(d.asin).toUpperCase());
        if (!item) continue;
        if (item.title) d.amzTitle = item.title;
        if (item.image) d.amzImage = item.image;
        if (item.brand) d.brand = item.brand;
        if (d.price == null && item.price != null) d.price = item.price;
        if (d.oldPrice == null && item.oldPrice != null) d.oldPrice = item.oldPrice;
        if (d.percentage == null && item.percentage != null) d.percentage = item.percentage;
        if (!item.inStock) d.isExpired = 1;
        enriched++;
      }
    } else if (needEnrich.length > 0 && maxHtmlEnrich > 0) {
      // Without PA-API, prioritize deals missing an image (e.g. camel) and newest deals, capped per run so crawls stay fast.
      const batch = [...needEnrich]
        .sort((a, b) => (a.mdImage ? 1 : 0) - (b.mdImage ? 1 : 0) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
        .slice(0, maxHtmlEnrich);
      let enrichDone = 0;
      onProgress(`Lấy ảnh/tên Amazon: 0/${batch.length}`);
      await runPool(batch, 2, async (d) => {
        try {
          const a = await fetchAmazon(d.asin);
          if (a) (d.amzTitle = a.title), (d.amzImage = a.image), enriched++;
        } catch (e) {
          log(`amazon ${d.asin}: ${e instanceof Error ? e.message : String(e)}`);
        }
        enrichDone++;
        onProgress(`Lấy ảnh/tên Amazon: ${enrichDone}/${batch.length}`);
        await sleep(500);
      });
    }
  }

  onProgress("Đang lưu vào cơ sở dữ liệu…");
  log(`resolved ${resolved} ASIN(s), enriched ${enriched} from Amazon`);
  return finalDeals;
}
