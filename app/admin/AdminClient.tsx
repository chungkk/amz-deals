"use client";

import { useState, useCallback, useEffect } from "react";
import type { AdminStats, CrawlRunRow, DealRow, PublicAppSettings, WatchlistRow } from "@/lib/db";
import { CopyAffButtons } from "../CopyAffButton";

type AdminPayload = {
  stats: AdminStats;
  settings: PublicAppSettings;
  runs: CrawlRunRow[];
  deals: DealRow[];
  watchlist: WatchlistRow[];
  crawling: boolean;
  crawlProgress?: string;
};

type SettingsForm = PublicAppSettings & {
  clearPaapiSecret?: boolean;
  clearKeepaKey?: boolean;
};

const SOURCE_LABELS: Record<string, string> = {
  mydealz: "mydealz",
  meindeal: "mein-deal",
  monsterdealz: "monsterdealz",
  dealdoktor: "dealdoktor",
  camel: "camel",
  paapi: "PA-API",
  keepa: "Keepa",
  watchlist: "Watchlist",
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

function dealSourceUrl(d: DealRow) {
  if (d.source_url) return d.source_url;
  if (d.source === "meindeal") return `https://www.mein-deal.com/?p=${Math.abs(d.thread_id)}`;
  if (d.source === "camel" && d.asin) return `https://de.camelcamelcamel.com/product/${d.asin}`;
  if (d.asin && (d.source === "paapi" || d.source === "keepa")) return `https://www.amazon.de/dp/${d.asin}`;
  return `https://www.mydealz.de/deals/${d.slug ? d.slug + "-" : ""}${d.thread_id}`;
}

export default function AdminClient({ initial }: { initial: AdminPayload }) {
  const [data, setData] = useState<AdminPayload>(initial);
  const [form, setForm] = useState<SettingsForm>(initial.settings);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [wlText, setWlText] = useState("");
  const [wlTarget, setWlTarget] = useState("");
  const [wlDropPct, setWlDropPct] = useState(20);
  const [wlNote, setWlNote] = useState("");

  const refresh = useCallback(
    async (opts?: { q?: string; filter?: string; source?: string }) => {
      const nextQ = opts?.q ?? q;
      const nextFilter = opts?.filter ?? filter;
      const nextSource = opts?.source ?? sourceFilter;
      const p = new URLSearchParams();
      if (nextQ.trim()) p.set("q", nextQ.trim());
      if (nextFilter !== "all") p.set("filter", nextFilter);
      if (nextSource !== "all") p.set("source", nextSource);
      const res = await fetch(`/api/admin?${p}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as AdminPayload;
      setData(json);
    },
    [q, filter, sourceFilter],
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

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      showMsg("err", "Mật khẩu mới nhập lại không khớp.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current: pw.current, next: pw.next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setPw({ current: "", next: "", confirm: "" });
      setShowPw(false);
      showMsg("ok", json.message || "Đã đổi mật khẩu.");
    } catch (err) {
      showMsg("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function addWatchlist(e: React.FormEvent) {
    e.preventDefault();
    if (!wlText.trim()) return;
    setBusy(true);
    try {
      const parsedTarget = wlTarget.trim() ? Number(wlTarget.replace(",", ".")) : null;
      const res = await fetch("/api/admin/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "watchlist_add",
          text: wlText,
          targetPrice: parsedTarget && Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : null,
          minDropPct: wlDropPct,
          note: wlNote.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setWlText("");
      setWlTarget("");
      setWlNote("");
      showMsg("ok", json.message || "Đã thêm vào Watchlist.");
      await refresh();
    } catch (err) {
      showMsg("err", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    void refresh({ q, filter, source: sourceFilter });
  }

  const { stats, runs, deals, watchlist, settings, crawling, crawlProgress } = data;
  const sourceBreakdown = Object.entries(stats.bySource)
    .filter(([, count]) => count > 0)
    .map(([k, count]) => `${SOURCE_LABELS[k] || k}: ${count}`)
    .join(" · ");

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
          <button className="btn" type="button" onClick={() => setShowPw((v) => !v)}>
            Đổi mật khẩu
          </button>
        </div>
      </header>

      {showPw && (
        <form className="panel" onSubmit={changePassword}>
          <h2>Đổi mật khẩu đăng nhập</h2>
          <div className="field-grid">
            <label className="field">
              <span>Mật khẩu hiện tại</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Mật khẩu mới (tối thiểu 8 ký tự)</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Nhập lại mật khẩu mới</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={pw.confirm}
                onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              />
            </label>
          </div>
          <div className="panel-foot">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Lưu mật khẩu mới
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setShowPw(false)}>
              Huỷ
            </button>
            <span className="meta">Áp dụng cho toàn bộ trang. Script push dùng INGEST_TOKEN nên không bị ảnh hưởng.</span>
          </div>
        </form>
      )}

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
          <div className="kpi-sub">{sourceBreakdown || "Chưa có deal"}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Trạng thái &amp; Lỗi giá</div>
          <div className="kpi-val">{stats.withAsin} ASIN</div>
          <div className="kpi-sub">
            Còn hạn: {stats.active} · Hết hạn: {stats.expired} · ⚡ Lỗi giá: {stats.priceErrors}
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Keepa Mini (Lịch sử giá)</div>
          <div className="kpi-val">{stats.trackedAsins} ASIN</div>
          <div className="kpi-sub">
            Watchlist: {stats.watchlistCount} ASIN · Quá hạn (&gt; {settings.retentionDays}d): {stats.olderThanRetention}
          </div>
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
          <h2>Cấu hình nguồn Deal &amp; Affiliate</h2>
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
              <span>Số trang mỗi nguồn / lần lấy</span>
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
              <span>Amazon PartnerNet DE Tag</span>
              <input
                type="text"
                placeholder="vd: tenban-21"
                value={form.amazonTag}
                onChange={(e) => setForm({ ...form, amazonTag: e.target.value })}
              />
            </label>
          </div>
          <div className="chk-group">
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableMydealz}
                onChange={(e) => setForm({ ...form, enableMydealz: e.target.checked })}
              />
              Lấy deal Amazon + Preisfehler từ <strong>mydealz.de</strong>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableMeindeal}
                onChange={(e) => setForm({ ...form, enableMeindeal: e.target.checked })}
              />
              Lấy deal Amazon từ <strong>mein-deal.com</strong>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableMonsterdealz}
                onChange={(e) => setForm({ ...form, enableMonsterdealz: e.target.checked })}
              />
              Lấy deal Amazon từ <strong>monsterdealz.de</strong>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableDealdoktor}
                onChange={(e) => setForm({ ...form, enableDealdoktor: e.target.checked })}
              />
              Lấy deal Amazon từ <strong>dealdoktor.de</strong>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableCamel}
                onChange={(e) => setForm({ ...form, enableCamel: e.target.checked })}
              />
              Lấy Top Price Drops từ <strong>de.camelcamelcamel.com</strong> (RSS miễn phí)
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.serverCrawlEnabled}
                onChange={(e) => setForm({ ...form, serverCrawlEnabled: e.target.checked })}
              />
              Bật auto crawl ngay trên server (đi qua Cloudflare WARP proxy <code>warp:1080</code>)
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.enableWatchlist}
                onChange={(e) => setForm({ ...form, enableWatchlist: e.target.checked })}
              />
              Bật quét <strong>Watchlist ASIN (Keepa riêng)</strong> mỗi lần crawl
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={form.watchlistAutoHarvest}
                onChange={(e) => setForm({ ...form, watchlistAutoHarvest: e.target.checked })}
              />
              Tự thêm ASIN thuộc <strong>Brand/Từ khoá</strong> bên dưới vào Watchlist (tối đa 500 ASIN)
            </label>
          </div>

          <div className="sub-section">
            <h3>Amazon PartnerNet DE — PA-API 5.0 (Miễn phí, cần đủ 3 đơn đầu)</h3>
            <div className="sub-hint">
              Khi có Access Key + Secret Key + Tag, crawler tự lấy ảnh/giá chính chủ và kiểm tra hết hạn qua API (không bị captcha).
            </div>
            <div className="field-grid">
              <label className="field">
                <span>PA-API Access Key</span>
                <input
                  type="text"
                  placeholder="AKIA..."
                  value={form.paapiAccessKey}
                  onChange={(e) => setForm({ ...form, paapiAccessKey: e.target.value })}
                />
              </label>
              <label className="field">
                <span>PA-API Secret Key</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={form.hasPaapiSecret && !form.clearPaapiSecret ? "Đã lưu (để trống nếu giữ nguyên)" : "Nhập Secret Key"}
                  value={form.paapiSecretKey}
                  onChange={(e) => setForm({ ...form, paapiSecretKey: e.target.value, clearPaapiSecret: false })}
                />
              </label>
              <label className="field">
                <span>Từ khoá / Brand săn qua PA-API</span>
                <input
                  type="text"
                  placeholder="WMF,Zwilling,Bosch,LEGO..."
                  value={form.paapiKeywords}
                  onChange={(e) => setForm({ ...form, paapiKeywords: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Giảm tối thiểu PA-API (%)</span>
                <input
                  type="number"
                  min={10}
                  max={90}
                  value={form.paapiMinSavingPct}
                  onChange={(e) => setForm({ ...form, paapiMinSavingPct: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="chk-group">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={form.enablePaapiSearch}
                  onChange={(e) => setForm({ ...form, enablePaapiSearch: e.target.checked })}
                />
                Bật tự tìm deal theo từ khoá/brand bằng <strong>PA-API SearchItems</strong>
              </label>
              {form.hasPaapiSecret && (
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={Boolean(form.clearPaapiSecret)}
                    onChange={(e) => setForm({ ...form, clearPaapiSecret: e.target.checked })}
                  />
                  Xoá PA-API Secret Key đang lưu
                </label>
              )}
            </div>
          </div>

          <div className="sub-section">
            <h3>Keepa API (Tuỳ chọn — gói trả phí từ ~49€/tháng)</h3>
            <div className="field-grid">
              <label className="field">
                <span>Keepa API Key</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={form.hasKeepaKey && !form.clearKeepaKey ? "Đã lưu (để trống nếu giữ nguyên)" : "Để trống nếu dùng nguồn miễn phí"}
                  value={form.keepaApiKey}
                  onChange={(e) => setForm({ ...form, keepaApiKey: e.target.value, clearKeepaKey: false })}
                />
              </label>
              <label className="field">
                <span>Giảm tối thiểu Keepa (%)</span>
                <input
                  type="number"
                  min={10}
                  max={95}
                  value={form.keepaMinDropPct}
                  onChange={(e) => setForm({ ...form, keepaMinDropPct: Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="chk-group">
              <label className="chk">
                <input
                  type="checkbox"
                  checked={form.enableKeepa}
                  onChange={(e) => setForm({ ...form, enableKeepa: e.target.checked })}
                />
                Bật kéo deal từ <strong>Keepa API (/deal, amazon.de)</strong>
              </label>
              {form.hasKeepaKey && (
                <label className="chk">
                  <input
                    type="checkbox"
                    checked={Boolean(form.clearKeepaKey)}
                    onChange={(e) => setForm({ ...form, clearKeepaKey: e.target.checked })}
                  />
                  Xoá Keepa API Key đang lưu
                </label>
              )}
            </div>
          </div>

          <div className="panel-foot">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Lưu cấu hình
            </button>
            <span className="meta">
              Áp dụng ngay cho server scheduler và <code>scripts/push.mjs</code>.
            </span>
          </div>
        </form>

        <div className="panel">
          <h2>Thao tác nhanh</h2>
          <div className="action-list">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || crawling}
              onClick={() => void runAction("crawl_now")}
            >
              {crawling ? crawlProgress || "Đang crawl trên server…" : "Chạy crawl trên server ngay"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runAction("check_prices")}
            >
              Kiểm tra giá &amp; hết hạn (PA-API)
            </button>
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
            <strong>Nguồn dữ liệu &amp; Keepa Mini:</strong>
            <div>
              Hệ thống tự gom từ <strong>mydealz (+ Preisfehler)</strong>, <strong>mein-deal</strong>,{" "}
              <strong>monsterdealz</strong>, <strong>dealdoktor</strong>, <strong>CamelCamelCamel DE</strong> và tự
              lưu lịch sử giá 90 ngày trong SQLite (<code>{stats.trackedAsins}</code> ASIN) để đánh dấu{" "}
              <strong>⚡ Lỗi giá</strong> &amp; <strong>📉 Đáy</strong> mà không cần mua Keepa.
            </div>
            <div>
              Chu kỳ server: <code>{settings.crawlIntervalMin} phút</code> · Giữ deal: <code>{settings.retentionDays} ngày</code>.
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
              placeholder="Tìm tên, brand, ASIN, ID…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              value={sourceFilter}
              onChange={(e) => {
                const next = e.target.value;
                setSourceFilter(next);
                void refresh({ q, filter, source: next });
              }}
            >
              <option value="all">Mọi nguồn</option>
              <option value="mydealz">mydealz</option>
              <option value="meindeal">mein-deal</option>
              <option value="monsterdealz">monsterdealz</option>
              <option value="dealdoktor">dealdoktor</option>
              <option value="camel">Camel DE</option>
              <option value="paapi">PA-API</option>
              <option value="keepa">Keepa</option>
              <option value="watchlist">Watchlist</option>
            </select>
            <select
              value={filter}
              onChange={(e) => {
                const next = e.target.value;
                setFilter(next);
                void refresh({ q, filter: next, source: sourceFilter });
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="price_error">⚡ Lỗi giá / Preisfehler</option>
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
                <th>Nguồn</th>
                <th>ASIN &amp; Copy bài</th>
                <th>Giá</th>
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
                const amzHref = d.asin
                  ? `https://amazon.de/dp/${d.asin}${settings.amazonTag ? `?tag=${encodeURIComponent(settings.amazonTag)}` : ""}`
                  : null;
                const srcHref = dealSourceUrl(d);
                const displayTitle = d.amz_title || d.md_title;
                const pct =
                  d.percentage ??
                  (d.old_price && d.price != null && d.old_price > d.price
                    ? Math.round(100 * (1 - d.price / d.old_price))
                    : null);
                return (
                  <tr key={d.thread_id} className={d.is_expired ? "row-expired" : ""}>
                    <td>
                      <div className="deal-cell">
                        {img && <img className="thumb" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                        <div className="deal-cell-txt">
                          <a href={amzHref || srcHref} target="_blank" rel="noopener noreferrer" className="deal-cell-title">
                            {displayTitle}
                          </a>
                          <div className="meta">
                            #{Math.abs(d.thread_id)} ·{" "}
                            <a href={srcHref} target="_blank" rel="noopener noreferrer">
                              {SOURCE_LABELS[d.source] || d.source}
                              {d.source === "mydealz" ? ` (${d.temperature}°)` : ""}
                            </a>
                            {d.brand ? ` · ${d.brand}` : ""}
                            {d.voucher_code ? ` · Code: ${d.voucher_code}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="nowrap">
                      <span className={`src-badge src-${d.source}`}>
                        {SOURCE_LABELS[d.source] || d.source}
                      </span>
                    </td>
                    <td>
                      {d.asin ? (
                        <div className="row-actions" style={{ alignItems: "center", flexWrap: "wrap" }}>
                          <a href={amzHref!} target="_blank" rel="noopener noreferrer">
                            <code>{d.asin}</code>
                          </a>
                          <CopyAffButtons
                            url={amzHref!}
                            title={displayTitle}
                            priceText={eur(d.price)}
                            oldPriceText={d.old_price != null && d.old_price > (d.price ?? 0) ? eur(d.old_price) : undefined}
                            pct={pct}
                            voucher={d.voucher_code}
                          />
                        </div>
                      ) : d.no_asin ? (
                        <span className="pill pill-warn">no_asin</span>
                      ) : (
                        <span className="muted">chưa có</span>
                      )}
                    </td>
                    <td className="nowrap">
                      <strong>{eur(d.price)}</strong>
                      {d.old_price != null && d.old_price > (d.price ?? 0) && (
                        <div className="meta"><s>{eur(d.old_price)}</s>{pct ? ` (-${pct}%)` : ""}</div>
                      )}
                    </td>
                    <td className="nowrap">
                      <div>{fmtTime(d.published_at || d.first_seen)}</div>
                      <div className="meta">{ago(d.published_at || d.first_seen)}</div>
                    </td>
                    <td className="nowrap">
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {d.is_expired ? (
                          <span className="pill pill-muted">Hết hạn</span>
                        ) : (
                          <span className="pill pill-ok">Còn hạn</span>
                        )}
                        {d.is_price_error === 1 && <span className="pill pill-err">⚡ Lỗi giá</span>}
                        {d.is_lowest === 1 && <span className="pill pill-warn">📉 Đáy</span>}
                      </div>
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
        <div className="panel-head">
          <h2>Watchlist ASIN — Keepa riêng ({stats.watchlistCount} ASIN)</h2>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void runAction("watchlist_check")}
            >
              Quét Watchlist ngay
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void runAction("watchlist_harvest")}
            >
              Gom ASIN Brand từ kho
            </button>
            {stats.watchlistCount > 0 && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() =>
                  void runAction("watchlist_clear", {}, `Xoá toàn bộ ${stats.watchlistCount} ASIN khỏi Watchlist?`)
                }
              >
                Xoá hết
              </button>
            )}
          </div>
        </div>

        <form className="wl-form" onSubmit={addWatchlist}>
          <textarea
            placeholder="Dán link Amazon.de hoặc mã ASIN (mỗi dòng 1 hoặc nhiều link, vd: https://www.amazon.de/dp/B0..., B09...)"
            value={wlText}
            onChange={(e) => setWlText(e.target.value)}
          />
          <div className="field-grid">
            <label className="field">
              <span>Giá mục tiêu (€, tuỳ chọn)</span>
              <input
                type="text"
                placeholder="vd: 49.99"
                value={wlTarget}
                onChange={(e) => setWlTarget(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Hoặc báo khi giảm ≥ (%) so với TB 90 ngày</span>
              <input
                type="number"
                min={5}
                max={90}
                value={wlDropPct}
                onChange={(e) => setWlDropPct(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>Ghi chú (tuỳ chọn)</span>
              <input
                type="text"
                placeholder="vd: Nồi WMF, Bỉm Pampers..."
                value={wlNote}
                onChange={(e) => setWlNote(e.target.value)}
              />
            </label>
            <div className="field" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn-primary" type="submit" disabled={busy || !wlText.trim()}>
                + Thêm vào Watchlist
              </button>
            </div>
          </div>
        </form>

        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Sản phẩm / ASIN</th>
                <th>Giá hiện tại</th>
                <th>TB 90 ngày / Đáy</th>
                <th>Ngưỡng báo</th>
                <th>Kiểm tra</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 20 }}>
                    Chưa có ASIN nào trong Watchlist. Dán link/ASIN ở trên hoặc bấm &ldquo;Gom ASIN Brand từ kho&rdquo;.
                  </td>
                </tr>
              )}
              {watchlist.map((w) => {
                const amzHref = `https://amazon.de/dp/${w.asin}${settings.amazonTag ? `?tag=${encodeURIComponent(settings.amazonTag)}` : ""}`;
                return (
                  <tr key={w.asin}>
                    <td>
                      <div className="deal-cell">
                        {w.image && <img className="thumb" src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                        <div className="deal-cell-txt">
                          <a href={amzHref} target="_blank" rel="noopener noreferrer" className="deal-cell-title">
                            {w.title || w.asin}
                          </a>
                          <div className="meta">
                            <code>{w.asin}</code>
                            {w.brand ? ` · ${w.brand}` : ""}
                            {w.note ? ` · ${w.note}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="nowrap">
                      <strong>{eur(w.last_price)}</strong>
                      {!w.in_stock && <div className="meta err">Hết hàng</div>}
                    </td>
                    <td className="nowrap">
                      <div>TB: {eur(w.avg_price_90d)}</div>
                      <div className="meta">Đáy: {eur(w.lowest_price)}</div>
                    </td>
                    <td className="nowrap">
                      {w.target_price != null ? <div>≤ {eur(w.target_price)}</div> : null}
                      <div className="meta">Giảm ≥ {w.min_drop_pct}%</div>
                    </td>
                    <td className="nowrap">
                      <div>{w.last_checked ? fmtTime(w.last_checked) : "Chưa quét"}</div>
                      <div className="meta">{w.last_checked ? ago(w.last_checked) : "Đợi lượt tới"}</div>
                    </td>
                    <td className="nowrap">
                      <button
                        type="button"
                        className="btn-sm btn-sm-danger"
                        disabled={busy}
                        onClick={() => void runAction("watchlist_remove", { asin: w.asin })}
                      >
                        Xoá
                      </button>
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
