// The page of a service agent: an AI that delivers the owner's service in the
// chat. It sells differently from a service done by people: the chat is the
// product, the visitor tries it for free first, pays for access inside the
// chat, and needs to see who made it and why it's worth more than a free AI.
import { completeFrom } from "@/lib/planToStore";
import type { BusinessRow } from "@/lib/db";
import { activeOffer, storeTheme } from "@/lib/site";
import { reachLabel, resolveReach } from "@/lib/reach";
import { STORE_TEXT } from "@/lib/storeI18n";
import { money, offerPriceLabel, welcomeFor, welcomeLabel } from "@/lib/serviceAgentConfig";
import ChatWidget, { ChatJump, type ChatAgent } from "./ChatWidget";
import { ChatIcon, ChatLink, Gallery, type MediaItem } from "./StoreParts";

const TEXT = {
  es: {
    kicker: "Agente de IA · disponible 24/7",
    tryFree: "Pruébalo gratis",
    seePrices: "Ver precios",
    free: (n: number) => (n === 0 ? "Pago antes de empezar" : n === 1 ? "1 respuesta gratis" : `${n} respuestas gratis`),
    instant: "Responde al instante",
    from: (p: string) => `Desde ${p}`,
    createdBy: "Creado por",
    whyEyebrow: "Por qué este agente",
    whyTitle: "Lo que no te da un chat genérico",
    howEyebrow: "Cómo funciona",
    howTitle: "Empieza en un minuto",
    how: (n: number, name: string) => [
      { t: "Pruébalo gratis", d: n ? `Escríbele en el chat. Las primeras ${n === 1 ? "respuesta es gratis" : `${n} respuestas son gratis`}, sin registrarte.` : "Escríbele en el chat, sin registrarte." },
      { t: "Escoge tu acceso", d: "Cuando quieras seguir, eliges por días o por mes y pagas con tarjeta ahí mismo." },
      { t: `Trabaja con ${name}`, d: "Te acompaña paso a paso, a cualquier hora, mientras dure tu acceso." },
    ],
    methodTitle: "Su método",
    accessEyebrow: "Acceso",
    accessTitle: "Elige cómo usarlo",
    accessCta: "Empezar gratis",
    accessNote: "Primero lo pruebas gratis. Pagas dentro del chat, con tarjeta, solo si quieres seguir.",
    limitsEyebrow: "Con confianza",
    limitsTitle: (name: string) => `Lo que ${name} no hace`,
    honest: (agent: string, owner: string) => `${agent} es un agente de IA y siempre te lo dice. Detrás está ${owner ? `${owner}, quien lo creó` : "la persona que lo creó"}: lee las conversaciones y entra al chat cuando hace falta.`,
    faqEyebrow: "Preguntas frecuentes",
    faqTitle: "Antes de empezar",
    finalTitle: (name: string) => `Prueba ${name} ahora`,
    finalText: "Escríbele en el chat. Sin registrarte, sin tarjeta para la prueba.",
    always: "Te guía y te acompaña paso a paso, pero no hace el trámite por ti ni reemplaza a la oficina oficial ni a un profesional con licencia cuando la ley lo pide. No promete resultados.",
    reviewsEyebrow: "Reseñas",
    reviewsTitle: "Lo que dicen sus clientes",
    reviewsNone: "Todavía no tiene reseñas. Solo quienes pagan su acceso pueden calificarlo.",
    reviewsCount: (n: number) => (n === 1 ? "1 reseña" : `${n} reseñas`),
    verified: "Compró acceso",
    agents: "Agentes de IA",
    agentBadge: "Agente de IA",
    accessKicker: "Acceso",
    infoTitle: "Sobre el agente",
    madeBy: "Creado por",
    langs: "Idiomas",
    langNames: { es: "Español", en: "Inglés", both: "Español e inglés" } as Record<string, string>,
    where: "Atiende",
    hours: "Horario",
    always247: "24 horas, todos los días",
    tryNote: (n: number) => (n ? `${n === 1 ? "1 respuesta gratis" : `${n} respuestas gratis`} · pagas solo si quieres seguir` : "Pagas dentro del chat, con tarjeta"),
    trust: ["Siempre dice que es una IA", "Responde al instante, 24/7", "Pagas dentro del chat, con tarjeta"],
    welcome: "Oferta de bienvenida",
  },
  en: {
    kicker: "AI agent · available 24/7",
    tryFree: "Try it free",
    seePrices: "See prices",
    free: (n: number) => (n === 0 ? "Pay before you start" : n === 1 ? "1 free reply" : `${n} free replies`),
    instant: "Replies instantly",
    from: (p: string) => `From ${p}`,
    createdBy: "Created by",
    whyEyebrow: "Why this agent",
    whyTitle: "What a generic chat won't give you",
    howEyebrow: "How it works",
    howTitle: "Start in a minute",
    how: (n: number, name: string) => [
      { t: "Try it free", d: n ? `Write to it in the chat. The first ${n === 1 ? "reply is" : `${n} replies are`} free, no sign-up.` : "Write to it in the chat, no sign-up." },
      { t: "Pick your access", d: "When you want to keep going, choose by the day or by the month and pay by card right there." },
      { t: `Work with ${name}`, d: "It guides you step by step, any time, while your access lasts." },
    ],
    methodTitle: "Its method",
    accessEyebrow: "Access",
    accessTitle: "Choose how to use it",
    accessCta: "Start free",
    accessNote: "Try it free first. You pay inside the chat, by card, only if you want to keep going.",
    limitsEyebrow: "With confidence",
    limitsTitle: (name: string) => `What ${name} doesn't do`,
    honest: (agent: string, owner: string) => `${agent} is an AI agent and always tells you so. Behind it is ${owner ? `${owner}, who created it` : "the person who created it"}: they read the conversations and join the chat when needed.`,
    faqEyebrow: "Frequently asked questions",
    faqTitle: "Before you start",
    finalTitle: (name: string) => `Try ${name} now`,
    finalText: "Write to it in the chat. No sign-up, no card for the trial.",
    always: "It guides you step by step, but it doesn't do the paperwork for you or replace the official office or a licensed professional when the law requires one. It doesn't promise results.",
    reviewsEyebrow: "Reviews",
    reviewsTitle: "What its customers say",
    reviewsNone: "No reviews yet. Only people who pay for access can rate it.",
    reviewsCount: (n: number) => (n === 1 ? "1 review" : `${n} reviews`),
    verified: "Bought access",
    agents: "AI agents",
    agentBadge: "AI agent",
    accessKicker: "Access",
    infoTitle: "About the agent",
    madeBy: "Created by",
    langs: "Languages",
    langNames: { es: "Spanish", en: "English", both: "English and Spanish" } as Record<string, string>,
    where: "Serves",
    hours: "Hours",
    always247: "24 hours, every day",
    tryNote: (n: number) => (n ? `${n === 1 ? "1 free reply" : `${n} free replies`} · pay only if you want to keep going` : "You pay inside the chat, by card"),
    trust: ["Always says it's an AI", "Replies instantly, 24/7", "Pay inside the chat, by card"],
    welcome: "Welcome offer",
  },
};

export default function AgentPage({
  business,
  live,
  campaign,
  chatAgent,
  reviews,
}: {
  reviews: { list: { id: string; rating: number; text: string; name: string; createdAt: string }[]; avg: number | null; count: number };
  business: BusinessRow;
  live: boolean;
  campaign: string;
  chatAgent: ChatAgent | null;
}) {
  const site = business.site;
  // The full title, never one cut by an older limit.
  const headline = completeFrom(site.headline, business.plan);
  const lang = site.lang === "en" ? "en" : "es";
  const t = TEXT[lang];
  const st = STORE_TEXT[site.lang].site;
  const a = business.serviceAgent;
  // "Created by": only the creator's name, never credentials or a story.
  const creator = site.ownerName || a.creator.split(/[·,|(]/)[0].trim() || business.name;
  // An agent named like its creator would read "PasaDMV, created by PasaDMV":
  // the agent gets "IA"/"AI" so agent and owner are never the same name.
  const baseName = a.name || business.name;
  const name = baseName.trim().toLowerCase() === creator.trim().toLowerCase() && !/\b(IA|AI)\b/.test(baseName) ? `${baseName} ${lang === "es" ? "IA" : "AI"}` : baseName;
  // "Creado por" shows a person: the owner's name. The brand (the business or
  // the agent's own name) is not a creator, so until the owner gives their
  // name the row stays hidden (Store asks for it).
  const same = (x: string, y: string) => x.trim().toLowerCase() === y.trim().toLowerCase();
  const person = [site.ownerName, a.creator.split(/[·,|(]/)[0]].map((x) => (x || "").trim()).find((x) => x && !same(x, business.name) && !same(x, baseName) && !same(x, name)) || "";
  const owner = site.ownerName || business.name;
  const offer = activeOffer(site);
  const cheapest = a.offers.length ? Math.min(...a.offers.map((o) => o.priceCents)) : 0;
  const edge = a.edge.length ? a.edge : site.keyPoints.slice(0, 4);
  const photo = site.ownerPhotoUrl;
  const reach = resolveReach(site, business.city, business.plan.profile);
  const area = site.serviceArea || reachLabel(reach, site.lang) || "";
  const langs = t.langNames[business.plan.profile.languages] || (site.spanish ? t.langNames.both : "");
  // The best first-purchase deal among the access options, if any.
  // The welcome deal for the whole page: which access options it covers, not a
  // single price that only fits one of them (each card shows its own price).
  const welcomeOffers = a.offers.filter((o) => welcomeLabel(a, o, lang));
  const welcomePct = welcomeOffers.length ? welcomeFor(a, welcomeOffers[0]) : 0;
  const welcome = !welcomeOffers.length
    ? ""
    : welcomeOffers.length === 1
      ? `${welcomeLabel(a, welcomeOffers[0], lang)} (${welcomeOffers[0].title})`
      : welcomeOffers.length === a.offers.length
        ? lang === "es" ? `${welcomePct}% menos en tu primera compra, en cualquier plan` : `${welcomePct}% off your first purchase, on any plan`
        : lang === "es"
          ? `${welcomePct}% menos en tu primera compra de ${welcomeOffers.map((o) => `«${o.title}»`).join(" o ")}`
          : `${welcomePct}% off your first purchase of ${welcomeOffers.map((o) => `"${o.title}"`).join(" or ")}`;
  // The left side: the creator's video and photos, then a card per access option.
  const media: MediaItem[] = [];
  if (site.videoUrl) media.push({ kind: "video", src: site.videoUrl, poster: site.coverUrl, label: name });
  for (const src of [site.coverUrl, ...site.gallery].filter(Boolean)) media.push({ kind: "photo", src });
  media.push({ kind: "slide", tone: "service", kicker: t.kicker, title: headline || name, price: cheapest > 0 ? t.from(money(cheapest)) : t.free(a.freeReplies), text: t.free(a.freeReplies) });
  if (welcome) media.push({ kind: "slide", tone: "offer", kicker: t.welcome, title: welcome, price: "", text: name });
  for (const o of a.offers.slice(0, 3)) media.push({ kind: "slide", tone: "service", kicker: t.accessKicker, title: o.title, price: offerPriceLabel(o, lang), text: o.detail || "" });
  const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

  return (
    <div className="mt ag" lang={site.lang} style={storeTheme(business.accentColor) as React.CSSProperties}>
      {!live && <div className="draft-bar">{st.draftBanner}</div>}

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
          <span className="header-badge">{t.kicker}</span>
        </div>
      </header>

      <main>
        <div className="wrap breadcrumb">
          <span>{t.agents}</span>
          <span className="sep" aria-hidden>›</span>
          <span className="current">{name}</span>
        </div>

        {/* Same product layout as every Sevrii page: media on the left, the
            buy box (with the live chat, which is the product) on the right. */}
        <section className="product wrap">
          <div className="gallery-col">
            <div className="gallery-title">{name}</div>
            <Gallery items={media} alt={name} lang={site.lang} empty={<div className="stage-empty"><span className="stage-kicker">{t.kicker}</span><div className="stage-title">{headline || name}</div></div>} />
          </div>

          <div className="below-gallery">
            {a.offers.length > 0 && (
              <div className="pkg-card">
                <div className="eyebrow grad-text">{t.accessTitle}</div>
                <ul className="pkg-list">
                  {a.offers.map((o, i) => (
                    <li key={o.id} className={i === 0 ? "lead" : undefined}>
                      <div className="pkg-main">
                        <span className="pkg-name">{o.title}</span>
                        {o.detail && <span className="pkg-desc">{o.detail}</span>}
                      </div>
                      <span className="pkg-price grad-text">{offerPriceLabel(o, lang)}</span>
                      <ChatLink className="pkg-btn">{t.accessCta}</ChatLink>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="info-card">
              <div className="eyebrow grad-text">{t.infoTitle}</div>
              {person && (
                <div className="ag-maker">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" />
                  ) : (
                    <span className="ag-maker-initial">{person.slice(0, 1).toUpperCase()}</span>
                  )}
                  <span>
                    <span className="k">{t.madeBy}</span>
                    <span className="v">{person}</span>
                  </span>
                </div>
              )}
              {langs && (
                <div className="info-row">
                  <span className="k">{t.langs}</span>
                  <span className="v">{langs}</span>
                </div>
              )}
              {area && (
                <div className="info-row">
                  <span className="k">{t.where}</span>
                  <span className="v">{area}</span>
                </div>
              )}
              <div className="info-row">
                <span className="k">{t.hours}</span>
                <span className="v">{t.always247}</span>
              </div>
            </div>
          </div>

          <div className="buybox">
            <div className="badge-row">
              <span className="badge">● {t.agentBadge}</span>
              <span className="badge soft">{t.instant}</span>
              {reviews.count > 0 && reviews.avg !== null && (
                <a href="#resenas" className="badge soft">
                  ★ {reviews.avg.toFixed(1)} · {t.reviewsCount(reviews.count)}
                </a>
              )}
            </div>

            {(welcome || offer) && (
              <div className="deal">
                <span className="deal-dot" />
                <strong>{t.welcome}</strong> · {welcome || offer?.label}
              </div>
            )}

            <h1>{headline || name}</h1>
            {cheapest > 0 && (
              <div className="from-price">
                {t.from("")}
                <strong className="grad-text">{money(cheapest)}</strong>
              </div>
            )}
            {business.pitch && <p className="lede">{business.pitch}</p>}

            {edge.length > 0 && (
              <ul className="about-list">
                {edge.slice(0, 4).map((e, i) => (
                  <li key={i}>
                    {e.title ? <strong>{e.title}:</strong> : null} {e.text}
                  </li>
                ))}
              </ul>
            )}

            <div id="chat" className="buy-chat">
              <ChatWidget
                slug={business.slug}
                businessName={business.name}
                logoUrl={site.logoUrl}
                ownerName={site.ownerName}
                ownerPhoto={site.ownerPhotoUrl}
                lang={lang}
                campaign={campaign || undefined}
                agent={chatAgent}
              />
            </div>
            <div className="micro">
              <span className="dot" /> {t.tryNote(a.freeReplies)}
            </div>
          </div>
        </section>

        <section className="trust">
          <div className="wrap">
            <div className="trust-grid">
              {[...t.trust, ...(langs ? [langs] : []), ...(area ? [area] : [])].slice(0, 4).map((x) => (
                <div key={x} className="trust-item">
                  <div className="trust-icon">✓</div>
                  <span>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="block ag-how">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.howEyebrow}</span>
              <h2>{t.howTitle}</h2>
            </div>
            <div className="ag-steps">
              {t.how(a.freeReplies, name).map((s, i) => (
                <div key={i} className="ag-step">
                  <span className="ag-step-n">{i + 1}</span>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              ))}
            </div>
            {site.steps.length > 0 && (
              <div className="ag-method">
                <h3>{t.methodTitle}</h3>
                <ol>
                  {site.steps.map((s, i) => (
                    <li key={i}>
                      {s.title && <strong>{s.title}. </strong>}
                      {s.text}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </section>

        {a.offers.length > 0 && (
          <section className="block ag-access" id="acceso">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.accessEyebrow}</span>
                <h2>{t.accessTitle}</h2>
              </div>
              <div className={`ag-grid n${Math.min(a.offers.length, 3)}`}>
                {a.offers.map((o, i) => {
                  const w = welcomeLabel(a, o, lang);
                  return (
                    <div key={o.id} className={`ag-price ${i === 1 || a.offers.length === 1 ? "lead" : ""}`}>
                      <h3>{o.title}</h3>
                      {o.detail && <p>{o.detail}</p>}
                      <div className="ag-amount grad-text">{offerPriceLabel(o, lang)}</div>
                      {w && <div className="ag-welcome">{w}</div>}
                      <ChatLink className="btn ag-btn">{t.accessCta}</ChatLink>
                    </div>
                  );
                })}
              </div>
              <p className="ag-note">{t.accessNote}</p>
            </div>
          </section>
        )}

        <section className="block ag-limits">
          <div className="wrap ag-limits-in">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.limitsEyebrow}</span>
              <h2>{t.limitsTitle(name)}</h2>
              <p className="ag-lede">{t.honest(name, person)}</p>
            </div>
            <ul>
              <li>{t.always}</li>
              {a.limits.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="block ag-reviews" id="resenas">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow grad-text">{t.reviewsEyebrow}</span>
              <h2>{t.reviewsTitle}</h2>
              {reviews.count > 0 && reviews.avg !== null && (
                <p className="ag-lede">
                  <span className="ag-stars" aria-hidden>{stars(reviews.avg)}</span> {reviews.avg.toFixed(1)} · {t.reviewsCount(reviews.count)}
                </p>
              )}
            </div>
            {reviews.list.length ? (
              <div className={`ag-grid n${Math.min(reviews.list.length, 3)}`}>
                {reviews.list.map((r) => (
                  <div key={r.id} className="ag-card ag-review">
                    <span className="ag-stars" aria-label={`${r.rating}/5`}>{stars(r.rating)}</span>
                    {r.text && <p>{r.text}</p>}
                    <span className="ag-review-by">
                      {r.name} · {t.verified}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="ag-note">{t.reviewsNone}</p>
            )}
          </div>
        </section>

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

      <section className="final-cta">
        <div className="wrap">
          <h2>
            {/* The agent's name never breaks across lines (normal spaces, so copy/paste and readers see "PasaDMV IA"). */}
            {t.finalTitle("\u0001").split("\u0001")[0]}
            <span style={{ whiteSpace: "nowrap" }}>{name}</span>
            {t.finalTitle("\u0001").split("\u0001")[1]}
          </h2>
          <p>{t.finalText}</p>
          <div className="btns">
            <ChatLink className="btn light">
              <ChatIcon /> {t.tryFree}
            </ChatLink>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <div className="footer-row">
            <p className="footer-legal">{site.disclaimer || st.builtWith(business.name)}</p>
            <div className="footer-links">
              {site.disclaimer && <a href="/">{st.builtWith(business.name)}</a>}
              <a href={`/report/${business.slug}`}>{st.report}</a>
            </div>
          </div>
        </div>
      </footer>

      <ChatJump lang={lang} label={t.tryFree} />
      <div className="sticky-cta">
        <div className="row">
          <ChatLink className="btn chat">
            <ChatIcon /> {t.tryFree}
          </ChatLink>
        </div>
      </div>
    </div>
  );
}
