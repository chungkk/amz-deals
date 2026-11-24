import { getEnabledSources, getSettings, knownMap } from "@/lib/db";

export const dynamic = "force-dynamic";

export function GET() {
  const s = getSettings();
  return Response.json({
    known: [...knownMap()],
    settings: {
      retentionDays: s.retentionDays,
      crawlPages: s.crawlPages,
      sources: getEnabledSources(s),
    },
  });
}
