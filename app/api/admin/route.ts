import { getAdminStats, getRecentRuns, getSettings, listDealsAdmin } from "@/lib/db";
import { isCrawlRunning } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const filter = url.searchParams.get("filter") ?? "all";
  const source = url.searchParams.get("source") ?? "all";
  const limit = Number(url.searchParams.get("limit") || 100);

  return Response.json({
    stats: getAdminStats(),
    settings: getSettings(),
    runs: getRecentRuns(30),
    deals: listDealsAdmin({ q, filter, source, limit }),
    crawling: isCrawlRunning(),
  });
}
