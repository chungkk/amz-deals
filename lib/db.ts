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
      last_seen     INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deals_published ON deals(published_at DESC);
    CREATE INDEX IF NOT EXISTS deals_asin ON deals(asin);
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

  // Safe migration for existing databases created before multi-source support
  const cols = new Set(
    (d.prepare("PRAGMA table_info(deals)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!cols.has("source")) {
    d.exec("ALTER TABLE deals ADD COLUMN source TEXT NOT NULL DEFAULT 'mydealz'");
  }
  if (!cols.has("source_url")) {
    d.exec("ALTER TABLE deals ADD COLUMN source_url TEXT");
  }
  d.exec("CREATE INDEX IF NOT EXISTS deals_source ON deals(source)");

  g.__dealsDb = d;
  return d;
}

export type DealSource = "mydealz" | "meindeal";

export type AppSettings = {
  retentionDays: number;
  crawlPages: number;
  crawlIntervalMin: number;
  serverCrawlEnabled: boolean;
  amazonTag: string;
  enableMydealz: boolean;
  enableMeindeal: boolean;
};

const clamp = (v: number, min: number, max: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function envDefaults(): AppSettings {
  const envInterval = Number(process.env.CRAWL_INTERVAL_MIN || 0);
  return {
    retentionDays: clamp(Number(process.env.RETENTION_DAYS || 2), 1, 90, 2),
    crawlPages: clamp(Number(process.env.CRAWL_PAGES || 3), 1, 20, 3),
    crawlIntervalMin: envInterval > 0 ? clamp(envInterval, 15, 1440, 120) : 120,
    serverCrawlEnabled: envInterval > 0,
    amazonTag: (process.env.AMAZON_TAG || "").trim(),
    enableMydealz: true,
    enableMeindeal: true,
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
  };
}

export function getEnabledSources(s: AppSettings = getSettings()): DealSource[] {
  const out: DealSource[] = [];
  if (s.enableMydealz) out.push("mydealz");
  if (s.enableMeindeal) out.push("meindeal");
  return out;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const cur = getSettings();
  const next: AppSettings = {
    retentionDays: patch.retentionDays !== undefined ? clamp(Number(patch.retentionDays), 1, 90, cur.retentionDays) : cur.retentionDays,
    crawlPages: patch.crawlPages !== undefined ? clamp(Number(patch.crawlPages), 1, 20, cur.crawlPages) : cur.crawlPages,
    crawlIntervalMin:
      patch.crawlIntervalMin !== undefined ? clamp(Number(patch.crawlIntervalMin), 15, 1440, cur.crawlIntervalMin) : cur.crawlIntervalMin,
    serverCrawlEnabled: patch.serverCrawlEnabled !== undefined ? Boolean(patch.serverCrawlEnabled) : cur.serverCrawlEnabled,
    amazonTag: patch.amazonTag !== undefined ? String(patch.amazonTag).trim().slice(0, 100) : cur.amazonTag,
    enableMydealz: patch.enableMydealz !== undefined ? Boolean(patch.enableMydealz) : cur.enableMydealz,
    enableMeindeal: patch.enableMeindeal !== undefined ? Boolean(patch.enableMeindeal) : cur.enableMeindeal,
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

const n = <T extends string | number>(v: T | null | undefined): T | null => (v === undefined ? null : v);

export function upsertDeals(deals: DealIn[]): { count: number; added: number; skippedOld: number } {
  const d = db();
  const now = Math.floor(Date.now() / 1000);
  const { retentionDays } = getSettings();
  const cutoff = now - retentionDays * 86400;

  const exists = d.prepare("SELECT 1 FROM deals WHERE thread_id = ?");
  const stmt = d.prepare(`
    INSERT INTO deals (thread_id, source, source_url, asin, no_asin, amz_title, amz_image, md_title, md_image, slug, price, old_price,
      percentage, temperature, published_at, hot_date, is_expired, comment_count, voucher_code, first_seen, last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(thread_id) DO UPDATE SET
      source = excluded.source,
      source_url = COALESCE(excluded.source_url, deals.source_url),
      asin = COALESCE(excluded.asin, deals.asin),
      no_asin = CASE WHEN excluded.asin IS NOT NULL THEN 0 ELSE MAX(deals.no_asin, excluded.no_asin) END,
      amz_title = COALESCE(excluded.amz_title, deals.amz_title),
      amz_image = COALESCE(excluded.amz_image, deals.amz_image),
      md_title = excluded.md_title, md_image = COALESCE(excluded.md_image, deals.md_image), slug = excluded.slug,
      price = excluded.price, old_price = excluded.old_price, percentage = excluded.percentage,
      temperature = excluded.temperature, published_at = excluded.published_at, hot_date = excluded.hot_date,
      is_expired = excluded.is_expired, comment_count = excluded.comment_count,
      voucher_code = excluded.voucher_code, last_seen = excluded.last_seen
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
      const src = x.source === "meindeal" ? "meindeal" : "mydealz";
      stmt.run(
        x.threadId, src, n(x.sourceUrl), n(x.asin), x.noAsin ? 1 : 0, n(x.amzTitle), n(x.amzImage), x.mdTitle, n(x.mdImage), n(x.slug),
        n(x.price), n(x.oldPrice), n(x.percentage), x.temperature ?? 0, n(x.publishedAt), n(x.hotDate),
        x.isExpired ? 1 : 0, x.commentCount ?? 0, n(x.voucherCode), now, now,
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

/** Delete deals older than retentionDays (based on published_at, falling back to first_seen). */
export function pruneOldDeals(retentionDays?: number): number {
  const days = retentionDays ?? getSettings().retentionDays;
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const res = db().prepare("DELETE FROM deals WHERE COALESCE(published_at, first_seen) < ?").run(cutoff);
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
  olderThanRetention: number;
  oldestAt: number | null;
  newestAt: number | null;
  dbSizeBytes: number;
  bySource: { mydealz: number; meindeal: number };
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
        SUM(CASE WHEN COALESCE(published_at, first_seen) < ? THEN 1 ELSE 0 END) AS older_than_retention,
        SUM(CASE WHEN source = 'mydealz' THEN 1 ELSE 0 END) AS src_mydealz,
        SUM(CASE WHEN source = 'meindeal' THEN 1 ELSE 0 END) AS src_meindeal,
        MIN(COALESCE(published_at, first_seen)) AS oldest_at,
        MAX(COALESCE(published_at, first_seen)) AS newest_at
      FROM deals`,
    )
    .get(cutoff) as Record<string, number | null>;

  const pageCount = (d.prepare("PRAGMA page_count").get() as { page_count?: number } | undefined)?.page_count ?? 0;
  const pageSize = (d.prepare("PRAGMA page_size").get() as { page_size?: number } | undefined)?.page_size ?? 0;
  const dbSizeBytes = Number(pageCount) * Number(pageSize);

  const lastOk =
    (d.prepare("SELECT at, source FROM crawl_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as
      | { at: number; source: string }
      | undefined) ?? null;
  const lastRun =
    (d.prepare("SELECT id, at, source, ok, count, new, message FROM crawl_runs ORDER BY id DESC LIMIT 1").get() as
      | CrawlRunRow
      | undefined) ?? null;

  return {
    total: Number(row.total ?? 0),
    active: Number(row.active ?? 0),
    expired: Number(row.expired ?? 0),
    withAsin: Number(row.with_asin ?? 0),
    noAsin: Number(row.no_asin ?? 0),
    withAmzTitle: Number(row.with_amz_title ?? 0),
    olderThanRetention: Number(row.older_than_retention ?? 0),
    oldestAt: row.oldest_at ?? null,
    newestAt: row.newest_at ?? null,
    dbSizeBytes,
    bySource: {
      mydealz: Number(row.src_mydealz ?? 0),
      meindeal: Number(row.src_meindeal ?? 0),
    },
    lastOk,
    lastRun,
  };
}

export function getRecentRuns(limit = 30): CrawlRunRow[] {
  return db()
    .prepare("SELECT id, at, source, ok, count, new, message FROM crawl_runs ORDER BY id DESC LIMIT ?")
    .all(limit) as CrawlRunRow[];
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
  if (source === "mydealz" || source === "meindeal") {
    where.push("source = ?");
    args.push(source);
  }
  if (q.trim()) {
    where.push("(COALESCE(amz_title,'') || ' ' || md_title || ' ' || COALESCE(asin,'') || ' ' || CAST(thread_id AS TEXT)) LIKE ?");
    args.push(`%${q.trim()}%`);
  }
  const sql = `SELECT * FROM deals ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY COALESCE(published_at, first_seen) DESC LIMIT ?`;
  args.push(clamp(limit, 1, 500, 100));
  return db().prepare(sql).all(...args) as DealRow[];
}
