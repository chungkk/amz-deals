import { getSettings, pruneOldDeals, recordRun, upsertDeals, type DealIn } from "@/lib/db";

export const dynamic = "force-dynamic";

// Receives deals crawled elsewhere (scripts/push.mjs). The whole site sits behind Traefik basic auth;
// INGEST_TOKEN is an extra check for this write endpoint.
export async function POST(req: Request) {
  const token = process.env.INGEST_TOKEN;
  if (token && req.headers.get("x-ingest-token") !== token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { source?: string; deals?: DealIn[]; message?: string } | null;
  if (!body || !Array.isArray(body.deals)) return Response.json({ error: "deals[] required" }, { status: 400 });

  const { retentionDays } = getSettings();
  const r = upsertDeals(body.deals);
  const pruned = pruneOldDeals(retentionDays);
  const parts = [body.message?.trim(), pruned > 0 ? `pruned ${pruned} old (>${retentionDays}d)` : ""].filter(Boolean);
  recordRun(String(body.source || "push").slice(0, 40), true, r.count, r.added, parts.join("; ").slice(0, 2000));
  return Response.json({ ...r, pruned, retentionDays });
}
