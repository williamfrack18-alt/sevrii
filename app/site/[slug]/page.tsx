import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getBusinessBySlug, getUserById, listServices, listPaymentLinks, incrementPageViews, type BusinessRow } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { STORE_TEXT } from "@/lib/storeI18n";
import { reachLabel, resolveReach } from "@/lib/reach";
import { activeOffer, contactChannels, formatPhone, normalizePhone, storeTheme } from "@/lib/site";
import { BuyActions, ChannelIcon, ContactLink, Countdown, Gallery, Track, type MediaItem } from "./StoreParts";
import ChatWidget from "./ChatWidget";
import "./store.css";
import { CHAT_HEAD, channelClass, type ContactChannel } from "@/lib/storeContact";

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
  // Payment links the owner turned on (only when their Stripe account can take payments).
  const payLinks = business.payStatus === "ready" ? (await listPaymentLinks(business.id)).filter((l) => l.active).slice(0, 6) : [];
  const payText =
    site.lang === "en"
      ? { eyebrow: "Pay online", title: "Book and pay here", button: "Pay" }
      : { eyebrow: "Paga en línea", title: "Reserva y paga aquí", button: "Pagar" };
  const usd = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(c / 100);

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
  // Where they work: their own words first, else the service area they set.
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

  // Lowest price shown as "From $X" (only when prices are plain dollar amounts).
  const nums = ordered.map((x) => /\$\s?([\d,]+(?:\.\d+)?)/.exec(x.price || "")).filter(Boolean).map((m) => Number(m![1].replace(/,/g, "")));
  const fromPrice = nums.length ? Math.min(...nums) : null;
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

  // Calls, texts, WhatsApp and the quote form, best first (US-friendly order).
  const channels = contactChannels(site, business.whatsapp);
  const contact = { channels, wa, phone };
  const primary: ContactChannel | null = channels[0] ?? null;
  const msgs = { msgService: t.msgService("{biz}", "{svc}"), msgGeneric: t.msgGeneric("{biz}") };
  const long: Record<ContactChannel, string> = { call: t.callNow, text: t.text, whatsapp: t.writeWhatsapp, chat: t.chatBtn };
  const short: Record<ContactChannel, string> = { call: t.call, text: t.textShort, whatsapp: "WhatsApp", chat: t.chatShort };
  const link = (c: ContactChannel, className: string, children: React.ReactNode, service?: string) => (
    <ContactLink key={c} channel={c} businessId={business.id} businessName={business.name} service={service} contact={contact} labels={msgs} className={className}>
      {children}
    </ContactLink>
  );

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
              items={media}
              alt={t.photoAlt(business.name)}
              empty={
                <div className="stage-empty">
                  <span className="stage-kicker">{business.category}{area ? ` · ${area}` : ""}</span>
                  <div className="stage-title">{mainTitle}</div>
                </div>
              }
            />
          </div>

          {(ordered.length > 0 || area || site.hours || phone || site.googleReviewsUrl) && (
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
                          ) : primary ? (
                            link(primary, "pkg-btn", t.packagesAsk, sv.name)
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {(area || site.hours || phone || site.googleReviewsUrl) && (
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
              businessId={business.id}
              businessName={business.name}
              services={ordered.map((s) => {
                const link = payFor(s.name);
                return { id: s.id, name: s.name, price: s.price ?? "", payHref: link ? `/pay/${link.id}` : undefined };
              })}
              contact={contact}
              ctaNote={site.ctaNote}
              labels={{
                ...long,
                ...msgs,
                chooseLabel: t.chooseLabel,
                selected: t.selected,
                priceOnRequest: t.priceOnRequest,
                noContact: t.noContact,
                payNow: t.payNow,
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

        {site.chat && (
          <section className="block quote-block" id="chat">
            <div className="wrap quote-grid">
              <div className="quote-side">
                <span className="eyebrow">{CHAT_HEAD[site.lang].eyebrow}</span>
                <h2>{CHAT_HEAD[site.lang].title}</h2>
                <p>{CHAT_HEAD[site.lang].sub(business.name)}</p>
                <div className="quote-alt">
                  {link("chat", "btn chat", <><ChannelIcon c="chat" /> {CHAT_HEAD[site.lang].open}</>)}
                  {channels.filter((c) => c !== "chat").map((c) => link(c, "btn ghost-light", <><ChannelIcon c={c} /> {c === "call" && phone ? formatPhone(phone) : short[c]}</>))}
                </div>
                {(area || site.hours) && <div className="quote-meta">{[area, site.hours].filter(Boolean).join(" · ")}</div>}
              </div>
              {link(
                "chat",
                "chat-preview",
                <>
                  <span className="cp-head">
                    <span className="cp-avatar">{business.name.slice(0, 1).toUpperCase()}</span>
                    <span>
                      <strong>{business.name}</strong>
                      <em>● {site.lang === "en" ? "Replies instantly" : "Responde al instante"}</em>
                    </span>
                  </span>
                  <span className="cp-bubble">
                    {site.lang === "en" ? "Hi! 👋 Thanks for reaching out. How can we help you?" : "¡Hola! 👋 Gracias por escribirnos. ¿En qué te podemos ayudar?"}
                  </span>
                  <span className="cp-input">{site.lang === "en" ? "Type your message…" : "Escribe tu mensaje…"} <span className="cp-send">→</span></span>
                </>
              )}
            </div>
          </section>
        )}

        {offer && primary && (
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
              {link(primary, "btn light", `${t.offerCta} →`)}
            </div>
          </section>
        )}

        {ordered.length > 0 && (
          <section className="block services-block" id="servicios">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.servicesEyebrow}</span>
                <h2>{single ? (site.lang === "en" ? "What you get" : "Lo que recibes") : t.servicesTitle}</h2>
              </div>
              <div className={`services-grid ${ordered.length === 4 ? "n4" : ""} ${single ? "single" : ""}`}>
                {ordered.map((s, n) => {
                  const pay = payFor(s.name);
                  const [c1, c2] = channels;
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
                          {c1 && link(c1, `btn ${pay ? "ghost" : channelClass(c1, true)}`, <><ChannelIcon c={c1} /> {short[c1]}</>, s.name)}
                          {c2 && !pay && link(c2, "btn ghost", <><ChannelIcon c={c2} /> {short[c2]}</>, s.name)}
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
            <div className="services-grid">
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
                    {f.q} <span className="plus">+</span>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>

      {primary && (
        <section className="final-cta" style={site.coverUrl ? { ["--cta-img" as string]: `url("${site.coverUrl}")` } : undefined}>
          <div className="wrap">
            {offer && <span className="final-offer">🎁 {offer.label}</span>}
            <h2>{site.ctaTitle || t.ctaDefaultTitle}</h2>
            <p>{site.ctaText || t.ctaDefaultText}</p>
            <div className="btns">
              {link(primary, `btn ${primary === "whatsapp" ? "wa" : "light"}`, <><ChannelIcon c={primary} /> {long[primary]}</>)}
              {channels.slice(1, 3).map((c) => link(c, "btn ghost-light", <><ChannelIcon c={c} /> {c === "call" && phone ? formatPhone(phone) : short[c]}</>))}
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

      {site.chat && <ChatWidget slug={business.slug} businessName={business.name} logoUrl={site.logoUrl} ownerName={site.ownerName} ownerPhoto={site.coverUrl} lang={site.lang} />}

      {primary && (
        <div className="sticky-cta">
          <div className="row">
            {link(primary, `btn ${channelClass(primary, true)}`, <><ChannelIcon c={primary} /> {short[primary]}</>)}
            {channels.slice(1, 3).map((c) => link(c, "btn ghost", <><ChannelIcon c={c} /> {short[c]}</>))}
          </div>
        </div>
      )}
    </div>
  );
}
