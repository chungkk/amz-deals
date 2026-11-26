import { pruneOldDeals, recordRun, sanitizeSettingsForClient, updateSettings, type SettingsUpdatePatch } from "@/lib/db";
import { rescheduleScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as (SettingsUpdatePatch & { pruneNow?: boolean }) | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const settings = updateSettings({
    retentionDays: body.retentionDays,
    crawlPages: body.crawlPages,
    crawlIntervalMin: body.crawlIntervalMin,
    serverCrawlEnabled: body.serverCrawlEnabled,
    amazonTag: body.amazonTag,
    enableMydealz: body.enableMydealz,
    enableMeindeal: body.enableMeindeal,
    enableMonsterdealz: body.enableMonsterdealz,
    enableDealdoktor: body.enableDealdoktor,
    enableCamel: body.enableCamel,
    enablePaapiSearch: body.enablePaapiSearch,
    enableKeepa: body.enableKeepa,
    enableWatchlist: body.enableWatchlist,
    watchlistAutoHarvest: body.watchlistAutoHarvest,
    paapiAccessKey: body.paapiAccessKey,
    paapiSecretKey: body.paapiSecretKey,
    clearPaapiSecret: body.clearPaapiSecret,
    paapiKeywords: body.paapiKeywords,
    paapiMinSavingPct: body.paapiMinSavingPct,
    keepaApiKey: body.keepaApiKey,
    clearKeepaKey: body.clearKeepaKey,
    keepaMinDropPct: body.keepaMinDropPct,
  });

  rescheduleScheduler();

  let pruned = 0;
  if (body.pruneNow !== false) {
    pruned = pruneOldDeals(settings.retentionDays);
    if (pruned > 0) {
      recordRun("admin-cleanup", true, 0, 0, `Xoá ${pruned} deal cũ hơn ${settings.retentionDays} ngày`);
    }
  }

  return Response.json({
    ok: true,
    settings: sanitizeSettingsForClient(settings),
    pruned,
    message:
      pruned > 0
        ? `Đã lưu cấu hình và xoá ${pruned} deal cũ hơn ${settings.retentionDays} ngày.`
        : "Đã lưu cấu hình.",
  });
}
