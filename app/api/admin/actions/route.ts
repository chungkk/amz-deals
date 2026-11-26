import {
  addToWatchlist,
  clearAllDeals,
  clearWatchlist,
  deleteDeal,
  extractAsinsFromText,
  getSettings,
  harvestExistingDealsToWatchlist,
  pruneExpiredDeals,
  pruneOldDeals,
  recordRun,
  removeFromWatchlist,
  resetNoAsin,
  setDealExpired,
} from "@/lib/db";
import { isCrawlRunning, runCrawl, runPriceCheck, runWatchlistCheck } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

type ActionPayload = {
  action?: string;
  threadId?: number;
  expired?: boolean;
  text?: string;
  asin?: string;
  targetPrice?: number | null;
  minDropPct?: number;
  note?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as ActionPayload | null;
  const action = body?.action;
  if (!action) return Response.json({ error: "action required" }, { status: 400 });

  switch (action) {
    case "prune": {
      const { retentionDays } = getSettings();
      const deleted = pruneOldDeals(retentionDays);
      if (deleted > 0) {
        recordRun("admin-cleanup", true, 0, 0, `Xoá thủ công ${deleted} deal cũ hơn ${retentionDays} ngày`);
      }
      return Response.json({
        ok: true,
        deleted,
        message:
          deleted > 0
            ? `Đã xoá ${deleted} deal cũ hơn ${retentionDays} ngày.`
            : `Không có deal nào cũ hơn ${retentionDays} ngày.`,
      });
    }

    case "prune_expired": {
      const deleted = pruneExpiredDeals();
      if (deleted > 0) {
        recordRun("admin-cleanup", true, 0, 0, `Xoá ${deleted} deal đã hết hạn`);
      }
      return Response.json({
        ok: true,
        deleted,
        message: deleted > 0 ? `Đã xoá ${deleted} deal đã hết hạn.` : "Không có deal hết hạn nào.",
      });
    }

    case "reset_no_asin": {
      const threadId = typeof body.threadId === "number" ? body.threadId : undefined;
      const updated = resetNoAsin(threadId);
      return Response.json({
        ok: true,
        updated,
        message:
          updated > 0
            ? `Đã reset cờ no_asin cho ${updated} deal (sẽ thử lấy lại ở lần crawl tới).`
            : "Không có deal nào cần reset.",
      });
    }

    case "clear_all": {
      const deleted = clearAllDeals();
      recordRun("admin-clear", true, 0, 0, `Xoá toàn bộ ${deleted} deal`);
      return Response.json({ ok: true, deleted, message: `Đã xoá toàn bộ ${deleted} deal.` });
    }

    case "delete_deal": {
      if (!Number.isInteger(body.threadId)) {
        return Response.json({ error: "threadId required" }, { status: 400 });
      }
      const deleted = deleteDeal(body.threadId!);
      return Response.json({ ok: true, deleted, message: deleted ? `Đã xoá deal #${body.threadId}.` : "Không tìm thấy deal." });
    }

    case "toggle_expired": {
      if (!Number.isInteger(body.threadId)) {
        return Response.json({ error: "threadId required" }, { status: 400 });
      }
      const expired = Boolean(body.expired);
      setDealExpired(body.threadId!, expired);
      return Response.json({
        ok: true,
        message: expired ? `Đã đánh dấu deal #${body.threadId} là hết hạn.` : `Đã khôi phục deal #${body.threadId}.`,
      });
    }

    case "crawl_now": {
      if (isCrawlRunning()) {
        return Response.json({ ok: false, running: true, message: "Crawler trên server đang chạy, vui lòng đợi." });
      }
      void runCrawl("admin");
      return Response.json({
        ok: true,
        started: true,
        message: "Đã kích hoạt crawl trên server. Kết quả sẽ hiện trong lịch sử sau ít phút.",
      });
    }

    case "check_prices": {
      const res = await runPriceCheck("admin-price-check");
      if (!res.ok) {
        return Response.json({ ok: false, error: res.error, message: res.error }, { status: 400 });
      }
      return Response.json({
        ...res,
        message: `Đã kiểm tra ${res.checked} ASIN qua PA-API: cập nhật ${res.updated}, hết hạn ${res.expired}.`,
      });
    }

    case "watchlist_add": {
      const asins = extractAsinsFromText(String(body.text || ""));
      if (asins.length === 0) {
        return Response.json(
          { ok: false, error: "Không tìm thấy ASIN hợp lệ nào (hỗ trợ link amazon.de/dp/... hoặc mã B0...)." },
          { status: 400 },
        );
      }
      const targetPrice =
        typeof body.targetPrice === "number" && Number.isFinite(body.targetPrice) && body.targetPrice > 0
          ? body.targetPrice
          : null;
      const minDropPct = typeof body.minDropPct === "number" ? body.minDropPct : 20;
      const note = body.note ? String(body.note).trim() : null;
      const r = addToWatchlist(asins.map((asin) => ({ asin, targetPrice, minDropPct, note })));
      return Response.json({
        ok: true,
        ...r,
        message: `Đã thêm ${r.added} ASIN mới${r.updated ? `, cập nhật ${r.updated} ASIN` : ""} vào Watchlist.`,
      });
    }

    case "watchlist_remove": {
      const asin = String(body.asin || "").trim().toUpperCase();
      if (!asin) return Response.json({ error: "asin required" }, { status: 400 });
      const deleted = removeFromWatchlist(asin);
      return Response.json({ ok: true, deleted, message: deleted ? `Đã xoá ${asin} khỏi Watchlist.` : "Không tìm thấy ASIN." });
    }

    case "watchlist_clear": {
      const deleted = clearWatchlist();
      return Response.json({ ok: true, deleted, message: `Đã xoá toàn bộ ${deleted} ASIN trong Watchlist.` });
    }

    case "watchlist_harvest": {
      const { paapiKeywords } = getSettings();
      const added = harvestExistingDealsToWatchlist(paapiKeywords);
      return Response.json({
        ok: true,
        added,
        message:
          added > 0
            ? `Đã tự gom thêm ${added} ASIN theo danh sách brand/từ khoá vào Watchlist.`
            : "Không có thêm ASIN brand mới nào (hoặc đã có sẵn trong Watchlist).",
      });
    }

    case "watchlist_check": {
      const res = await runWatchlistCheck("admin-watchlist");
      return Response.json(res);
    }

    default:
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }
}
