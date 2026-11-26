import { crawl } from "./crawler.mjs";
import {
  applyPriceChecks,
  getEnabledSources,
  getSettings,
  knownMap,
  listActiveDealsWithAsin,
  pruneOldDeals,
  recordRun,
  upsertDeals,
  type DealIn,
} from "./db";
import { getItemsByAsin, hasPaApiCreds } from "./paapi.mjs";

type SchedulerState = {
  running: boolean;
  started: boolean;
  progress: string;
  crawlTimer?: ReturnType<typeof setInterval>;
  startupTimer?: ReturnType<typeof setTimeout>;
  pruneTimer?: ReturnType<typeof setInterval>;
};

const g = globalThis as unknown as { __amzScheduler?: SchedulerState };
const state: SchedulerState = (g.__amzScheduler ??= { running: false, started: false, progress: "" });

export function isCrawlRunning(): boolean {
  return state.running;
}

export function getCrawlProgress(): string {
  return state.running ? state.progress : "";
}

export function runPrune(source = "cleanup"): number {
  const { retentionDays } = getSettings();
  const pruned = pruneOldDeals(retentionDays);
  if (pruned > 0) {
    console.log(`[cleanup] deleted ${pruned} deal(s) older than ${retentionDays}d`);
    recordRun(source, true, 0, 0, `Xoá ${pruned} deal cũ hơn ${retentionDays} ngày`);
  }
  return pruned;
}

export async function runCrawl(source = "server") {
  if (state.running) return { skipped: true };
  state.running = true;
  state.progress = "Đang khởi tạo crawl…";
  const logs: string[] = [];
  try {
    const settings = getSettings();
    const sources = getEnabledSources(settings);
    if (sources.length === 0) {
      recordRun(source, false, 0, 0, "Chưa bật nguồn crawl nào");
      return { ok: false, error: "No sources enabled" };
    }
    const deals = (await crawl({
      pages: settings.crawlPages,
      maxAgeDays: settings.retentionDays,
      sources,
      known: knownMap(),
      paapi: {
        accessKey: settings.paapiAccessKey,
        secretKey: settings.paapiSecretKey,
        partnerTag: settings.amazonTag,
        keywords: settings.paapiKeywords,
        minSavingPct: settings.paapiMinSavingPct,
      },
      keepa: {
        apiKey: settings.keepaApiKey,
        minDropPct: settings.keepaMinDropPct,
      },
      onProgress: (m: string) => {
        state.progress = m;
      },
      log: (m: string) => (logs.push(m), console.log(`[crawl] ${m}`)),
    })) as DealIn[];
    const r = upsertDeals(deals);
    const pruned = pruneOldDeals(settings.retentionDays);
    if (pruned > 0) logs.push(`pruned ${pruned} old deal(s)`);
    recordRun(source, true, r.count, r.added, logs.join("; "));
    return { ok: true, ...r, pruned };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[crawl] failed: ${msg}`);
    recordRun(source, false, 0, 0, msg);
    return { ok: false, error: msg };
  } finally {
    state.running = false;
    state.progress = "";
  }
}

export async function runPriceCheck(source = "price-check") {
  const settings = getSettings();
  const creds = {
    accessKey: settings.paapiAccessKey,
    secretKey: settings.paapiSecretKey,
    partnerTag: settings.amazonTag,
  };
  if (!hasPaApiCreds(creds)) {
    return { ok: false, error: "Chưa cấu hình đầy đủ Amazon PA-API (Access Key, Secret Key, Affiliate Tag)." };
  }
  const activeDeals = listActiveDealsWithAsin(150);
  if (activeDeals.length === 0) {
    return { ok: true, checked: 0, updated: 0, expired: 0, message: "Không có deal active nào có ASIN để kiểm tra." };
  }
  const logs: string[] = [];
  const itemsMap = await getItemsByAsin(
    activeDeals.map((d) => d.asin),
    creds,
    { log: (m: string) => (logs.push(m), console.log(`[price-check] ${m}`)) },
  );
  const updates = [];
  for (const d of activeDeals) {
    const item = itemsMap.get(d.asin.toUpperCase());
    if (!item) continue;
    updates.push({
      threadId: d.thread_id,
      asin: d.asin,
      price: item.price,
      oldPrice: item.oldPrice,
      percentage: item.percentage,
      inStock: item.inStock,
      title: item.title,
      image: item.image,
      brand: item.brand,
    });
  }
  const res = applyPriceChecks(updates);
  const msg = `Checked ${res.checked}/${activeDeals.length} ASINs, updated ${res.updated}, marked expired ${res.expired}${logs.length ? ` (${logs.join("; ")})` : ""}`;
  recordRun(source, true, res.checked, 0, msg);
  return { ok: true, ...res, message: msg };
}

export function rescheduleScheduler() {
  if (state.crawlTimer) clearInterval(state.crawlTimer);
  if (state.startupTimer) clearTimeout(state.startupTimer);
  state.crawlTimer = undefined;
  state.startupTimer = undefined;

  const settings = getSettings();
  const sources = getEnabledSources(settings);
  if (settings.serverCrawlEnabled && settings.crawlIntervalMin > 0) {
    console.log(
      `[crawl] server scheduler enabled: every ${settings.crawlIntervalMin} min (retention ${settings.retentionDays}d, sources: ${sources.join(",") || "none"})`,
    );
    state.crawlTimer = setInterval(() => void runCrawl("server"), settings.crawlIntervalMin * 60_000);
  } else {
    console.log(`[crawl] server scheduler disabled (auto-prune active every 30 min, retention ${settings.retentionDays}d)`);
  }
}

export function startScheduler() {
  if (state.started) return;
  state.started = true;

  // Always prune old deals (> retentionDays, default 2 days) on boot and every 30 min
  setTimeout(() => runPrune("cleanup"), 5_000);
  state.pruneTimer = setInterval(() => runPrune("cleanup"), 30 * 60_000);

  rescheduleScheduler();
  const { serverCrawlEnabled, crawlIntervalMin } = getSettings();
  if (serverCrawlEnabled && crawlIntervalMin > 0) {
    state.startupTimer = setTimeout(() => void runCrawl("server"), 10_000);
  }
}
