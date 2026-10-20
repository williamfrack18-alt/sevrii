import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { after } from "next/server";
import { cache } from "react";
import { getBusinessBySlug, getUserById, listServices, listPaymentLinks, incrementPageViews, addCampaignEvent, campaignBelongs, type BusinessRow } from "@/lib/db";
import { cleanCampaignId } from "@/lib/campaignLink";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { STORE_TEXT } from "@/lib/storeI18n";
import { reachLabel, resolveReach } from "@/lib/reach";
import { activeOffer, storeTheme } from "@/lib/site";
import { BuyActions, ChatIcon, ChatLink, Countdown, Gallery, UntilOfferEnds, type MediaItem } from "./StoreParts";
import { ChatJump } from "./ChatWidget";
import { agentMissing, offerPriceLabel, welcomeLabel } from "@/lib/serviceAgentConfig";
import "./store.css";

// A page is public only while it's published AND its owner's plan includes publishing
// (if the subscription ends, the page goes offline until they subscribe again).
// Metadata and the page share these lookups (one query each per request).
const businessBySlug = cache((slug: string) => getBusinessBySlug(slug));
const ownerById = cache((id: string) => getUserById(id));

async function isLive(b: BusinessRow): Promise<boolean> {
  if (!b.published) return false;
  const owner = await ownerById(b.userId);
  return Boolean(owner && limitsFor(owner).canPublish);
}

const SITE_URL = "https://www.sevrii.com";

// Cut at a word boundary so titles/descriptions stay within search limits.
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s·,.;:-]+$/, "")}…`;
}

// Plain dollar amount ("$1,200", "$120.50", "$99/hr") → number. Anything else
// ("$1.5k", "$2M") → null, so we never show a wrong "From $X".
function plainDollars(price: string): number | null {
  const m = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\w.,])/.exec(price);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|slack|discord|telegram|preview|vercel|lighthouse|headless/i;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await businessBySlug(slug);
  if (!business || !(await isLive(business))) return { title: "Sevrii", robots: { index: false } };
  const site = business.site;
  const where = site.serviceArea || business.city || "";
  const title = clip(`${business.name}${site.headline ? ` · ${site.headline}` : business.category ? ` · ${business.category}` : ""}${where ? ` · ${where}` : ""}`, 70);
  const fallback = [business.category, where].filter(Boolean).join(site.lang === "en" ? " in " : " en ");
  const description = clip(business.pitch.trim() || (fallback ? `${business.name} · ${fallback}` : business.name), 300);
  const image = site.coverUrl || site.gallery[0] || site.logoUrl || undefined;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/site/${business.slug}` },
    openGraph: { title, description, images: image ? [image] : undefined, type: "website" },
    twitter: { card: image ? "summary_large_image" : "summary", title, description },
  };
}

export default async function PublicBusinessPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const rawC = (await searchParams).c;
  const business = await businessBySlug(slug);
  if (!business) notFound();

  const [viewer, live] = await Promise.all([getCurrentUser().catch(() => null), isLive(business)]);
  const isOwner = viewer?.id === business.userId;
  if (!live && !isOwner) notFound();

  const site = business.site;
  const t = STORE_TEXT[site.lang].site;
  // Payment links the owner turned on (only when their Stripe account can take payments).
  const [services, allPayLinks] = await Promise.all([
    listServices(business.id),
    business.payStatus === "ready" ? listPaymentLinks(business.id) : Promise.resolve([]),
  ]);
  const payLinks = allPayLinks.filter((l) => l.active).slice(0, 6);
  const payText =
    site.lang === "en"
      ? { eyebrow: "Pay online", title: "Book and pay here", button: "Pay" }
      : { eyebrow: "Paga en línea", title: "Reserva y paga aquí", button: "Pagar" };
  // A campaign tracking link (?c=<campaignId>): only a campaign of this business counts.
  const campaignParam = cleanCampaignId(Array.isArray(rawC) ? rawC[0] : rawC);
  const campaign = campaignParam && (await campaignBelongs(business.id, campaignParam).catch(() => false)) ? campaignParam : "";
  const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

  // Count real visitors only: not the owner, not link-preview bots, once per IP per hour.
  if (!isOwner && live) {
    try {
      const ua = (await headers()).get("user-agent") || "";
      const ip = await clientIp();
      // Counted after the page is sent, so the visitor never waits for it.
      if (!BOT_UA.test(ua)) {
        const id = business.id;
        after(async () => {
          if (await allow(`view:${ip}:${id}`, 1, 60 * 60)) await incrementPageViews(id);
        });
        if (campaign) {
          after(async () => {
            if (await allow(`cview:${ip}:${campaign}`, 1, 60 * 60)) await addCampaignEvent(id, campaign, "view");
          });
        }
      }
    } catch {
      // Never let analytics failures break the visitor's page.
    }
  }

  const offer = activeOffer(site);
  // Where they work: their own words first, else the service area they set.
  // The page chat is the owner's service agent when it's switched on.
  const sa = business.serviceAgent;
  const chatAgent =
    sa.enabled && agentMissing(sa).length === 0
      ? {
          name: sa.name,
          greeting: sa.greeting.replace(/\[(tu nombre|your name|nombre)\]/gi, site.ownerName || business.name),
          offers:
            business.payStatus === "ready" && business.stripeAccountId
              ? sa.offers.map((o) => ({ id: o.id, title: o.title, detail: o.detail, label: offerPriceLabel(o, site.lang), welcome: welcomeLabel(sa, o, site.lang) }))
              : [],
        }
      : null;
  const reach = resolveReach(site, business.city, business.plan.profile);
  const area = site.serviceArea || reachLabel(reach, site.lang) || business.city || "";
  const mainTitle = site.headline || business.category || business.name;
  const images = [site.coverUrl, ...site.gallery].filter(Boolean);
  const ordered = [...services].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
  // One service only: the page focuses on it (no options to pick, one big card).
  const single = ordered.length === 1;

  // A service with an active payment link of the same name gets "Book and pay".
  const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const payFor = (name: string) => {
    const n = norm(name);
    return n ? payLinks.find((l) => norm(l.title) === n || norm(l.title).includes(n)) : undefined;
  };

  // Gallery: the owner's video first, then their photos, then a card per
  // package with its price (so the gallery is never empty or bare).
  const media: MediaItem[] = [];
  if (site.videoUrl) media.push({ kind: "video", src: site.videoUrl, poster: site.coverUrl, label: t.videoLabel(business.name) });
  for (const src of images) media.push({ kind: "photo", src });
  if (offer) media.push({ kind: "slide", tone: "offer", kicker: t.offerKicker, title: offer.label, price: offer.newPrice, text: business.name });
  for (const sv of ordered.slice(0, 4)) {
    media.push({ kind: "slide", tone: "service", kicker: sv.featured ? sv.tag || t.featured : t.packageKicker, title: sv.name, price: sv.price || t.priceOnRequest, text: sv.description || "" });
  }

  // Lowest price shown as "From $X": only with several services and only when
  // every dollar price is a plain amount (else it could be wrong).
  const dollarPrices = ordered.map((x) => x.price || "").filter((p) => p.includes("$"));
  const nums = dollarPrices.map(plainDollars);
  const fromPrice = !single && nums.length > 0 && nums.every((n) => n !== null) ? Math.min(...(nums as number[])) : null;
  // Payment links that don't belong to a listed service get their own section.
  const extraPayLinks = payLinks.filter((l) => !ordered.some((sv) => payFor(sv.name)?.id === l.id));

  // Trust bar: only things the owner declared.
  const trust: { icon: string; text: string }[] = [];
  if (site.licenseNumber) trust.push({ icon: "✓", text: `${t.license} #${site.licenseNumber}${site.licenseState ? ` (${site.licenseState})` : ""}` });
  if (site.insured) trust.push({ icon: "◇", text: t.insured });
  if (site.yearsInBusiness) trust.push({ icon: "★", text: t.years(site.yearsInBusiness) });
  if (site.spanish) trust.push({ icon: "ñ", text: t.spanish });
  if (reach.mode === "remote") trust.push({ icon: "🌎", text: reachLabel(reach, site.lang) });
  for (const f of site.features) if (trust.length < 5) trust.push({ icon: "✓", text: f });

  const keyPoints = site.keyPoints.length > 0 ? site.keyPoints : site.highlights.map((h) => ({ title: "", text: h }));

  // Customers talk to the business only through the page chat.
  const hasChat = site.chat;
  const es = site.lang !== "en";
  const chatLong = es ? "Escríbenos ahora" : "Message us now";
  const chatShort = es ? "Pedir este servicio" : "Ask about this";
  const chatLink = (className: string, children: React.ReactNode, service?: string) => (
    <ChatLink service={service} className={className}>
      {children}
    </ChatLink>
  );

  // Structured data for search engines: only what the owner actually entered.
  const pageUrl = `${SITE_URL}/site/${business.slug}`;
  const ldImage = site.coverUrl || site.gallery[0] || site.logoUrl || "";
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: business.name,
    url: pageUrl,
  };
  if (business.pitch.trim()) ld.description = business.pitch.trim().slice(0, 500);
  if (ldImage) ld.image = ldImage;
  if (site.logoUrl) ld.logo = site.logoUrl;
  if (area) ld.areaServed = area;
  if (fromPrice !== null) {
    const hi = Math.max(...(nums as number[]));
    ld.priceRange = hi > fromPrice ? `$${fromPrice}-$${hi}` : `$${fromPrice}`;
  } else if (single && ordered[0].price && plainDollars(ordered[0].price) !== null) {
    ld.priceRange = `$${plainDollars(ordered[0].price)}`;
  }
  const ldJson = JSON.stringify(ld).replace(/</g, "\\u003c");

  return (
    <div className="mt" lang={site.lang} style={storeTheme(business.accentColor) as React.CSSProperties}>
      {live && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson }} />}
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
          <span className="header-badge">{area}</span>
        </div>
      </header>

      <main>
        <div className="wrap breadcrumb">
          <span>{business.name}</span>
          {business.category && (
            <>
              <span className="sep" aria-hidden>›</span>
              <span className="current">{business.category}</span>
            </>
          )}
        </div>

        <section className="product wrap">
          <div className="gallery-col">
            <div className="gallery-title">{business.name}</div>
            <Gallery
              items={media}
              alt={t.photoAlt(business.name)}
              lang={site.lang}
              empty={
                <div className="stage-empty">
                  {(business.category || area) && <span className="stage-kicker">{[business.category, area].filter(Boolean).join(" · ")}</span>}
                  <div className="stage-title">{mainTitle}</div>
                </div>
              }
            />
          </div>

          {(ordered.length > 0 || area || site.hours || site.googleReviewsUrl) && (
            <div className="below-gallery">
              {ordered.length > 1 && (
                <div className="pkg-card">
                  <div className="eyebrow grad-text">{t.packagesTitle}</div>
                  <ul className="pkg-list">
                    {ordered.map((sv) => {
                      const pay = payFor(sv.name);
                      return (
                        <li key={sv.id} className={sv.featured ? "lead" : undefined}>
                          <div className="pkg-main">
                            <span className="pkg-name">{sv.name}</span>
                            {sv.description && <span className="pkg-desc">{sv.description}</span>}
                          </div>
                          <span className="pkg-price grad-text">{sv.price || t.priceOnRequest}</span>
                          {pay ? (
                            <a href={`/pay/${pay.id}`} className="pkg-btn">{payText.button}</a>
                          ) : hasChat ? (
                            chatLink("pkg-btn", t.packagesAsk, sv.name)
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {(area || site.hours || site.googleReviewsUrl) && (
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
                {site.googleReviewsUrl && (
                  <a className="btn ghost" href={site.googleReviewsUrl} target="_blank" rel="noopener noreferrer nofollow" style={{ width: "fit-content" }}>
                    ★ {t.googleReviews}
                  </a>
                )}
              </div>
              )}
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
              <UntilOfferEnds endsAt={offer.endsAt}>
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
              </UntilOfferEnds>
            )}

            <h1>{mainTitle}</h1>
            {fromPrice !== null && (
              <div className="from-price">
                {t.fromPrice} <strong className="grad-text">{usd(fromPrice * 100).replace(/\.00$/, "")}</strong>
              </div>
            )}
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
              services={ordered.map((s) => {
                const link = payFor(s.name);
                return { id: s.id, name: s.name, price: s.price ?? "", payHref: link ? `/pay/${link.id}` : undefined };
              })}
              chat={site.chat ? { slug: business.slug, businessName: business.name, logoUrl: site.logoUrl, ownerName: site.ownerName, ownerPhoto: site.ownerPhotoUrl, lang: site.lang, campaign: campaign || undefined, agent: chatAgent } : null}
              ctaNote={site.ctaNote}
              lang={site.lang}
              labels={{ chooseLabel: t.chooseLabel, selected: t.selected, priceOnRequest: t.priceOnRequest, payNow: t.payNow }}
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


        {offer && hasChat && (
          <UntilOfferEnds endsAt={offer.endsAt}>
          <section className="offer-band">
            <div className="wrap offer-row">
              <div>
                <span className="offer-kicker">
                  <span className="deal-dot" /> {t.offer}
                </span>
                <div className="offer-title">{offer.label}</div>
                {offer.endsAt && (
                  <div className="offer-ends">
                    {t.endsIn} <Countdown endsAt={offer.endsAt} />
                  </div>
                )}
              </div>
              {chatLink("btn light", `${t.offerCta} →`)}
            </div>
          </section>
          </UntilOfferEnds>
        )}

        {ordered.length > 0 && (
          <section className="block services-block" id="servicios">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.servicesEyebrow}</span>
                <h2>{single ? (site.lang === "en" ? "What you get" : "Lo que recibes") : t.servicesTitle}</h2>
              </div>
              <div className={`services-grid ${ordered.length === 2 ? "n2" : ""} ${ordered.length === 4 ? "n4" : ""} ${single ? "single" : ""}`}>
                {ordered.map((s, n) => {
                  const pay = payFor(s.name);
                  const img = images.length ? images[(n + 1) % images.length] : "";
                  return (
                    <article key={s.id} className={`service-card ${s.featured ? "lead" : ""}`}>
                      <div className={`service-media ${img ? "" : "grad"}`} style={img ? { backgroundImage: `url("${img}")` } : undefined}>
                        {s.featured && !single && <span className="service-ribbon">★ {s.tag || t.featured}</span>}
                        <span className="service-price-chip">{s.price || t.priceOnRequest}</span>
                      </div>
                      <div className="service-body">
                        <h3>{s.name}</h3>
                        {s.description && <p>{s.description}</p>}
                        <div className="service-actions">
                          {pay && (
                            <a href={`/pay/${pay.id}`} className="btn pay">
                              💳 {payText.button}
                            </a>
                          )}
                          {hasChat && chatLink(`btn ${pay ? "ghost" : "chat"}`, <><ChatIcon /> {chatShort}</>, s.name)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {images.length >= 2 && (
          <section className="block wrap">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.workEyebrow}</span>
              <h2>{t.workTitle}</h2>
            </div>
            <div className={`mosaic n${Math.min(images.length, 5)}`}>
              {images.slice(0, 5).map((src, n) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={t.photoAlt(business.name)} loading="lazy" className={n === 0 ? "big" : undefined} />
              ))}
            </div>
          </section>
        )}

        {site.steps.length > 0 && (
          <section className="block steps-block">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.howEyebrow}</span>
                <h2>{t.howTitle}</h2>
              </div>
              <div className={`process-grid ${site.steps.length === 4 ? "n4" : ""}`}>
                {site.steps.map((st, n) => (
                  <div key={n} className="process-card">
                    <span className="process-num">{n + 1}</span>
                    {st.title ? <h3>{st.title}</h3> : null}
                    <p className={st.title ? undefined : "solo"}>{st.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {extraPayLinks.length > 0 && (
          <section className="block wrap" id="pagar">
            <div className="section-head">
              <span className="eyebrow grad-text">{payText.eyebrow}</span>
              <h2>{payText.title}</h2>
            </div>
            <div className={`services-grid ${extraPayLinks.length === 2 ? "n2" : ""} ${extraPayLinks.length === 4 ? "n4" : ""}`}>
              {extraPayLinks.map((l) => (
                <a key={l.id} href={`/pay/${l.id}`} className="pay-card-link">
                  <h3>{l.title}</h3>
                  {l.description && <p>{l.description}</p>}
                  <span className="pay-amount">{usd(l.amountCents)}</span>
                  <span className="btn pay pay-cta">💳 {payText.button} →</span>
                </a>
              ))}
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
                    {f.q} <span className="plus" aria-hidden>+</span>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>

      {hasChat && (
        <section className="final-cta" style={site.coverUrl ? { ["--cta-img" as string]: `url("${site.coverUrl}")` } : undefined}>
          <div className="wrap">
            {offer && (
              <UntilOfferEnds endsAt={offer.endsAt}>
                <span className="final-offer">🎁 {offer.label}</span>
              </UntilOfferEnds>
            )}
            <h2>{site.ctaTitle || t.ctaDefaultTitle}</h2>
            <p>{site.ctaText || t.ctaDefaultText}</p>
            <div className="btns">
              {chatLink("btn light", <><ChatIcon /> {chatLong}</>)}
            </div>
            {(area || site.hours) && <div className="final-meta">{[area, site.hours].filter(Boolean).join(" · ")}</div>}
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

      {site.chat && <ChatJump lang={site.lang} />}

      {hasChat && (
        <div className="sticky-cta">
          <div className="row">
            {chatLink("btn chat", <><ChatIcon /> {chatLong}</>)}
          </div>
        </div>
      )}
    </div>
  );
}
