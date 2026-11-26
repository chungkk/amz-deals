import { getAdminStats, getRecentRuns, getSettings, listDealsAdmin, listWatchlist, sanitizeSettingsForClient } from "@/lib/db";
import { getCrawlProgress, isCrawlRunning } from "@/lib/scheduler";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quản trị · Amazon Deals",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  const initial = {
    stats: getAdminStats(),
    settings: sanitizeSettingsForClient(getSettings()),
    runs: getRecentRuns(30),
    deals: listDealsAdmin({ limit: 100 }),
    watchlist: listWatchlist({ limit: 150 }),
    crawling: isCrawlRunning(),
    crawlProgress: getCrawlProgress(),
  };
  return <AdminClient initial={initial} />;
}
