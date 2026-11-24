import { pruneOldDeals, recordRun, updateSettings, type AppSettings } from "@/lib/db";
import { rescheduleScheduler } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as (Partial<AppSettings> & { pruneNow?: boolean }) | null;
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
    settings,
    pruned,
    message:
      pruned > 0
        ? `Đã lưu cấu hình và xoá ${pruned} deal cũ hơn ${settings.retentionDays} ngày.`
        : "Đã lưu cấu hình.",
  });
}
