import type { Metadata } from "next";
import { db, getSettings, type DealRow } from "@/lib/db";
import { ShareButton } from "./ShareButton";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Top-Angebote – die besten Amazon-Deals des Tages",
  description: "Aktuelle Amazon-Angebote und Schnäppchen in Deutschland – täglich neu, mit Rabatt, Gutscheincode und direktem Link.",
  robots: { index: true, follow: true },
};

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SORTS: Record<string, { label: string; sql: string }> = {
  new: { label: "Neueste", sql: "published_at DESC" },
  hot: { label: "Beliebt", sql: "temperature DESC, published_at DESC" },
  pct: { label: "Höchster Rabatt", sql: "pct IS NULL, pct DESC, published_at DESC" },
  cheap: { label: "Günstigste", sql: "price IS NULL, price ASC" },
};

const RANGES: Record<string, { label: string; sec: number }> = {
  "1": { label: "Heute", sec: 86400 },
  "2": { label: "2 Tage", sec: 2 * 86400 },
  "7": { label: "7 Tage", sec: 7 * 86400 },
  all: { label: "Alle", sec: 0 },
};

const eur = (v: number | null) =>
  v == null ? "" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });

function ago(ts: number | null) {
  if (!ts) return "";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 3600) {
    const m = Math.max(1, Math.round(s / 60));
    return `vor ${m} Min.`;
  }
  if (s < 86400) {
    const h = Math.round(s / 3600);
    return `vor ${h} Std.`;
  }
  const d = Math.round(s / 86400);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

function amazonUrl(asin: string, tag: string) {
  return `https://amazon.de/dp/${asin}${tag ? `?tag=${encodeURIComponent(tag)}` : ""}`;
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const settings = getSettings();
  const sort = SORTS[one(sp.sort)] ? one(sp.sort) : "new";
  const range = RANGES[one(sp.d)] ? one(sp.d) : "2";
  const q = one(sp.q).trim();

  // Public page: only live Amazon deals with an ASIN, so every card links straight to amazon.de.
  const where: string[] = ["is_expired = 0", "asin IS NOT NULL", "asin <> ''"];
  const args: (string | number)[] = [];
  if (RANGES[range].sec) (where.push("published_at > ?"), args.push(Math.floor(Date.now() / 1000) - RANGES[range].sec));
  if (q) {
    where.push("(COALESCE(amz_title,'') || ' ' || md_title || ' ' || COALESCE(asin,'')) LIKE ?");
    args.push(`%${q}%`);
  }
  const sql = `
    SELECT *, CASE WHEN old_price > 0 AND price IS NOT NULL AND old_price > price THEN ROUND(100 * (1 - price / old_price)) END AS pct
    FROM deals WHERE ${where.join(" AND ")}
    ORDER BY ${SORTS[sort].sql} LIMIT 300`;
  const deals = db().prepare(sql).all(...args) as (DealRow & { pct: number | null })[];

  const lastOk = db().prepare("SELECT at FROM crawl_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as
    | { at: number }
    | undefined;

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ sort, d: range, ...(q && { q }) });
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `/?${p}`;
  };

  return (
    <main className="public">
      <header className="hero">
        <div className="hero-txt">
          <h1>Top-Angebote</h1>
          <p className="tagline">
            Die besten Amazon-Deals des Tages – handverlesen, ständig aktualisiert.
            {lastOk && <span className="meta"> Zuletzt aktualisiert {ago(lastOk.at)}.</span>}
          </p>
        </div>
        <form className="filters" action="/">
          <input type="search" name="q" defaultValue={q} placeholder="Produkt suchen …" aria-label="Produkt suchen" />
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="d" value={range} />
          <button>Suchen</button>
        </form>
        <nav className="tabs" aria-label="Sortierung und Zeitraum">
          {Object.entries(SORTS).map(([k, v]) => (
            <a key={k} href={link({ sort: k })} className={k === sort ? "on" : ""}>{v.label}</a>
          ))}
          <span className="sep" />
          {Object.entries(RANGES).map(([k, v]) => (
            <a key={k} href={link({ d: k })} className={k === range ? "on" : ""}>{v.label}</a>
          ))}
        </nav>
      </header>

      {deals.length === 0 && <p className="empty">Keine Angebote gefunden. Versuch es mit einem anderen Suchbegriff oder Zeitraum.</p>}

      <ul className="grid">
        {deals.map((d) => {
          const img = d.amz_image || d.md_image;
          const href = amazonUrl(d.asin!, settings.amazonTag);
          const title = d.amz_title || d.md_title;
          const hasOld = d.old_price != null && d.old_price > (d.price ?? 0);
          return (
            <li key={d.thread_id} className="card">
              <a className="img" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer">
                {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                {d.pct != null && d.pct > 0 && <span className="pct">-{d.pct}%</span>}
              </a>
              <div className="body">
                <span className="when">{ago(d.published_at)}</span>
                <a className="title" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer" title={title}>
                  {title}
                </a>
                <div className="price">
                  {d.price != null && <strong>{eur(d.price)}</strong>}
                  {hasOld && <s>{eur(d.old_price)}</s>}
                </div>
                {d.voucher_code && <div className="code">Gutscheincode: <code>{d.voucher_code}</code></div>}
                <div className="actions">
                  <a className="cta" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer">
                    Zum Angebot
                  </a>
                  <ShareButton
                    url={href}
                    title={title}
                    text={[
                      title,
                      d.price != null ? `${eur(d.price)}${hasOld ? ` statt ${eur(d.old_price)}` : ""}${d.pct ? ` (-${d.pct}%)` : ""}` : "",
                      d.voucher_code ? `Gutscheincode: ${d.voucher_code}` : "",
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <footer className="site-foot">
        <p>
          * Preise inkl. MwSt., Stand zum angegebenen Zeitpunkt. Preise und Verfügbarkeit können sich jederzeit ändern;
          maßgeblich ist der Preis auf Amazon zum Zeitpunkt des Kaufs.
        </p>
        <p>
          Hinweis: Links auf dieser Seite sind Affiliate-Links (Werbung). Als Amazon-Partner verdiene ich an qualifizierten
          Verkäufen. Für dich ändert sich am Preis nichts.
        </p>
      </footer>
    </main>
  );
}
