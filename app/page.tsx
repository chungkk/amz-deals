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

  const active = (
    db()
      .prepare("SELECT COUNT(*) c FROM deals WHERE is_expired = 0 AND asin IS NOT NULL AND asin <> ''")
      .get() as { c: number }
  ).c;

  // "Deal des Tages": biggest discount among today's results (only on the unfiltered start view).
  const showHero = !q && deals.length > 4;
  const dayAgo = Date.now() / 1000 - 86400;
  const discounted = deals.filter((d) => d.pct != null && d.pct > 0 && d.price != null);
  const today = discounted.filter((d) => (d.published_at ?? 0) > dayAgo);
  const byPct = (today.length >= 4 ? today : discounted).sort((a, b) => b.pct! - a.pct!);
  const hero = showHero ? byPct[0] : undefined;
  const picks = showHero ? byPct.slice(1, 4) : [];

  const lastOk = db().prepare("SELECT at FROM crawl_runs WHERE ok = 1 ORDER BY id DESC LIMIT 1").get() as
    | { at: number }
    | undefined;

  const link = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ sort, d: range, ...(q && { q }) });
    for (const [k, v] of Object.entries(patch)) p.set(k, v);
    return `/?${p}`;
  };

  return (
    <div className="shop">
      <div className="topbar">
        <span>✓ Täglich neue Amazon-Angebote</span>
        <span>✓ Direkt bei Amazon kaufen</span>
        <span>✓ Kostenlos &amp; ohne Anmeldung</span>
      </div>

      <header className="shop-head">
        <div className="shop-head-in">
          <a className="logo" href="/">
            <span className="logo-mark" aria-hidden="true">%</span>
            <span className="logo-txt">
              Top<b>Angebote</b>
            </span>
          </a>
          <form className="search" action="/">
            <input type="search" name="q" defaultValue={q} placeholder="Wonach suchst du? z. B. Kopfhörer, Kaffeemaschine …" aria-label="Angebote durchsuchen" />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="d" value={range} />
            <button aria-label="Suchen">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.4-1.41 1.4-5.4-5.38A8 8 0 1 1 10 2Zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z"/></svg>
            </button>
          </form>
          <div className="head-stat">
            <b>{active.toLocaleString("de-DE")}</b>
            <span>aktive Deals</span>
          </div>
        </div>
      </header>

      <main className="shop-main">
        {hero && (
          <section className="hero-deal" aria-label="Deal des Tages">
            <a className="hero-img" href={amazonUrl(hero.asin!, settings.amazonTag)} target="_blank" rel="nofollow sponsored noopener noreferrer">
              {(hero.amz_image || hero.md_image) && <img src={(hero.amz_image || hero.md_image)!} alt="" referrerPolicy="no-referrer" />}
            </a>
            <div className="hero-info">
              <span className="eyebrow">🔥 Deal des Tages</span>
              <h2>{hero.amz_title || hero.md_title}</h2>
              <div className="hero-price">
                <strong>{eur(hero.price)}</strong>
                {hero.old_price != null && hero.old_price > (hero.price ?? 0) && <s>{eur(hero.old_price)}</s>}
                <span className="badge-pct">-{hero.pct}%</span>
              </div>
              {hero.old_price != null && hero.price != null && hero.old_price > hero.price && (
                <p className="save">Du sparst {eur(hero.old_price - hero.price)}</p>
              )}
              {hero.voucher_code && <p className="voucher">Mit Gutscheincode <code>{hero.voucher_code}</code></p>}
              <a className="btn-buy btn-lg" href={amazonUrl(hero.asin!, settings.amazonTag)} target="_blank" rel="nofollow sponsored noopener noreferrer">
                Jetzt bei Amazon ansehen
              </a>
            </div>
            {picks.length > 0 && (
              <aside className="picks">
                <h3>Top-Rabatte</h3>
                {picks.map((d) => (
                  <a key={d.thread_id} className="pick" href={amazonUrl(d.asin!, settings.amazonTag)} target="_blank" rel="nofollow sponsored noopener noreferrer">
                    <span className="pick-img">
                      {(d.amz_image || d.md_image) && <img src={(d.amz_image || d.md_image)!} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                    </span>
                    <span className="pick-txt">
                      <span className="pick-title">{d.amz_title || d.md_title}</span>
                      <span className="pick-price">
                        <b>{eur(d.price)}</b> <em>-{d.pct}%</em>
                      </span>
                    </span>
                  </a>
                ))}
              </aside>
            )}
          </section>
        )}

        <div className="toolbar">
          <div className="result-count">
            <h1>{q ? <>Ergebnisse für „{q}“</> : "Alle Angebote"}</h1>
            <span>
              {deals.length} {deals.length === 1 ? "Angebot" : "Angebote"}
              {lastOk && <> · aktualisiert {ago(lastOk.at)}</>}
            </span>
          </div>
          <nav className="seg" aria-label="Sortieren">
            {Object.entries(SORTS).map(([k, v]) => (
              <a key={k} href={link({ sort: k })} className={k === sort ? "on" : ""}>{v.label}</a>
            ))}
          </nav>
          <nav className="seg seg-sm" aria-label="Zeitraum">
            {Object.entries(RANGES).map(([k, v]) => (
              <a key={k} href={link({ d: k })} className={k === range ? "on" : ""}>{v.label}</a>
            ))}
          </nav>
        </div>

        {deals.length === 0 && (
          <div className="empty-state">
            <p><b>Keine Angebote gefunden.</b></p>
            <p>Versuch es mit einem anderen Suchbegriff oder einem längeren Zeitraum.</p>
            <a className="btn-buy" href="/?d=all">Alle Angebote anzeigen</a>
          </div>
        )}

        <ul className="products">
          {deals.map((d) => {
            const img = d.amz_image || d.md_image;
            const href = amazonUrl(d.asin!, settings.amazonTag);
            const title = d.amz_title || d.md_title;
            const hasOld = d.old_price != null && d.price != null && d.old_price > d.price;
            return (
              <li key={d.thread_id} className="product">
                <a className="p-img" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer">
                  {img && <img src={img} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  <span className="p-badges">
                    {d.pct != null && d.pct > 0 && <span className="badge-pct">-{d.pct}%</span>}
                    {d.voucher_code && <span className="badge-code">Gutschein</span>}
                  </span>
                </a>
                <div className="p-body">
                  <a className="p-title" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer" title={title}>
                    {title}
                  </a>
                  <div className="p-price">
                    {d.price != null ? <strong>{eur(d.price)}</strong> : <strong className="p-na">Preis auf Amazon</strong>}
                    {hasOld && <s>{eur(d.old_price)}</s>}
                  </div>
                  <div className="p-meta">
                    {hasOld ? <span className="save">Du sparst {eur(d.old_price! - d.price!)}</span> : <span />}
                    <span className="when">{ago(d.published_at)}</span>
                  </div>
                  {d.voucher_code && (
                    <div className="p-code">
                      Code: <code>{d.voucher_code}</code>
                    </div>
                  )}
                  <div className="p-actions">
                    <a className="btn-buy" href={href} target="_blank" rel="nofollow sponsored noopener noreferrer">
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
      </main>

      <section className="usp">
        <div>
          <b>Ständig aktualisiert</b>
          <span>Neue Angebote rund um die Uhr, abgelaufene Deals verschwinden automatisch.</span>
        </div>
        <div>
          <b>Direkt zu Amazon</b>
          <span>Jeder Link führt direkt zum Produkt auf amazon.de – kein Umweg, keine Anmeldung.</span>
        </div>
        <div>
          <b>Einfach teilen</b>
          <span>Ein Klick auf „Teilen“ – und der Deal ist bei Freunden und Familie.</span>
        </div>
      </section>

      <footer className="shop-foot">
        <div className="shop-foot-in">
          <div>
            <span className="logo-txt">
              Top<b>Angebote</b>
            </span>
            <p>Die besten Amazon-Angebote für Deutschland – jeden Tag neu.</p>
          </div>
          <div className="fine">
            <p>
              * Alle Preise inkl. MwSt. zum angegebenen Zeitpunkt. Preise und Verfügbarkeit können sich jederzeit ändern;
              maßgeblich ist der Preis auf Amazon zum Zeitpunkt des Kaufs.
            </p>
            <p>
              Hinweis: Links auf dieser Seite sind Affiliate-Links (Werbung). Als Amazon-Partner verdiene ich an qualifizierten
              Verkäufen. Für dich ändert sich am Preis nichts.
            </p>
            <p>© {new Date().getFullYear()} TopAngebote</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
