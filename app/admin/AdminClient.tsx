"use client";

import { useState, useCallback, useEffect } from "react";
import type { AdminStats, AppSettings, CrawlRunRow, DealRow } from "@/lib/db";

type AdminPayload = {
  stats: AdminStats;
  settings: AppSettings;
  runs: CrawlRunRow[];
  deals: DealRow[];
  crawling: boolean;
};

const eur = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function fmtTime(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ago(ts: number | null) {
  if (!ts) return "chưa có";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.round(s / 60)} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

function fmtBytes(bytes: number) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AdminClient({ initial }: { initial: AdminPayload }) {
  const [data, setData] = useState<AdminPayload>(initial);
  const [form, setForm] = useState<AppSettings>(initial.settings);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(
    async (opts?: { q?: string; filter?: string }) => {
      const nextQ = opts?.q ?? q;
      const nextFilter = opts?.filter ?? filter;
      const p = new URLSearchParams();
      if (nextQ.trim()) p.set("q", nextQ.trim());
      if (nextFilter !== "all") p.set("filter", nextFilter);
      const res = await fetch(`/api/admin?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as AdminPayload;
      setData(json);
    },
    [q, filter],
  );

  // Poll gently while a server crawl is active
  useEffect(() => {
    if (!data.crawling) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [data.crawling, refresh]);

  const showMsg = (type: "ok" | "err", text: string) => setNotice({ type, text });

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setForm(json.settings);
      showMsg("ok", json.message || "Đã lưu cấu hình.");
      await refresh();
    } catch (err) {
      showMsg("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(
    action: string,
    extra: Record<string, unknown> = {},
    confirmText?: string,
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      showMsg(json.ok === false ? "err" : "ok", json.message || "Hoàn tất.");
      await refresh();
    } catch (err) {
      showMsg("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void refresh({ q, filter });
  }

  const { stats, runs, deals, settings, crawling } = data;

  return (
    <main className="admin-page">
      <header className="admin-head">
        <div className="brand">
          <h1>Quản trị Amazon Deals</h1>
          <span className="meta">
            Tự động giữ dữ liệu <strong>{settings.retentionDays} ngày</strong> · dọn dẹp tự động mỗi 30 phút
          </span>
        </div>
        <div className="admin-nav">
          <a className="btn btn-ghost" href="/">← Xem trang Deals</a>
          <button className="btn" type="button" disabled={busy} onClick={() => void refresh()}>
            Làm mới
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.type === "err" ? "notice-err" : "notice-ok"}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Đóng">×</button>
        </div>
      )}

      <section className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Tổng deal trong kho</div>
          <div className="kpi-val">{stats.total}</div>
          <div className="kpi-sub">Còn hạn: {stats.active} · Hết hạn: {stats.expired}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Đã map Amazon</div>
          <div className="kpi-val">{stats.withAsin}</div>
          <div className="kpi-sub">Có tên AMZ: {stats.withAmzTitle} · Không ASIN: {stats.noAsin}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Quá hạn giữ (&gt; {settings.retentionDays} ngày)</div>
          <div className="kpi-val">{stats.olderThanRetention}</div>
          <div className="kpi-sub">Cũ nhất: {fmtTime(stats.oldestAt)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Cập nhật thành công gần nhất</div>
          <div className="kpi-val kpi-sm">{stats.lastOk ? ago(stats.lastOk.at) : "Chưa có"}</div>
          <div className="kpi-sub">
            {stats.lastOk ? `${fmtTime(stats.lastOk.at)} (${stats.lastOk.source})` : "Chưa có dữ liệu"}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Dung lượng SQLite</div>
          <div className="kpi-val kpi-sm">{fmtBytes(stats.dbSizeBytes)}</div>
          <div className="kpi-sub">Mới nhất: {fmtTime(stats.newestAt)}</div>
        </div>
      </section>

      <section className="admin-two-col">
        <form className="panel" onSubmit={saveSettings}>
          <h2>Cấu hình tự động &amp; Lưu trữ</h2>
          <div className="field-grid">
            <label className="field">
              <span>Số ngày giữ dữ liệu (tự xoá sau N ngày)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={form.retentionDays}
                onChange={(e) => setForm({ ...form, retentionDays: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Số trang mydealz mỗi lần lấy</span>
              <input
                type="number"
                min={1}
                max={20}
                value={form.crawlPages}
                onChange={(e) => setForm({ ...form, crawlPages: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Chu kỳ crawl trên server (phút)</span>
              <input
                type="number"
                min={15}
                max={1440}
                value={form.crawlIntervalMin}
                onChange={(e) => setForm({ ...form, crawlIntervalMin: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              <span>Amazon Affiliate Tag (tuỳ chọn)</span>
              <input
                type="text"
                placeholder="vd: mytag-21"
                value={form.amazonTag}
                onChange={(e) => setForm({ ...form, amazonTag: e.target.value })}
              />
            </label>
          </div>
          <label className="chk" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={form.serverCrawlEnabled}
              onChange={(e) => setForm({ ...form, serverCrawlEnabled: e.target.checked })}
            />
            Bật auto crawl ngay trên server (tắt nếu IP VPS bị mydealz chặn 403 và đang dùng máy Mac push 2 giờ/lần)
          </label>
          <div className="panel-foot">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Lưu cấu hình
            </button>
            <span className="meta">
              Script <code>scripts/push.mjs</code> sẽ tự đồng bộ số ngày giữ ({form.retentionDays}d) và số trang ({form.crawlPages}) từ cấu hình này.
            </span>
          </div>
        </form>

        <div className="panel">
          <h2>Thao tác nhanh</h2>
          <div className="action-list">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runAction("prune")}
            >
              Xoá deal cũ (&gt; {settings.retentionDays} ngày) ngay
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runAction("prune_expired")}
            >
              Xoá tất cả deal đã hết hạn ({stats.expired})
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runAction("reset_no_asin")}
            >
              Reset cờ thiếu ASIN ({stats.noAsin}) để thử lại
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || crawling}
              onClick={() => void runAction("crawl_now")}
            >
              {crawling ? "Đang crawl trên server…" : "Chạy crawl trên server ngay"}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void runAction(
                  "clear_all",
                  {},
                  `Bạn chắc chắn muốn xoá toàn bộ ${stats.total} deal trong kho?`,
                )
              }
            >
              Xoá toàn bộ deals
            </button>
          </div>
          <div className="info-box">
            <strong>Lịch auto 2 tiếng/lần trên máy Mac:</strong>
            <div>
              Chạy <code>npm run auto:install</code> để cài LaunchAgent (<code>StartInterval = 7200s</code>),
              xem log bằng <code>npm run auto:logs</code>.
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Quản lý Deals ({deals.length})</h2>
          <form className="admin-search" onSubmit={handleSearch}>
            <input
              type="search"
              placeholder="Tìm tên, ASIN, thread ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              value={filter}
              onChange={(e) => {
                const next = e.target.value;
                setFilter(next);
                void refresh({ q, filter: next });
              }}
            >
              <option value="all">Tất cả</option>
              <option value="active">Còn hạn</option>
              <option value="expired">Đã hết hạn</option>
              <option value="no_asin">Thiếu ASIN</option>
            </select>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Lọc
            </button>
          </form>
        </div>

        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Deal</th>
                <th>ASIN</th>
                <th>Giá</th>
                <th>Nhiệt</th>
                <th>Đăng lúc</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {deals.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Không có deal nào khớp bộ lọc.
                  </td>
                </tr>
              )}
              {deals.map((d) => {
                const img = d.amz_image || d.md_image;
                const amzHref = d.asin ? `https://www.amazon.de/dp/${d.asin}` : null;
                const mdHref = `https://www.mydealz.de/deals/${d.slug ? d.slug + "-" : ""}${d.thread_id}`;
                return (
                  <tr key={d.thread_id} className={d.is_expired ? "row-expired" : ""}>
                    <td>
                      <div className="deal-cell">
                        {img && <img className="thumb" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                        <div className="deal-cell-txt">
                          <a href={amzHref || mdHref} target="_blank" rel="noopener noreferrer" className="deal-cell-title">
                            {d.amz_title || d.md_title}
                          </a>
                          <div className="meta">
                            #{d.thread_id} ·{" "}
                            <a href={mdHref} target="_blank" rel="noopener noreferrer">
                              mydealz
                            </a>
                            {d.voucher_code ? ` · Code: ${d.voucher_code}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {d.asin ? (
                        <a href={amzHref!} target="_blank" rel="noopener noreferrer">
                          <code>{d.asin}</code>
                        </a>
                      ) : d.no_asin ? (
                        <span className="pill pill-warn">no_asin</span>
                      ) : (
                        <span className="muted">chưa có</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <strong>{eur(d.price)}</strong>
                      {d.old_price != null && d.old_price > (d.price ?? 0) && (
                        <div className="meta"><s>{eur(d.old_price)}</s></div>
                      )}
                    </td>
                    <td className="nowrap">{d.temperature}°</td>
                    <td className="nowrap">
                      <div>{fmtTime(d.published_at || d.first_seen)}</div>
                      <div className="meta">{ago(d.published_at || d.first_seen)}</div>
                    </td>
                    <td className="nowrap">
                      {d.is_expired ? (
                        <span className="pill pill-muted">Hết hạn</span>
                      ) : (
                        <span className="pill pill-ok">Còn hạn</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-sm"
                          disabled={busy}
                          onClick={() =>
                            void runAction("toggle_expired", {
                              threadId: d.thread_id,
                              expired: !d.is_expired,
                            })
                          }
                        >
                          {d.is_expired ? "Hiện lại" : "Hết hạn"}
                        </button>
                        {!d.asin && d.no_asin ? (
                          <button
                            type="button"
                            className="btn-sm"
                            disabled={busy}
                            onClick={() => void runAction("reset_no_asin", { threadId: d.thread_id })}
                          >
                            Thử ASIN
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="btn-sm btn-sm-danger"
                          disabled={busy}
                          onClick={() => void runAction("delete_deal", { threadId: d.thread_id })}
                        >
                          Xoá
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Lịch sử Crawl / Push / Dọn dẹp (30 lần gần nhất)</h2>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Nguồn</th>
                <th>Trạng thái</th>
                <th>Tổng / Mới</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 20 }}>
                    Chưa có lịch sử chạy.
                  </td>
                </tr>
              )}
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">
                    <div>{fmtTime(r.at)}</div>
                    <div className="meta">{ago(r.at)}</div>
                  </td>
                  <td className="nowrap"><code>{r.source}</code></td>
                  <td className="nowrap">
                    {r.ok ? <span className="pill pill-ok">OK</span> : <span className="pill pill-err">Lỗi</span>}
                  </td>
                  <td className="nowrap">
                    {r.count} / +{r.new}
                  </td>
                  <td className="run-msg">{r.message || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
