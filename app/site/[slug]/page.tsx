import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getBusinessBySlug, getUserById, listServices, incrementPageViews, type BusinessRow } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { STORE_TEXT } from "@/lib/storeI18n";
import { activeOffer, formatPhone, normalizePhone, storeTheme } from "@/lib/site";
import { BuyActions, Countdown, Gallery, Track } from "./StoreParts";
import "./store.css";

// A page is public only while it's published AND its owner's plan includes publishing
// (if the subscription ends, the page goes offline until they subscribe again).
async function isLive(b: BusinessRow): Promise<boolean> {
  if (!b.published) return false;
  const owner = await getUserById(b.userId);
  return Boolean(owner && limitsFor(owner).canPublish);
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|slack|discord|telegram|preview|vercel|lighthouse|headless/i;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business || !(await isLive(business))) return { title: "Sevrii", robots: { index: false } };
  const site = business.site;
  const where = site.serviceArea || business.city || "";
  const title = `${business.name}${site.headline ? ` · ${site.headline}` : business.category ? ` · ${business.category}` : ""}${where ? ` · ${where}` : ""}`;
  const description = business.pitch.slice(0, 300);
  const image = site.coverUrl || site.gallery[0] || site.logoUrl || undefined;
  return {
    title,
    description,
    openGraph: { title, description, images: image ? [image] : undefined, type: "website" },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
  };
}

export default async function PublicBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const viewer = await getCurrentUser().catch(() => null);
  const isOwner = viewer?.id === business.userId;
  const live = await isLive(business);
  if (!live && !isOwner) notFound();

  const site = business.site;
  const t = STORE_TEXT[site.lang].site;
  const services = await listServices(business.id);

  // Count real visitors only: not the owner, not link-preview bots, once per IP per hour.
  if (!isOwner && live) {
    try {
      const ua = (await headers()).get("user-agent") || "";
      if (!BOT_UA.test(ua) && (await allow(`view:${await clientIp()}:${business.id}`, 1, 60 * 60))) {
        await incrementPageViews(business.id);
      }
    } catch {
      // Never let analytics failures break the visitor's page.
    }
  }

  const phone = site.phone || null;
  const wa = normalizePhone(business.whatsapp);
  const offer = activeOffer(site);
  const area = site.serviceArea || business.city || "";
  const mainTitle = site.headline || business.category || business.name;
  const images = [site.coverUrl, ...site.gallery].filter(Boolean);
  const ordered = [...services].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));

  // Trust bar: only things the owner declared.
  const trust: { icon: string; text: string }[] = [];
  if (site.licenseNumber) trust.push({ icon: "✓", text: `${t.license} #${site.licenseNumber}${site.licenseState ? ` (${site.licenseState})` : ""}` });
  if (site.insured) trust.push({ icon: "◇", text: t.insured });
  if (site.yearsInBusiness) trust.push({ icon: "★", text: t.years(site.yearsInBusiness) });
  if (site.spanish) trust.push({ icon: "ñ", text: t.spanish });
  for (const f of site.features) if (trust.length < 5) trust.push({ icon: "✓", text: f });

  const keyPoints = site.keyPoints.length > 0 ? site.keyPoints : site.highlights.map((h) => ({ title: "", text: h }));

  const finalPrimary = wa
    ? { href: `https://wa.me/${wa.replace(/\D/g, "")}?text=${encodeURIComponent(t.msgGeneric(business.name))}`, channel: "whatsapp" as const, label: `💬 ${t.writeWhatsapp}` }
    : phone
      ? { href: `tel:${phone}`, channel: "call" as const, label: `📞 ${t.callNow}` }
      : null;

  return (
    <div className="mt" lang={site.lang} style={storeTheme(business.accentColor) as React.CSSProperties}>
      {!live && <div className="draft-bar">{t.draftBanner}</div>}

      <header className="mt-header">
        <div className="wrap header-row">
          <span className="brand">
            {site.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt="" />
            ) : null}
            <span className="brand-name">{site.logoUrl ? "" : "Sevrii"}</span>
          </span>
          <div className="header-title">{business.name}</div>
          {phone ? (
            <Track href={`tel:${phone}`} businessId={business.id} channel="call" className="header-badge">
              📞 {formatPhone(phone)}
            </Track>
          ) : (
            <span className="header-badge">{area}</span>
          )}
        </div>
      </header>

      <main>
        <div className="wrap breadcrumb">
          <span>{business.name}</span>
          <span className="sep">›</span>
          <span className="current">{business.category}</span>
        </div>

        <section className="product wrap">
          <div className="gallery-col">
            <div className="gallery-title">{business.name}</div>
            <Gallery
              images={images}
              alt={t.photoAlt(business.name)}
              empty={
                <div className="stage-empty">
                  <span className="stage-kicker">{business.category}{area ? ` · ${area}` : ""}</span>
                  <div className="stage-title">{mainTitle}</div>
                </div>
              }
            />
          </div>

          {(area || site.hours || phone || site.googleReviewsUrl) && (
            <div className="below-gallery">
              <div className="info-card">
                <div className="eyebrow grad-text">{t.infoTitle}</div>
                {area && (
                  <div className="info-row">
                    <span className="k">{t.serviceArea}</span>
                    <span className="v">{area}</span>
                  </div>
                )}
                {site.hours && (
                  <div className="info-row">
                    <span className="k">{t.hours}</span>
                    <span className="v">{site.hours}</span>
                  </div>
                )}
                {phone && (
                  <div className="info-row">
                    <span className="k">{t.phoneLabel}</span>
                    <Track href={`tel:${phone}`} businessId={business.id} channel="call" className="v">
                      {formatPhone(phone)}
                    </Track>
                  </div>
                )}
                {site.googleReviewsUrl && (
                  <a className="btn ghost" href={site.googleReviewsUrl} target="_blank" rel="noopener noreferrer nofollow" style={{ width: "fit-content" }}>
                    ★ {t.googleReviews}
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="buybox">
            {(site.licenseNumber || site.insured || site.spanish) && (
              <div className="badge-row">
                {site.licenseNumber && <span className="badge">✓ {t.license} #{site.licenseNumber}</span>}
                {site.insured && <span className="badge soft">{t.insured}</span>}
                {site.spanish && <span className="badge soft">{t.spanish}</span>}
              </div>
            )}

            {offer && (
              <div className="deal">
                <span className="deal-dot" />
                <strong>{t.offer}</strong> · {offer.label}
                {offer.oldPrice && (
                  <span>
                    {" "}
                    · {t.before} <span className="deal-old">{offer.oldPrice}</span>
                  </span>
                )}
                {offer.newPrice && (
                  <span>
                    {" "}
                    {t.now} <span className="deal-new">{offer.newPrice}</span>
                  </span>
                )}
                {offer.endsAt && (
                  <span>
                    {" "}
                    — {t.endsIn} <Countdown endsAt={offer.endsAt} />
                  </span>
                )}
              </div>
            )}

            <h1>{mainTitle}</h1>
            <p className="lede">{business.pitch}</p>

            {keyPoints.length > 0 && (
              <ul className="about-list">
                {keyPoints.map((p, n) => (
                  <li key={n}>
                    {p.title ? <strong>{p.title}:</strong> : null} {p.text}
                  </li>
                ))}
              </ul>
            )}

            <BuyActions
              businessId={business.id}
              businessName={business.name}
              services={ordered.map((s) => ({ id: s.id, name: s.name, price: s.price ?? "" }))}
              contact={{ wa, phone, textEnabled: site.textEnabled }}
              ctaNote={site.ctaNote}
              labels={{
                chooseLabel: t.chooseLabel,
                selected: t.selected,
                priceOnRequest: t.priceOnRequest,
                writeWhatsapp: t.writeWhatsapp,
                callNow: t.callNow,
                text: t.text,
                msgService: t.msgService("{biz}", "{svc}"),
                msgGeneric: t.msgGeneric("{biz}"),
                noContact: t.noContact,
              }}
            />
          </div>
        </section>

        {trust.length > 0 && (
          <section className="trust">
            <div className="wrap">
              <div className="trust-grid">
                {trust.map((x) => (
                  <div key={x.text} className="trust-item">
                    <div className="trust-icon">{x.icon}</div>
                    <span>{x.text}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {site.steps.length > 0 && (
          <section className="block wrap">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.howEyebrow}</span>
              <h2>{t.howTitle}</h2>
            </div>
            <div className={`process-grid ${site.steps.length === 4 ? "n4" : ""}`}>
              {site.steps.map((s, n) => (
                <div key={n} className="process-card">
                  <span className="process-num grad-text">{n + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {ordered.length > 0 && (
          <section className="block wrap" id="servicios">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.servicesEyebrow}</span>
              <h2>{t.servicesTitle}</h2>
            </div>
            <div className="services-grid">
              {ordered.map((s) => {
                const msg = t.msgService(business.name, s.name);
                const href = wa
                  ? `https://wa.me/${wa.replace(/\D/g, "")}?text=${encodeURIComponent(msg)}`
                  : phone && site.textEnabled
                    ? `sms:${phone}?&body=${encodeURIComponent(msg)}`
                    : phone
                      ? `tel:${phone}`
                      : null;
                const channel = wa ? "whatsapp" : phone && site.textEnabled ? "text" : "call";
                const body = (
                  <>
                    {s.featured && <span className="service-tag grad-text">{s.tag || t.featured}</span>}
                    <h3>{s.name}</h3>
                    {s.description && <p>{s.description}</p>}
                    <span className="service-range grad-text">{s.price || t.priceOnRequest}</span>
                  </>
                );
                return href ? (
                  <Track key={s.id} href={href} businessId={business.id} channel={channel} className={`service-card ${s.featured ? "lead" : ""}`}>
                    {body}
                  </Track>
                ) : (
                  <div key={s.id} className={`service-card ${s.featured ? "lead" : ""}`}>
                    {body}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {site.faq.length > 0 && (
          <section className="block wrap">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.faqEyebrow}</span>
              <h2>{t.faqTitle}</h2>
            </div>
            <div className="faq-list">
              {site.faq.map((f, n) => (
                <details key={n} open={n === 0}>
                  <summary>
                    {f.q} <span className="plus grad-text">+</span>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>

      {finalPrimary && (
        <section className="final-cta block">
          <div className="wrap">
            <h2>{site.ctaTitle || t.ctaDefaultTitle}</h2>
            <p>{site.ctaText || t.ctaDefaultText}</p>
            <div className="btns">
              <Track href={finalPrimary.href} businessId={business.id} channel={finalPrimary.channel} className="btn">
                {finalPrimary.label}
              </Track>
              {wa && phone && (
                <Track href={`tel:${phone}`} businessId={business.id} channel="call" className="btn ghost">
                  📞 {formatPhone(phone)}
                </Track>
              )}
            </div>
          </div>
        </section>
      )}

      <footer>
        <div className="wrap">
          <div className="footer-row">
            <p className="footer-legal">{site.disclaimer || t.builtWith(business.name)}</p>
            <div className="footer-links">
              {site.disclaimer && <a href="/">{t.builtWith(business.name)}</a>}
              <a href={`/report/${business.slug}`}>{t.report}</a>
            </div>
          </div>
        </div>
      </footer>

      {finalPrimary && (
        <div className="sticky-cta">
          <div className="row">
            <Track href={finalPrimary.href} businessId={business.id} channel={finalPrimary.channel} className="btn">
              {finalPrimary.label}
            </Track>
            {wa && phone && (
              <Track href={`tel:${phone}`} businessId={business.id} channel="call" className="btn ghost">
                📞 {t.call}
              </Track>
            )}
            {!wa && phone && site.textEnabled && (
              <Track href={`sms:${phone}?&body=${encodeURIComponent(t.msgGeneric(business.name))}`} businessId={business.id} channel="text" className="btn ghost">
                ✉️ {t.textShort}
              </Track>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
