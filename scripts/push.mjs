// Crawl from this machine and push results to the deals site on the VPS.
// Usage: DEALS_URL=https://deals.halle.biz DEALS_AUTH=user:pass INGEST_TOKEN=... node scripts/push.mjs
import { crawl } from "../lib/crawler.mjs";

const base = (process.env.DEALS_URL || "https://deals.halle.biz").replace(/\/$/, "");
const headers = { "content-type": "application/json" };
if (process.env.DEALS_AUTH) headers.authorization = "Basic " + Buffer.from(process.env.DEALS_AUTH).toString("base64");
if (process.env.INGEST_TOKEN) headers["x-ingest-token"] = process.env.INGEST_TOKEN;

const logs = [];
const log = (m) => (logs.push(m), console.log(new Date().toISOString(), m));

const kr = await fetch(`${base}/api/known`, { headers });
if (!kr.ok) throw new Error(`GET /api/known: HTTP ${kr.status}`);
const krData = await kr.json();
const known = new Map(krData.known);
const pages = Number(process.env.CRAWL_PAGES || krData.settings?.crawlPages || 3);
const maxAgeDays = Number(process.env.RETENTION_DAYS || krData.settings?.retentionDays || 2);
const sources = Array.isArray(krData.settings?.sources)
  ? krData.settings.sources
  : ["mydealz", "meindeal", "monsterdealz", "dealdoktor", "camel"];

const paapi =
  process.env.PAAPI_ACCESS_KEY && process.env.PAAPI_SECRET_KEY && process.env.AMAZON_TAG
    ? {
        accessKey: process.env.PAAPI_ACCESS_KEY,
        secretKey: process.env.PAAPI_SECRET_KEY,
        partnerTag: process.env.AMAZON_TAG,
        keywords: process.env.PAAPI_KEYWORDS,
        minSavingPct: Number(process.env.PAAPI_MIN_SAVING_PCT || 30),
      }
    : undefined;

const keepa = process.env.KEEPA_API_KEY
  ? {
      apiKey: process.env.KEEPA_API_KEY,
      minDropPct: Number(process.env.KEEPA_MIN_DROP_PCT || 40),
    }
  : undefined;

const deals = await crawl({ pages, maxAgeDays, sources, known, paapi, keepa, log });
const r = await fetch(`${base}/api/ingest`, {
  method: "POST",
  headers,
  body: JSON.stringify({ source: process.env.PUSH_SOURCE || "push", deals, message: logs.join("; ") }),
});
if (!r.ok) throw new Error(`POST /api/ingest: HTTP ${r.status} ${await r.text()}`);
log(`pushed: ${JSON.stringify(await r.json())}`);
