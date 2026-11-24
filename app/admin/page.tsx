import { getAdminStats, getRecentRuns, getSettings, listDealsAdmin } from "@/lib/db";
import { isCrawlRunning } from "@/lib/scheduler";
import AdminClient from "./AdminClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Quản trị · Amazon Deals",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  const initial = {
    stats: getAdminStats(),
    settings: getSettings(),
    runs: getRecentRuns(30),
    deals: listDealsAdmin({ limit: 100 }),
    crawling: isCrawlRunning(),
  };
  return <AdminClient initial={initial} />;
}
