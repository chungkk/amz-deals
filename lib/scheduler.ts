import { crawl } from "./crawler.mjs";
import { getEnabledSources, getSettings, knownMap, pruneOldDeals, recordRun, upsertDeals, type DealIn } from "./db";

type SchedulerState = {
  running: boolean;
  started: boolean;
  crawlTimer?: ReturnType<typeof setInterval>;
  startupTimer?: ReturnType<typeof setTimeout>;
  pruneTimer?: ReturnType<typeof setInterval>;
};

const g = globalThis as unknown as { __amzScheduler?: SchedulerState };
const state: SchedulerState = (g.__amzScheduler ??= { running: false, started: false });

export function isCrawlRunning(): boolean {
  return state.running;
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
  const logs: string[] = [];
  try {
    const settings = getSettings();
    const sources = getEnabledSources(settings);
    if (sources.length === 0) {
      recordRun(source, false, 0, 0, "Chưa bật nguồn crawl nào (mydealz / mein-deal)");
      return { ok: false, error: "No sources enabled" };
    }
    const deals = (await crawl({
      pages: settings.crawlPages,
      maxAgeDays: settings.retentionDays,
      sources,
      known: knownMap(),
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
  }
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
