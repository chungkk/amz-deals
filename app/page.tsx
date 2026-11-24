import { db, getSettings, type DealRow } from "@/lib/db";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SORTS: Record<string, { label: string; sql: string }> = {
  new: { label: "Mới nhất", sql: "published_at DESC" },
  hot: { label: "Hot nhất", sql: "temperature DESC, published_at DESC" },
  pct: { label: "Giảm nhiều nhất", sql: "pct DESC, published_at DESC" },
  cheap: { label: "Rẻ nhất", sql: "price IS NULL, price ASC" },
};

const RANGES: Record<string, { label: string; sec: number }> = {
  "1": { label: "24 giờ", sec: 86400 },
  "2": { label: "2 ngày", sec: 2 * 86400 },
  "7": { label: "7 ngày", sec: 7 * 86400 },
  all: { label: "Tất cả", sec: 0 },
};

const SOURCES: Record<string, { label: string }> = {
  all: { label: "Mọi nguồn" },
  mydealz: { label: "mydealz" },
  meindeal: { label: "mein-deal" },
};

const eur = (v: number | null) =>
  v == null ? "" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function ago(ts: number | null) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút trước`;
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
  return `${Math.round(s / 86400)} ngày trước`;
}

function tempClass(t: number) {
  if (t >= 500) return "temp t-burn";
  if (t >= 200) return "temp t-hot";
  if (t >= 50) return "temp t-warm";
  if (t < 0) return "temp t-cold";
  return "temp";
}

function amazonUrl(asin: string, tag: string) {
  return `https://www.amazon.de/dp/${asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
}

function dealSourceUrl(d: DealRow) {
  if (d.source_url) return d.source_url;
  if (d.source === "meindeal") return `https://www.mein-deal.com/?p=${Math.abs(d.thread_id)}`;
  return `https://www.mydealz.de/deals/${d.slug ? d.slug + "-" : ""}${d.thread_id}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const settings = getSettings();
  const sort = SORTS[one(sp.sort)] ? one(sp.sort) : "new";
  const range = RANGES[one(sp.d)] ? one(sp.d) : "2";
  const src = SOURCES[one(sp.src)] ? one(sp.src) : "all";
  const q = one(sp.q).trim();
  const minTemp = Number(one(sp.t)) || 0;
  const showExpired = one(sp.exp) === "1";

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (!showExpired) where.push("is_expired = 0");
  if (src !== "all") (where.push("source = ?"), args.push(src));
  if (RANGES[range].sec) (where.push("published_at > ?"), args.push(Math.floor(Date.now() / 1000) - RANGES[range].sec));
  if (minTemp) (where.push("temperature >= ?"), args.push(minTemp));
  if (q) {
    where.push("(COALESCE(amz_title,'') || ' ' || md_title || ' ' || COALESCE(asin,'')) LIKE ?");
    args.push(`%${q}%`);
  }
  const sql = `
    SELECT *, CASE WHEN old_price > 0 AND price IS NOT NULL AND old_price > price THEN ROUND(100 * (1 - price / old_price)) END AS pct
    FROM deals ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY ${SORTS[sort].sql} LIMIT 300`;
  const deals = db().prepare(sql).all(...args) as (DealRow & { pct: number | null })[];

  const total = (db().prepare("SELECT COUNT(*) c FROM deals").get() as { c: number }).c;
  const lastOk = db().prepare("SELECT at, source FROM crawl_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as
    | { at: number; source: string }
    | undefined;
  const last = db().prepare("SELECT ok, message, at FROM crawl_runs ORDER BY id DESC LIMIT 1").get() as
    | { ok: number; message: string | null; at: number }
    | undefined;

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({
      sort,
      d: range,
      ...(src !== "all" && { src }),
      ...(q && { q }),
      ...(minTemp && { t: String(minTemp) }),
      ...(showExpired && { exp: "1" }),
    });
    for (const [k, v] of Object.entries(patch)) v && !(k === "src" && v === "all") ? p.set(k, v) : p.delete(k);
    return `/?${p}`;
  };

  return (
    <main>
      <header>
        <div className="brand">
          <h1>Amazon Deals</h1>
          <span className="meta">
            {total} deal trong kho (giữ {settings.retentionDays} ngày) · cập nhật {lastOk ? `${ago(lastOk.at)} (${lastOk.source})` : "chưa có"}
            {last && !last.ok && (!lastOk || Date.now() / 1000 - lastOk.at > 3600) && <span className="err" title={last.message ?? ""}> · lần crawl gần nhất lỗi: {last.message}</span>}
          </span>
          <a className="admin-link" href="/admin">Quản trị</a>
        </div>
        <form className="filters" action="/">
          <input type="search" name="q" defaultValue={q} placeholder="Tìm sản phẩm, ASIN…" />
          <select name="t" defaultValue={String(minTemp)}>
            <option value="0">Mọi nhiệt độ</option>
            <option value="50">≥ 50°</option>
            <option value="100">≥ 100°</option>
            <option value="200">≥ 200°</option>
            <option value="500">≥ 500°</option>
          </select>
          <label className="chk">
            <input type="checkbox" name="exp" value="1" defaultChecked={showExpired} /> Cả deal hết hạn
          </label>
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="d" value={range} />
          {src !== "all" && <input type="hidden" name="src" value={src} />}
          <button>Lọc</button>
        </form>
        <nav className="tabs">
          {Object.entries(SORTS).map(([k, v]) => (
            <a key={k} href={link({ sort: k })} className={k === sort ? "on" : ""}>{v.label}</a>
          ))}
          <span className="sep" />
          {Object.entries(RANGES).map(([k, v]) => (
            <a key={k} href={link({ d: k })} className={k === range ? "on" : ""}>{v.label}</a>
          ))}
          <span className="sep" />
          {Object.entries(SOURCES).map(([k, v]) => (
            <a key={k} href={link({ src: k })} className={k === src ? "on" : ""}>{v.label}</a>
          ))}
        </nav>
      </header>

      {deals.length === 0 && <p className="empty">Không có deal nào khớp bộ lọc.</p>}

      <ul className="grid">
        {deals.map((d) => {
          const img = d.amz_image || d.md_image;
          const srcUrl = dealSourceUrl(d);
          const href = d.asin
            ? amazonUrl(d.asin, settings.amazonTag)
            : d.source === "meindeal"
              ? srcUrl
              : `https://www.mydealz.de/visit/threadmain/${d.thread_id}`;
          return (
            <li key={d.thread_id} className={d.is_expired ? "card expired" : "card"}>
              <a className="img" href={href} target="_blank" rel="noopener noreferrer">
                {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                {d.pct != null && d.pct > 0 && <span className="pct">-{d.pct}%</span>}
              </a>
              <div className="body">
                <div className="row">
                  {d.source === "meindeal" ? (
                    <span className="src-badge src-meindeal">mein-deal</span>
                  ) : (
                    <span className={tempClass(d.temperature)}>{d.temperature}°</span>
                  )}
                  <span className="when">{ago(d.published_at)}</span>
                </div>
                <a className="title" href={href} target="_blank" rel="noopener noreferrer" title={d.md_title}>
                  {d.amz_title || d.md_title}
                </a>
                <div className="price">
                  <strong>{eur(d.price)}</strong>
                  {d.old_price != null && d.old_price > (d.price ?? 0) && <s>{eur(d.old_price)}</s>}
                </div>
                {d.voucher_code && <div className="code">Code: <code>{d.voucher_code}</code></div>}
                <div className="links">
                  {d.asin ? <a href={href} target="_blank" rel="noopener noreferrer">Amazon ↗</a> : <span className="muted">không có ASIN</span>}
                  <a href={srcUrl} target="_blank" rel="noopener noreferrer">
                    {d.source === "meindeal" ? "mein-deal ↗" : `mydealz · ${d.comment_count} 💬`}
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
