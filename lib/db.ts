import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "deals.db");

const g = globalThis as unknown as { __dealsDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (g.__dealsDb) return g.__dealsDb;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS deals (
      thread_id     INTEGER PRIMARY KEY,
      source        TEXT NOT NULL DEFAULT 'mydealz',
      source_url    TEXT,
      asin          TEXT,
      no_asin       INTEGER NOT NULL DEFAULT 0,
      amz_title     TEXT,
      amz_image     TEXT,
      md_title      TEXT NOT NULL,
      md_image      TEXT,
      slug          TEXT,
      price         REAL,
      old_price     REAL,
      percentage    INTEGER,
      temperature   INTEGER NOT NULL DEFAULT 0,
      published_at  INTEGER,
      hot_date      INTEGER,
      is_expired    INTEGER NOT NULL DEFAULT 0,
      comment_count INTEGER NOT NULL DEFAULT 0,
      voucher_code  TEXT,
      first_seen    INTEGER NOT NULL,
      last_seen     INTEGER NOT NULL,
      is_price_error INTEGER NOT NULL DEFAULT 0,
      is_lowest     INTEGER NOT NULL DEFAULT 0,
      brand         TEXT
    );
    CREATE INDEX IF NOT EXISTS deals_published ON deals(published_at DESC);
    CREATE INDEX IF NOT EXISTS deals_asin ON deals(asin);
    CREATE TABLE IF NOT EXISTS price_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      asin        TEXT NOT NULL,
      price       REAL NOT NULL,
      old_price   REAL,
      recorded_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ph_asin_time ON price_history(asin, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS watchlist (
      asin           TEXT PRIMARY KEY,
      note           TEXT,
      brand          TEXT,
      title          TEXT,
      image          TEXT,
      target_price   REAL,
      min_drop_pct   INTEGER NOT NULL DEFAULT 20,
      last_price     REAL,
      avg_price_90d  REAL,
      lowest_price   REAL,
      in_stock       INTEGER NOT NULL DEFAULT 1,
      last_checked   INTEGER,
      created_at     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS wl_checked ON watchlist(last_checked ASC);
    CREATE TABLE IF NOT EXISTS crawl_runs (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      at       INTEGER NOT NULL,
      source   TEXT NOT NULL,
      ok       INTEGER NOT NULL,
      count    INTEGER NOT NULL DEFAULT 0,
      new      INTEGER NOT NULL DEFAULT 0,
      message  TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Safe migration for existing databases created before multi-source & price-history support
  const cols = new Set(
    (d.prepare("PRAGMA table_info(deals)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("source")) {
    d.exec("ALTER TABLE deals ADD COLUMN source TEXT NOT NULL DEFAULT 'mydealz'");
  }
  if (!cols.has("source_url")) {
    d.exec("ALTER TABLE deals ADD COLUMN source_url TEXT");
  }
  if (!cols.has("is_price_error")) {
    d.exec("ALTER TABLE deals ADD COLUMN is_price_error INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.has("is_lowest")) {
    d.exec("ALTER TABLE deals ADD COLUMN is_lowest INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.has("brand")) {
    d.exec("ALTER TABLE deals ADD COLUMN brand TEXT");
  }
  d.exec("CREATE INDEX IF NOT EXISTS deals_source ON deals(source)");
  d.exec("CREATE INDEX IF NOT EXISTS deals_price_error ON deals(is_price_error, published_at DESC)");

  g.__dealsDb = d;
  return d;
}

export type DealSource =
  | "mydealz"
  | "meindeal"
  | "monsterdealz"
  | "dealdoktor"
  | "camel"
  | "paapi"
  | "keepa"
  | "watchlist";

export const ALL_SOURCES: readonly DealSource[] = [
  "mydealz",
  "meindeal",
  "monsterdealz",
  "dealdoktor",
  "camel",
  "paapi",
  "keepa",
  "watchlist",
];

export const PUBLIC_SOURCES: readonly DealSource[] = [
  "mydealz",
  "meindeal",
  "monsterdealz",
  "dealdoktor",
  "camel",
];

const ALL_SOURCE_SET = new Set<string>(ALL_SOURCES);
const DEFAULT_PAAPI_KEYWORDS = "WMF,Zwilling,Bosch,Braun,Philips,Kärcher,LEGO,Anker,De'Longhi,Ninja,Eucerin,Pampers";

export type AppSettings = {
  retentionDays: number;
  crawlPages: number;
  crawlIntervalMin: number;
  serverCrawlEnabled: boolean;
  amazonTag: string;
  enableMydealz: boolean;
  enableMeindeal: boolean;
  enableMonsterdealz: boolean;
  enableDealdoktor: boolean;
  enableCamel: boolean;
  enablePaapiSearch: boolean;
  enableKeepa: boolean;
  enableWatchlist: boolean;
  watchlistAutoHarvest: boolean;
  paapiAccessKey: string;
  paapiSecretKey: string;
  paapiKeywords: string;
  paapiMinSavingPct: number;
  keepaApiKey: string;
  keepaMinDropPct: number;
};

export type PublicAppSettings = AppSettings & {
  hasPaapiSecret: boolean;
  hasKeepaKey: boolean;
};

export type SettingsUpdatePatch = Partial<AppSettings> & {
  clearPaapiSecret?: boolean;
  clearKeepaKey?: boolean;
};

const clamp = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function envDefaults(): AppSettings {
  const envInterval = Number(process.env.CRAWL_INTERVAL_MIN || 0);
  return {
    retentionDays: clamp(Number(process.env.RETENTION_DAYS || 2), 1, 90, 2),
    crawlPages: clamp(Number(process.env.CRAWL_PAGES || 3), 1, 20, 3),
    crawlIntervalMin: envInterval > 0 ? clamp(envInterval, 15, 1440, 30) : 30,
    serverCrawlEnabled: envInterval > 0,
    amazonTag: (process.env.AMAZON_TAG || "").trim(),
    enableMydealz: true,
    enableMeindeal: true,
    enableMonsterdealz: true,
    enableDealdoktor: true,
    enableCamel: true,
    enablePaapiSearch: Boolean(process.env.PAAPI_ACCESS_KEY && process.env.PAAPI_SECRET_KEY),
    enableKeepa: Boolean(process.env.KEEPA_API_KEY),
    enableWatchlist: true,
    watchlistAutoHarvest: true,
    paapiAccessKey: (process.env.PAAPI_ACCESS_KEY || "").trim(),
    paapiSecretKey: (process.env.PAAPI_SECRET_KEY || "").trim(),
    paapiKeywords: (process.env.PAAPI_KEYWORDS || DEFAULT_PAAPI_KEYWORDS).trim(),
    paapiMinSavingPct: clamp(Number(process.env.PAAPI_MIN_SAVING_PCT || 30), 10, 90, 30),
    keepaApiKey: (process.env.KEEPA_API_KEY || "").trim(),
    keepaMinDropPct: clamp(Number(process.env.KEEPA_MIN_DROP_PCT || 40), 10, 95, 40),
  };
}

export function getSettings(): AppSettings {
  const defs = envDefaults();
  const rows = db().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    retentionDays: map.has("retention_days") ? clamp(Number(map.get("retention_days")), 1, 90, defs.retentionDays) : defs.retentionDays,
    crawlPages: map.has("crawl_pages") ? clamp(Number(map.get("crawl_pages")), 1, 20, defs.crawlPages) : defs.crawlPages,
    crawlIntervalMin: map.has("crawl_interval_min")
      ? clamp(Number(map.get("crawl_interval_min")), 15, 1440, defs.crawlIntervalMin)
      : defs.crawlIntervalMin,
    serverCrawlEnabled: map.has("server_crawl_enabled") ? map.get("server_crawl_enabled") === "1" : defs.serverCrawlEnabled,
    amazonTag: map.has("amazon_tag") ? String(map.get("amazon_tag") ?? "").trim() : defs.amazonTag,
    enableMydealz: map.has("enable_mydealz") ? map.get("enable_mydealz") === "1" : defs.enableMydealz,
    enableMeindeal: map.has("enable_meindeal") ? map.get("enable_meindeal") === "1" : defs.enableMeindeal,
    enableMonsterdealz: map.has("enable_monsterdealz") ? map.get("enable_monsterdealz") === "1" : defs.enableMonsterdealz,
    enableDealdoktor: map.has("enable_dealdoktor") ? map.get("enable_dealdoktor") === "1" : defs.enableDealdoktor,
    enableCamel: map.has("enable_camel") ? map.get("enable_camel") === "1" : defs.enableCamel,
    enablePaapiSearch: map.has("enable_paapi_search") ? map.get("enable_paapi_search") === "1" : defs.enablePaapiSearch,
    enableKeepa: map.has("enable_keepa") ? map.get("enable_keepa") === "1" : defs.enableKeepa,
    enableWatchlist: map.has("enable_watchlist") ? map.get("enable_watchlist") === "1" : defs.enableWatchlist,
    watchlistAutoHarvest: map.has("watchlist_auto_harvest")
      ? map.get("watchlist_auto_harvest") === "1"
      : defs.watchlistAutoHarvest,
    paapiAccessKey: map.has("paapi_access_key") ? String(map.get("paapi_access_key") ?? "").trim() : defs.paapiAccessKey,
    paapiSecretKey: map.has("paapi_secret_key") ? String(map.get("paapi_secret_key") ?? "").trim() : defs.paapiSecretKey,
    paapiKeywords: map.has("paapi_keywords") ? String(map.get("paapi_keywords") ?? "").trim() : defs.paapiKeywords,
    paapiMinSavingPct: map.has("paapi_min_saving_pct")
      ? clamp(Number(map.get("paapi_min_saving_pct")), 10, 90, defs.paapiMinSavingPct)
      : defs.paapiMinSavingPct,
    keepaApiKey: map.has("keepa_api_key") ? String(map.get("keepa_api_key") ?? "").trim() : defs.keepaApiKey,
    keepaMinDropPct: map.has("keepa_min_drop_pct")
      ? clamp(Number(map.get("keepa_min_drop_pct")), 10, 95, defs.keepaMinDropPct)
      : defs.keepaMinDropPct,
  };
}

export function sanitizeSettingsForClient(s: AppSettings): PublicAppSettings {
  return {
    ...s,
    paapiSecretKey: "",
    keepaApiKey: "",
    hasPaapiSecret: Boolean(s.paapiSecretKey),
    hasKeepaKey: Boolean(s.keepaApiKey),
  };
}

export function getEnabledSources(s: AppSettings = getSettings(), { includeSecretSources = true } = {}): DealSource[] {
  const out: DealSource[] = [];
  if (s.enableMydealz) out.push("mydealz");
  if (s.enableMeindeal) out.push("meindeal");
  if (s.enableMonsterdealz) out.push("monsterdealz");
  if (s.enableDealdoktor) out.push("dealdoktor");
  if (s.enableCamel) out.push("camel");
  if (includeSecretSources) {
    if (s.enablePaapiSearch && s.paapiAccessKey && s.paapiSecretKey && s.amazonTag) out.push("paapi");
    if (s.enableKeepa && s.keepaApiKey) out.push("keepa");
  }
  return out;
}

export function updateSettings(patch: SettingsUpdatePatch): AppSettings {
  const cur = getSettings();
  const nextPaapiSecret = patch.clearPaapiSecret
    ? ""
    : typeof patch.paapiSecretKey === "string" && patch.paapiSecretKey.trim()
      ? patch.paapiSecretKey.trim().slice(0, 200)
      : cur.paapiSecretKey;
  const nextKeepaKey = patch.clearKeepaKey
    ? ""
    : typeof patch.keepaApiKey === "string" && patch.keepaApiKey.trim()
      ? patch.keepaApiKey.trim().slice(0, 200)
      : cur.keepaApiKey;

  const next: AppSettings = {
    retentionDays: patch.retentionDays !== undefined ? clamp(Number(patch.retentionDays), 1, 90, cur.retentionDays) : cur.retentionDays,
    crawlPages: patch.crawlPages !== undefined ? clamp(Number(patch.crawlPages), 1, 20, cur.crawlPages) : cur.crawlPages,
    crawlIntervalMin:
      patch.crawlIntervalMin !== undefined ? clamp(Number(patch.crawlIntervalMin), 15, 1440, cur.crawlIntervalMin) : cur.crawlIntervalMin,
    serverCrawlEnabled: patch.serverCrawlEnabled !== undefined ? Boolean(patch.serverCrawlEnabled) : cur.serverCrawlEnabled,
    amazonTag: patch.amazonTag !== undefined ? String(patch.amazonTag).trim().slice(0, 100) : cur.amazonTag,
    enableMydealz: patch.enableMydealz !== undefined ? Boolean(patch.enableMydealz) : cur.enableMydealz,
    enableMeindeal: patch.enableMeindeal !== undefined ? Boolean(patch.enableMeindeal) : cur.enableMeindeal,
    enableMonsterdealz: patch.enableMonsterdealz !== undefined ? Boolean(patch.enableMonsterdealz) : cur.enableMonsterdealz,
    enableDealdoktor: patch.enableDealdoktor !== undefined ? Boolean(patch.enableDealdoktor) : cur.enableDealdoktor,
    enableCamel: patch.enableCamel !== undefined ? Boolean(patch.enableCamel) : cur.enableCamel,
    enablePaapiSearch: patch.enablePaapiSearch !== undefined ? Boolean(patch.enablePaapiSearch) : cur.enablePaapiSearch,
    enableKeepa: patch.enableKeepa !== undefined ? Boolean(patch.enableKeepa) : cur.enableKeepa,
    enableWatchlist: patch.enableWatchlist !== undefined ? Boolean(patch.enableWatchlist) : cur.enableWatchlist,
    watchlistAutoHarvest:
      patch.watchlistAutoHarvest !== undefined ? Boolean(patch.watchlistAutoHarvest) : cur.watchlistAutoHarvest,
    paapiAccessKey: patch.paapiAccessKey !== undefined ? String(patch.paapiAccessKey).trim().slice(0, 200) : cur.paapiAccessKey,
    paapiSecretKey: nextPaapiSecret,
    paapiKeywords: patch.paapiKeywords !== undefined ? String(patch.paapiKeywords).trim().slice(0, 1000) : cur.paapiKeywords,
    paapiMinSavingPct:
      patch.paapiMinSavingPct !== undefined ? clamp(Number(patch.paapiMinSavingPct), 10, 90, cur.paapiMinSavingPct) : cur.paapiMinSavingPct,
    keepaApiKey: nextKeepaKey,
    keepaMinDropPct:
      patch.keepaMinDropPct !== undefined ? clamp(Number(patch.keepaMinDropPct), 10, 95, cur.keepaMinDropPct) : cur.keepaMinDropPct,
  };
  const d = db();
  const stmt = d.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  d.exec("BEGIN");
  try {
    stmt.run("retention_days", String(next.retentionDays));
    stmt.run("crawl_pages", String(next.crawlPages));
    stmt.run("crawl_interval_min", String(next.crawlIntervalMin));
    stmt.run("server_crawl_enabled", next.serverCrawlEnabled ? "1" : "0");
    stmt.run("amazon_tag", next.amazonTag);
    stmt.run("enable_mydealz", next.enableMydealz ? "1" : "0");
    stmt.run("enable_meindeal", next.enableMeindeal ? "1" : "0");
    stmt.run("enable_monsterdealz", next.enableMonsterdealz ? "1" : "0");
    stmt.run("enable_dealdoktor", next.enableDealdoktor ? "1" : "0");
    stmt.run("enable_camel", next.enableCamel ? "1" : "0");
    stmt.run("enable_paapi_search", next.enablePaapiSearch ? "1" : "0");
    stmt.run("enable_keepa", next.enableKeepa ? "1" : "0");
    stmt.run("enable_watchlist", next.enableWatchlist ? "1" : "0");
    stmt.run("watchlist_auto_harvest", next.watchlistAutoHarvest ? "1" : "0");
    stmt.run("paapi_access_key", next.paapiAccessKey);
    stmt.run("paapi_secret_key", next.paapiSecretKey);
    stmt.run("paapi_keywords", next.paapiKeywords);
    stmt.run("paapi_min_saving_pct", String(next.paapiMinSavingPct));
    stmt.run("keepa_api_key", next.keepaApiKey);
    stmt.run("keepa_min_drop_pct", String(next.keepaMinDropPct));
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return next;
}

export type DealIn = {
  threadId: number;
  source?: string;
  sourceUrl?: string | null;
  mdTitle: string;
  slug?: string | null;
  price?: number | null;
  oldPrice?: number | null;
  percentage?: number | null;
  temperature?: number;
  publishedAt?: number | null;
  hotDate?: number | null;
  isExpired?: number;
  commentCount?: number;
  voucherCode?: string | null;
  mdImage?: string | null;
  asin?: string | null;
  noAsin?: boolean;
  amzTitle?: string | null;
  amzImage?: string | null;
  isPriceError?: boolean | number;
  isLowest?: boolean | number;
  brand?: string | null;
};

export type DealRow = {
  thread_id: number;
  source: string;
  source_url: string | null;
  asin: string | null;
  no_asin: number;
  amz_title: string | null;
  amz_image: string | null;
  md_title: string;
  md_image: string | null;
  slug: string | null;
  price: number | null;
  old_price: number | null;
  percentage: number | null;
  temperature: number;
  published_at: number | null;
  is_expired: number;
  comment_count: number;
  voucher_code: string | null;
  first_seen: number;
  last_seen: number;
  is_price_error: number;
  is_lowest: number;
  brand: string | null;
};

export type CrawlRunRow = {
  id: number;
  at: number;
  source: string;
  ok: number;
  count: number;
  new: number;
  message: string | null;
};

export type CrawlRunSummary = CrawlRunRow;

const n = <T extends string | number>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function upsertDeals(deals: DealIn[]): { count: number; added: number; skippedOld: number } {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const { retentionDays } = getSettings();
  const cutoff = now - retentionDays * 86400;
  const phCutoff = now - 90 * 86400;

  const exists = d.prepare("SELECT 1 FROM deals WHERE thread_id = ?");
  const phStatsStmt = d.prepare(
    "SELECT COUNT(*) AS cnt, AVG(price) AS avg_p, MIN(price) AS min_p FROM price_history WHERE asin = ? AND recorded_at >= ?",
  );
  const phLatestStmt = d.prepare(
    "SELECT price, recorded_at FROM price_history WHERE asin = ? ORDER BY recorded_at DESC LIMIT 1",
  );
  const phInsertStmt = d.prepare("INSERT INTO price_history (asin, price, old_price, recorded_at) VALUES (?,?,?,?)");

  const stmt = d.prepare(`
    INSERT INTO deals (thread_id, source, source_url, asin, no_asin, amz_title, amz_image, md_title, md_image, slug, price, old_price,
      percentage, temperature, published_at, hot_date, is_expired, comment_count, voucher_code, first_seen, last_seen,
      is_price_error, is_lowest, brand)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(thread_id) DO UPDATE SET
      source = excluded.source,
      source_url = COALESCE(excluded.source_url, deals.source_url),
      asin = COALESCE(excluded.asin, deals.asin),
      no_asin = CASE WHEN excluded.asin IS NOT NULL THEN 0 ELSE MAX(deals.no_asin, excluded.no_asin) END,
      amz_title = COALESCE(excluded.amz_title, deals.amz_title),
      amz_image = COALESCE(excluded.amz_image, deals.amz_image),
      md_title = excluded.md_title, md_image = COALESCE(excluded.md_image, deals.md_image), slug = excluded.slug,
      price = COALESCE(excluded.price, deals.price),
      old_price = COALESCE(excluded.old_price, deals.old_price),
      percentage = COALESCE(excluded.percentage, deals.percentage),
      temperature = MAX(deals.temperature, excluded.temperature),
      published_at = COALESCE(excluded.published_at, deals.published_at),
      hot_date = COALESCE(excluded.hot_date, deals.hot_date),
      is_expired = excluded.is_expired, comment_count = MAX(deals.comment_count, excluded.comment_count),
      voucher_code = COALESCE(excluded.voucher_code, deals.voucher_code), last_seen = excluded.last_seen,
      is_price_error = MAX(deals.is_price_error, excluded.is_price_error),
      is_lowest = MAX(deals.is_lowest, excluded.is_lowest),
      brand = COALESCE(excluded.brand, deals.brand)
  `);
  let count = 0;
  let added = 0;
  let skippedOld = 0;
  d.exec("BEGIN");
  try {
    for (const x of deals) {
      if (!Number.isInteger(x.threadId) || typeof x.mdTitle !== "string") continue;
      if (typeof x.publishedAt === "number" && x.publishedAt > 0 && x.publishedAt < cutoff) {
        skippedOld++;
        continue;
      }
      if (!exists.get(x.threadId)) added++;
      const src: DealSource = x.source && ALL_SOURCE_SET.has(x.source) ? (x.source as DealSource) : "mydealz";

      let price = typeof x.price === "number" && Number.isFinite(x.price) ? x.price : null;
      let oldPrice = typeof x.oldPrice === "number" && Number.isFinite(x.oldPrice) && x.oldPrice > 0 ? x.oldPrice : null;
      let pct =
        typeof x.percentage === "number" && Number.isFinite(x.percentage)
          ? Math.round(x.percentage)
          : price != null && oldPrice != null && oldPrice > price
            ? Math.round(100 * (1 - price / oldPrice))
            : null;
      let isPriceError = Boolean(x.isPriceError) || (pct != null && pct >= 55);
      let isLowest = Boolean(x.isLowest);

      const cleanAsin = x.asin ? String(x.asin).trim().toUpperCase() : null;
      if (cleanAsin && price != null && price > 0) {
        const stats = phStatsStmt.get(cleanAsin, phCutoff) as
          | { cnt: number; avg_p: number | null; min_p: number | null }
          | undefined;
        const cnt = Number(stats?.cnt ?? 0);
        const avgP = stats?.avg_p != null ? Number(stats.avg_p) : null;
        const minP = stats?.min_p != null ? Number(stats.min_p) : null;

        if (cnt >= 2 && avgP != null && price <= avgP * 0.5) isPriceError = true;
        if (cnt >= 2 && minP != null && price < minP) isLowest = true;
        if (oldPrice == null && cnt >= 2 && avgP != null && avgP > price * 1.05) {
          oldPrice = Math.round(avgP * 100) / 100;
          pct = Math.round(100 * (1 - price / oldPrice));
        }

        const latest = phLatestStmt.get(cleanAsin) as { price: number; recorded_at: number } | undefined;
        if (!latest || Math.abs(Number(latest.price) - price) >= 0.01 || now - Number(latest.recorded_at) >= 6 * 3600) {
          phInsertStmt.run(cleanAsin, price, oldPrice, now);
        }
      }

      stmt.run(
        x.threadId, src, n(x.sourceUrl), cleanAsin, x.noAsin ? 1 : 0, n(x.amzTitle), n(x.amzImage), x.mdTitle, n(x.mdImage), n(x.slug),
        price, oldPrice, pct, x.temperature ?? 0, n(x.publishedAt), n(x.hotDate),
        x.isExpired ? 1 : 0, x.commentCount ?? 0, n(x.voucherCode), now, now,
        isPriceError ? 1 : 0, isLowest ? 1 : 0, n(x.brand),
      );
      count++;
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { count, added, skippedOld };
}

export type ActiveAsinDeal = {
  thread_id: number;
  asin: string;
  price: number | null;
  old_price: number | null;
  amz_title: string | null;
  amz_image: string | null;
};

export function listActiveDealsWithAsin(limit = 200): ActiveAsinDeal[] {
  return db()
    .prepare(
      `SELECT thread_id, asin, price, old_price, amz_title, amz_image
       FROM deals
       WHERE is_expired = 0 AND asin IS NOT NULL AND asin <> ''
       ORDER BY last_seen ASC
       LIMIT ?`,
    )
    .all(clamp(limit, 1, 500, 200)) as ActiveAsinDeal[];
}

export type PriceCheckUpdate = {
  threadId: number;
  asin: string;
  price: number | null;
  oldPrice: number | null;
  percentage: number | null;
  inStock: boolean;
  title?: string | null;
  image?: string | null;
  brand?: string | null;
};

export function applyPriceChecks(updates: PriceCheckUpdate[]): { checked: number; updated: number; expired: number } {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const phCutoff = now - 90 * 86400;
  const curStmt = d.prepare("SELECT price, old_price, is_price_error, is_lowest FROM deals WHERE thread_id = ?");
  const phStatsStmt = d.prepare(
    "SELECT COUNT(*) AS cnt, AVG(price) AS avg_p, MIN(price) AS min_p FROM price_history WHERE asin = ? AND recorded_at >= ?",
  );
  const phLatestStmt = d.prepare(
    "SELECT price, recorded_at FROM price_history WHERE asin = ? ORDER BY recorded_at DESC LIMIT 1",
  );
  const phInsertStmt = d.prepare("INSERT INTO price_history (asin, price, old_price, recorded_at) VALUES (?,?,?,?)");
  const updStmt = d.prepare(`
    UPDATE deals SET
      price = COALESCE(?, price),
      old_price = COALESCE(?, old_price),
      percentage = COALESCE(?, percentage),
      amz_title = COALESCE(?, amz_title),
      amz_image = COALESCE(?, amz_image),
      brand = COALESCE(?, brand),
      is_expired = ?,
      is_price_error = MAX(is_price_error, ?),
      is_lowest = MAX(is_lowest, ?),
      last_seen = ?
    WHERE thread_id = ?
  `);

  let checked = 0;
  let updated = 0;
  let expired = 0;
  d.exec("BEGIN");
  try {
    for (const u of updates) {
      checked++;
      const cur = curStmt.get(u.threadId) as
        | { price: number | null; old_price: number | null; is_price_error: number; is_lowest: number }
        | undefined;
      if (!cur) continue;

      const prevPrice = cur.price != null ? Number(cur.price) : null;
      const priceIncreasedTooMuch = prevPrice != null && prevPrice > 0 && u.price != null && u.price > prevPrice * 1.15;
      const shouldExpire = !u.inStock || priceIncreasedTooMuch;
      if (shouldExpire) expired++;

      let isPriceError = u.percentage != null && u.percentage >= 55;
      let isLowest = false;
      if (u.price != null && u.price > 0) {
        const stats = phStatsStmt.get(u.asin, phCutoff) as
          | { cnt: number; avg_p: number | null; min_p: number | null }
          | undefined;
        const cnt = Number(stats?.cnt ?? 0);
        const avgP = stats?.avg_p != null ? Number(stats.avg_p) : null;
        const minP = stats?.min_p != null ? Number(stats.min_p) : null;
        if (cnt >= 2 && avgP != null && u.price <= avgP * 0.5) isPriceError = true;
        if (cnt >= 2 && minP != null && u.price < minP) isLowest = true;

        const latest = phLatestStmt.get(u.asin) as { price: number; recorded_at: number } | undefined;
        if (!latest || Math.abs(Number(latest.price) - u.price) >= 0.01 || now - Number(latest.recorded_at) >= 6 * 3600) {
          phInsertStmt.run(u.asin, u.price, u.oldPrice, now);
        }
      }

      const res = updStmt.run(
        n(u.price),
        n(u.oldPrice),
        n(u.percentage),
        n(u.title),
        n(u.image),
        n(u.brand),
        shouldExpire ? 1 : 0,
        isPriceError ? 1 : 0,
        isLowest ? 1 : 0,
        now,
        u.threadId,
      );
      if (Number(res.changes) > 0) updated++;
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { checked, updated, expired };
}

/** Delete deals older than retentionDays (based on published_at, falling back to first_seen). */
export function pruneOldDeals(retentionDays?: number): number {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const days = retentionDays ?? getSettings().retentionDays;
  const cutoff = now - days * 86400;
  const res = d.prepare("DELETE FROM deals WHERE COALESCE(published_at, first_seen) < ?").run(cutoff);
  d.prepare("DELETE FROM price_history WHERE recorded_at < ?").run(now - 90 * 86400);
  return Number(res.changes);
}

export function pruneExpiredDeals(): number {
  const res = db().prepare("DELETE FROM deals WHERE is_expired = 1").run();
  return Number(res.changes);
}

export function clearAllDeals(): number {
  const res = db().prepare("DELETE FROM deals").run();
  return Number(res.changes);
}

export function deleteDeal(threadId: number): number {
  const res = db().prepare("DELETE FROM deals WHERE thread_id = ?").run(threadId);
  return Number(res.changes);
}

export function setDealExpired(threadId: number, expired: boolean): number {
  const res = db().prepare("UPDATE deals SET is_expired = ? WHERE thread_id = ?").run(expired ? 1 : 0, threadId);
  return Number(res.changes);
}

export function resetNoAsin(threadId?: number): number {
  if (typeof threadId === "number" && Number.isInteger(threadId)) {
    return Number(db().prepare("UPDATE deals SET no_asin = 0 WHERE thread_id = ?").run(threadId).changes);
  }
  return Number(db().prepare("UPDATE deals SET no_asin = 0 WHERE no_asin = 1").run().changes);
}

export function recordRun(source: string, ok: boolean, count: number, added: number, message?: string) {
  db()
    .prepare("INSERT INTO crawl_runs (at, source, ok, count, new, message) VALUES (?,?,?,?,?,?)")
    .run(Math.floor(Date.now() / 1000), source, ok ? 1 : 0, count, added, message ?? null);
  db().exec("DELETE FROM crawl_runs WHERE id NOT IN (SELECT id FROM crawl_runs ORDER BY id DESC LIMIT 500)");
}

/** Deals seen recently, so crawlers can skip ASIN/Amazon lookups already done. */
export function knownMap(): Map<number, { asin: string | null; noAsin: boolean; hasAmz: boolean }> {
  const rows = db()
    .prepare("SELECT thread_id, asin, no_asin, amz_title FROM deals WHERE last_seen > ?")
    .all(Math.floor(Date.now() / 1000) - 30 * 86400) as {
    thread_id: number;
    asin: string | null;
    no_asin: number;
    amz_title: string | null;
  }[];
  return new Map(rows.map((r) => [r.thread_id, { asin: r.asin, noAsin: !!r.no_asin, hasAmz: !!r.amz_title }]));
}

export type AdminStats = {
  total: number;
  active: number;
  expired: number;
  withAsin: number;
  noAsin: number;
  withAmzTitle: number;
  priceErrors: number;
  trackedAsins: number;
  watchlistCount: number;
  olderThanRetention: number;
  oldestAt: number | null;
  newestAt: number | null;
  dbSizeBytes: number;
  bySource: Record<DealSource, number>;
  lastOk: { at: number; source: string } | null;
  lastRun: CrawlRunRow | null;
};

export function getAdminStats(): AdminStats {
  const d = db();
  const { retentionDays } = getSettings();
  const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 86400;
  const row = d
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN is_expired = 0 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN is_expired = 1 THEN 1 ELSE 0 END) AS expired,
        SUM(CASE WHEN asin IS NOT NULL THEN 1 ELSE 0 END) AS with_asin,
        SUM(CASE WHEN no_asin = 1 THEN 1 ELSE 0 END) AS no_asin,
        SUM(CASE WHEN amz_title IS NOT NULL THEN 1 ELSE 0 END) AS with_amz_title,
        SUM(CASE WHEN is_price_error = 1 THEN 1 ELSE 0 END) AS price_errors,
        SUM(CASE WHEN COALESCE(published_at, first_seen) < ? THEN 1 ELSE 0 END) AS older_than_retention,
        SUM(CASE WHEN source = 'mydealz' THEN 1 ELSE 0 END) AS src_mydealz,
        SUM(CASE WHEN source = 'meindeal' THEN 1 ELSE 0 END) AS src_meindeal,
        SUM(CASE WHEN source = 'monsterdealz' THEN 1 ELSE 0 END) AS src_monsterdealz,
        SUM(CASE WHEN source = 'dealdoktor' THEN 1 ELSE 0 END) AS src_dealdoktor,
        SUM(CASE WHEN source = 'camel' THEN 1 ELSE 0 END) AS src_camel,
        SUM(CASE WHEN source = 'paapi' THEN 1 ELSE 0 END) AS src_paapi,
        SUM(CASE WHEN source = 'keepa' THEN 1 ELSE 0 END) AS src_keepa,
        SUM(CASE WHEN source = 'watchlist' THEN 1 ELSE 0 END) AS src_watchlist,
        MIN(COALESCE(published_at, first_seen)) AS oldest_at,
        MAX(COALESCE(published_at, first_seen)) AS newest_at
      FROM deals`,
    )
    .get(cutoff) as Record<string, number | null>;

  const trackedAsins = Number(
    (d.prepare("SELECT COUNT(DISTINCT asin) AS c FROM price_history").get() as { c?: number } | undefined)?.c ?? 0,
  );
  const watchlistCount = Number(
    (d.prepare("SELECT COUNT(*) AS c FROM watchlist").get() as { c?: number } | undefined)?.c ?? 0,
  );
  const pageCount = (d.prepare("PRAGMA page_count").get() as { page_count?: number } | undefined)?.page_count ?? 0;
  const pageSize = (d.prepare("PRAGMA page_size").get() as { page_size?: number } | undefined)?.page_size ?? 0;
  const dbSizeBytes = Number(pageCount) * Number(pageSize);

  const lastOkRow = d
    .prepare("SELECT at, source FROM crawl_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1")
    .get() as { at: number; source: string } | undefined;
  const lastRunRow = d
    .prepare("SELECT id, at, source, ok, count, new, message FROM crawl_runs ORDER BY id DESC LIMIT 1")
    .get() as CrawlRunRow | undefined;

  return {
    total: Number(row.total ?? 0),
    active: Number(row.active ?? 0),
    expired: Number(row.expired ?? 0),
    withAsin: Number(row.with_asin ?? 0),
    noAsin: Number(row.no_asin ?? 0),
    withAmzTitle: Number(row.with_amz_title ?? 0),
    priceErrors: Number(row.price_errors ?? 0),
    trackedAsins,
    watchlistCount,
    olderThanRetention: Number(row.older_than_retention ?? 0),
    oldestAt: row.oldest_at ?? null,
    newestAt: row.newest_at ?? null,
    dbSizeBytes,
    bySource: {
      mydealz: Number(row.src_mydealz ?? 0),
      meindeal: Number(row.src_meindeal ?? 0),
      monsterdealz: Number(row.src_monsterdealz ?? 0),
      dealdoktor: Number(row.src_dealdoktor ?? 0),
      camel: Number(row.src_camel ?? 0),
      paapi: Number(row.src_paapi ?? 0),
      keepa: Number(row.src_keepa ?? 0),
      watchlist: Number(row.src_watchlist ?? 0),
    },
    lastOk: lastOkRow ? { at: Number(lastOkRow.at), source: String(lastOkRow.source) } : null,
    lastRun: lastRunRow ? { ...lastRunRow } : null,
  };
}

export function getRecentRuns(limit = 30): CrawlRunRow[] {
  const rows = db()
    .prepare("SELECT id, at, source, ok, count, new, message FROM crawl_runs ORDER BY id DESC LIMIT ?")
    .all(limit) as CrawlRunRow[];
  return rows.map((r) => ({ ...r }));
}

export function listDealsAdmin({
  q = "",
  filter = "all",
  source = "all",
  limit = 100,
}: {
  q?: string;
  filter?: string;
  source?: string;
  limit?: number;
} = {}): DealRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter === "active") where.push("is_expired = 0");
  else if (filter === "expired") where.push("is_expired = 1");
  else if (filter === "no_asin") where.push("asin IS NULL");
  else if (filter === "price_error") where.push("is_price_error = 1");
  if (ALL_SOURCE_SET.has(source)) {
    where.push("source = ?");
    args.push(source);
  }
  if (q.trim()) {
    where.push("(COALESCE(amz_title,'') || ' ' || md_title || ' ' || COALESCE(asin,'') || ' ' || COALESCE(brand,'') || ' ' || CAST(thread_id AS TEXT)) LIKE ?");
    args.push(`%${q.trim()}%`);
  }
  const sql = `SELECT * FROM deals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(published_at, first_seen) DESC LIMIT ?`;
  args.push(clamp(limit, 1, 500, 100));
  const rows = db().prepare(sql).all(...args) as DealRow[];
  return rows.map((r) => ({ ...r }));
}

export type WatchlistRow = {
  asin: string;
  note: string | null;
  brand: string | null;
  title: string | null;
  image: string | null;
  target_price: number | null;
  min_drop_pct: number;
  last_price: number | null;
  avg_price_90d: number | null;
  lowest_price: number | null;
  in_stock: number;
  last_checked: number | null;
  created_at: number;
};

export function asinHash(asin: string): number {
  let h = 2166136261;
  const s = String(asin || "").toUpperCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 90_000_000) + 1;
}

export function extractAsinsFromText(input: string): string[] {
  const found = new Set<string>();
  const urlRe = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?![A-Z0-9])/gi;
  for (const m of input.matchAll(urlRe)) found.add(m[1].toUpperCase());
  const tokenRe = /\b(B0[A-Z0-9]{8})\b/gi;
  for (const m of input.matchAll(tokenRe)) found.add(m[1].toUpperCase());
  return [...found];
}

export function addToWatchlist(
  items: Array<{
    asin: string;
    note?: string | null;
    targetPrice?: number | null;
    minDropPct?: number;
    brand?: string | null;
  }>,
): { added: number; updated: number } {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const existsStmt = d.prepare("SELECT 1 FROM watchlist WHERE asin = ?");
  const dealPrefillStmt = d.prepare(
    `SELECT COALESCE(amz_title, md_title) AS title, COALESCE(amz_image, md_image) AS image, brand, price
     FROM deals WHERE asin = ? ORDER BY last_seen DESC LIMIT 1`,
  );
  const upsertStmt = d.prepare(`
    INSERT INTO watchlist (asin, note, brand, title, image, target_price, min_drop_pct, last_price, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(asin) DO UPDATE SET
      note = COALESCE(excluded.note, watchlist.note),
      brand = COALESCE(excluded.brand, watchlist.brand),
      target_price = COALESCE(excluded.target_price, watchlist.target_price),
      min_drop_pct = excluded.min_drop_pct
  `);

  let added = 0;
  let updated = 0;
  d.exec("BEGIN");
  try {
    for (const item of items) {
      const asin = String(item.asin || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      if (existsStmt.get(asin)) updated++;
      else added++;

      const prefill = dealPrefillStmt.get(asin) as
        | { title: string | null; image: string | null; brand: string | null; price: number | null }
        | undefined;
      const targetPrice =
        typeof item.targetPrice === "number" && Number.isFinite(item.targetPrice) && item.targetPrice > 0
          ? item.targetPrice
          : null;
      const minDropPct = clamp(Number(item.minDropPct ?? 20), 5, 90, 20);
      upsertStmt.run(
        asin,
        item.note ? String(item.note).trim().slice(0, 120) : null,
        item.brand ? String(item.brand).trim().slice(0, 80) : prefill?.brand ?? null,
        prefill?.title ?? null,
        prefill?.image ?? null,
        targetPrice,
        minDropPct,
        prefill?.price ?? null,
        now,
      );
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { added, updated };
}

export function removeFromWatchlist(asin: string): number {
  const clean = String(asin || "").trim().toUpperCase();
  return Number(db().prepare("DELETE FROM watchlist WHERE asin = ?").run(clean).changes);
}

export function clearWatchlist(): number {
  return Number(db().prepare("DELETE FROM watchlist").run().changes);
}

export function listWatchlist({ q = "", limit = 100 }: { q?: string; limit?: number } = {}): WatchlistRow[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (q.trim()) {
    where.push("(asin || ' ' || COALESCE(title,'') || ' ' || COALESCE(brand,'') || ' ' || COALESCE(note,'')) LIKE ?");
    args.push(`%${q.trim()}%`);
  }
  const sql = `SELECT * FROM watchlist ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(last_checked, created_at) DESC LIMIT ?`;
  args.push(clamp(limit, 1, 500, 100));
  return (db().prepare(sql).all(...args) as WatchlistRow[]).map((r) => ({ ...r }));
}

export function getWatchlistForCheck(limit = 100): WatchlistRow[] {
  return (
    db()
      .prepare("SELECT * FROM watchlist ORDER BY COALESCE(last_checked, 0) ASC LIMIT ?")
      .all(clamp(limit, 1, 300, 100)) as WatchlistRow[]
  ).map((r) => ({ ...r }));
}

function compileBrandMatchers(keywordsCsv: string): Array<{ label: string; re: RegExp }> {
  return String(keywordsCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .map((label) => ({
      label,
      re: new RegExp(`(^|[^\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`, "iu"),
    }));
}

function harvestCandidates(
  candidates: Array<{
    asin: string;
    title: string;
    image?: string | null;
    brand?: string | null;
    price?: number | null;
  }>,
  keywordsCsv: string,
  maxTotal = 500,
): number {
  const matchers = compileBrandMatchers(keywordsCsv);
  if (matchers.length === 0 || candidates.length === 0) return 0;

  const d = db();
  const currentTotal = Number(
    (d.prepare("SELECT COUNT(*) AS c FROM watchlist").get() as { c?: number } | undefined)?.c ?? 0,
  );
  if (currentTotal >= maxTotal) return 0;

  const now = Math.floor(Date.now() / 1000);
  const insertStmt = d.prepare(`
    INSERT OR IGNORE INTO watchlist (asin, note, brand, title, image, target_price, min_drop_pct, last_price, created_at)
    VALUES (?,?,?,?,?,NULL,20,?,?)
  `);

  let added = 0;
  d.exec("BEGIN");
  try {
    for (const c of candidates) {
      if (currentTotal + added >= maxTotal) break;
      const asin = String(c.asin || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const haystack = `${c.brand || ""} ${c.title || ""}`.trim();
      if (!haystack) continue;
      const matched = matchers.find((m) => m.re.test(haystack));
      if (!matched) continue;

      const res = insertStmt.run(
        asin,
        `Auto (${matched.label})`,
        c.brand ?? matched.label,
        c.title || null,
        c.image || null,
        typeof c.price === "number" && Number.isFinite(c.price) && c.price > 0 ? c.price : null,
        now,
      );
      if (Number(res.changes) > 0) added++;
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return added;
}

export function harvestExistingDealsToWatchlist(keywordsCsv: string, maxTotal = 500): number {
  const rows = db()
    .prepare(
      `SELECT asin, COALESCE(amz_title, md_title) AS title, COALESCE(amz_image, md_image) AS image, brand, price
       FROM deals
       WHERE asin IS NOT NULL AND asin <> '' AND is_expired = 0
       ORDER BY published_at DESC
       LIMIT 1000`,
    )
    .all() as Array<{
    asin: string;
    title: string;
    image: string | null;
    brand: string | null;
    price: number | null;
  }>;
  return harvestCandidates(rows, keywordsCsv, maxTotal);
}

export function harvestDealsArrayToWatchlist(deals: DealIn[], keywordsCsv: string, maxTotal = 500): number {
  const candidates: Array<{
    asin: string;
    title: string;
    image?: string | null;
    brand?: string | null;
    price?: number | null;
  }> = [];
  for (const x of deals) {
    if (!x.asin) continue;
    candidates.push({
      asin: x.asin,
      title: x.amzTitle || x.mdTitle,
      image: x.amzImage || x.mdImage,
      brand: x.brand,
      price: x.price,
    });
  }
  return harvestCandidates(candidates, keywordsCsv, maxTotal);
}

export type WatchlistCheckInput = {
  asin: string;
  title?: string | null;
  image?: string | null;
  brand?: string | null;
  price: number | null;
  oldPrice?: number | null;
  inStock: boolean;
};

export function recordWatchlistChecks(results: WatchlistCheckInput[]): { checked: number; triggered: number } {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const phCutoff = now - 90 * 86400;

  const wlGetStmt = d.prepare("SELECT * FROM watchlist WHERE asin = ?");
  const phStatsStmt = d.prepare(
    "SELECT COUNT(*) AS cnt, AVG(price) AS avg_p, MIN(price) AS min_p FROM price_history WHERE asin = ? AND recorded_at >= ?",
  );
  const phLatestStmt = d.prepare(
    "SELECT price, recorded_at FROM price_history WHERE asin = ? ORDER BY recorded_at DESC LIMIT 1",
  );
  const phInsertStmt = d.prepare("INSERT INTO price_history (asin, price, old_price, recorded_at) VALUES (?,?,?,?)");
  const wlUpdStmt = d.prepare(`
    UPDATE watchlist SET
      title = COALESCE(?, title),
      image = COALESCE(?, image),
      brand = COALESCE(?, brand),
      last_price = COALESCE(?, last_price),
      avg_price_90d = COALESCE(?, avg_price_90d),
      lowest_price = COALESCE(?, lowest_price),
      in_stock = ?,
      last_checked = ?
    WHERE asin = ?
  `);

  const triggeredDeals: DealIn[] = [];
  let checked = 0;

  d.exec("BEGIN");
  try {
    for (const r of results) {
      const asin = String(r.asin || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) continue;
      const row = wlGetStmt.get(asin) as WatchlistRow | undefined;
      if (!row) continue;
      checked++;

      const price = typeof r.price === "number" && Number.isFinite(r.price) && r.price > 0 ? r.price : null;
      const oldPrice = typeof r.oldPrice === "number" && Number.isFinite(r.oldPrice) && r.oldPrice > 0 ? r.oldPrice : null;

      const prevStats = phStatsStmt.get(asin, phCutoff) as
        | { cnt: number; avg_p: number | null; min_p: number | null }
        | undefined;
      const prevCnt = Number(prevStats?.cnt ?? 0);
      const prevAvg = prevStats?.avg_p != null ? Math.round(Number(prevStats.avg_p) * 100) / 100 : null;
      const prevMin = prevStats?.min_p != null ? Math.round(Number(prevStats.min_p) * 100) / 100 : null;

      if (price != null) {
        const latest = phLatestStmt.get(asin) as { price: number; recorded_at: number } | undefined;
        if (!latest || Math.abs(Number(latest.price) - price) >= 0.01 || now - Number(latest.recorded_at) >= 6 * 3600) {
          phInsertStmt.run(asin, price, oldPrice, now);
        }
      }

      const nextStats = phStatsStmt.get(asin, phCutoff) as
        | { cnt: number; avg_p: number | null; min_p: number | null }
        | undefined;
      const nextAvg = nextStats?.avg_p != null ? Math.round(Number(nextStats.avg_p) * 100) / 100 : prevAvg;
      const nextMin = nextStats?.min_p != null ? Math.round(Number(nextStats.min_p) * 100) / 100 : prevMin;

      wlUpdStmt.run(
        n(r.title),
        n(r.image),
        n(r.brand),
        price,
        nextAvg,
        nextMin,
        r.inStock ? 1 : 0,
        now,
        asin,
      );

      if (r.inStock && price != null) {
        const refOld = oldPrice ?? (prevCnt >= 2 && prevAvg != null && prevAvg > price * 1.05 ? prevAvg : null);
        const pct = refOld != null && refOld > price ? Math.round(100 * (1 - price / refOld)) : null;
        const hitTarget = row.target_price != null && price <= row.target_price;
        const hitAvgDrop = prevCnt >= 2 && prevAvg != null && price <= prevAvg * (1 - row.min_drop_pct / 100);
        const hitListDrop = pct != null && pct >= row.min_drop_pct;

        if (hitTarget || hitAvgDrop || hitListDrop) {
          const isLowest = prevCnt >= 2 && prevMin != null && price < prevMin;
          const isPriceError = (pct != null && pct >= 50) || (prevCnt >= 2 && prevAvg != null && price <= prevAvg * 0.5);
          triggeredDeals.push({
            threadId: -(600_000_000 + asinHash(asin)),
            source: "watchlist",
            sourceUrl: `https://www.amazon.de/dp/${asin}`,
            asin,
            amzTitle: r.title ?? row.title ?? `Amazon ${asin}`,
            amzImage: r.image ?? row.image,
            mdTitle: r.title ?? row.title ?? `Amazon ${asin}`,
            brand: r.brand ?? row.brand,
            price,
            oldPrice: refOld,
            percentage: pct,
            publishedAt: now,
            isExpired: 0,
            isPriceError,
            isLowest,
          });
        }
      }
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }

  let triggered = 0;
  if (triggeredDeals.length > 0) {
    const up = upsertDeals(triggeredDeals);
    triggered = up.count;
  }
  return { checked, triggered };
}
