// The page of a service agent: an AI that delivers the owner's service in the
// chat. It sells differently from a service done by people: the chat is the
// product, the visitor tries it for free first, pays for access inside the
// chat, and needs to see who made it and why it's worth more than a free AI.
import type { BusinessRow } from "@/lib/db";
import { activeOffer, storeTheme } from "@/lib/site";
import { STORE_TEXT } from "@/lib/storeI18n";
import { money, offerPriceLabel, welcomeLabel } from "@/lib/serviceAgentConfig";
import ChatWidget, { ChatJump, type ChatAgent } from "./ChatWidget";
import { ChatIcon, ChatLink } from "./StoreParts";

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
    honest: (owner: string) => `Siempre te dice que es una IA. ${owner} lee las conversaciones y entra al chat cuando hace falta.`,
    faqEyebrow: "Preguntas frecuentes",
    faqTitle: "Antes de empezar",
    finalTitle: (name: string) => `Prueba ${name} ahora`,
    finalText: "Escríbele en el chat. Sin registrarte, sin tarjeta para la prueba.",
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
    honest: (owner: string) => `It always tells you it's an AI. ${owner} reads the conversations and joins the chat when needed.`,
    faqEyebrow: "Frequently asked questions",
    faqTitle: "Before you start",
    finalTitle: (name: string) => `Try ${name} now`,
    finalText: "Write to it in the chat. No sign-up, no card for the trial.",
  },
};

export default function AgentPage({
  business,
  live,
  campaign,
  chatAgent,
}: {
  business: BusinessRow;
  live: boolean;
  campaign: string;
  chatAgent: ChatAgent | null;
}) {
  const site = business.site;
  const lang = site.lang === "en" ? "en" : "es";
  const t = TEXT[lang];
  const st = STORE_TEXT[site.lang].site;
  const a = business.serviceAgent;
  const name = a.name || business.name;
  const owner = site.ownerName || business.name;
  const offer = activeOffer(site);
  const cheapest = a.offers.length ? Math.min(...a.offers.map((o) => o.priceCents)) : 0;
  const edge = a.edge.length ? a.edge : site.keyPoints.slice(0, 4);
  const photo = site.ownerPhotoUrl || site.coverUrl;

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
        <section className="ag-hero">
          <div className="wrap ag-hero-in">
            <div className="ag-copy">
              <span className="ag-kicker">
                <span className="ag-dot" aria-hidden /> {t.kicker}
              </span>
              <h1>{site.headline || name}</h1>
              {business.pitch && <p className="ag-lede">{business.pitch}</p>}
              <div className="ag-facts">
                <span>{t.free(a.freeReplies)}</span>
                <span>{t.instant}</span>
                {cheapest > 0 && <span>{t.from(money(cheapest))}</span>}
              </div>
              {offer && <div className="ag-offer">{offer.label}</div>}
              <div className="ag-cta">
                <ChatLink className="btn ag-btn">
                  <ChatIcon /> {t.tryFree}
                </ChatLink>
                {a.offers.length > 0 && (
                  <a href="#acceso" className="btn ghost ag-btn2">
                    {t.seePrices}
                  </a>
                )}
              </div>
              {(a.creator || site.ownerName) && (
                <div className="ag-creator">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" />
                  ) : (
                    <span className="ag-initial">{owner.slice(0, 1).toUpperCase()}</span>
                  )}
                  <div>
                    <div className="ag-by">{t.createdBy}</div>
                    <div className="ag-who">{a.creator || owner}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="ag-chat" id="chat">
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
          </div>
        </section>

        {edge.length > 0 && (
          <section className="block ag-why">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.whyEyebrow}</span>
                <h2>{t.whyTitle}</h2>
              </div>
              <div className={`ag-grid n${Math.min(edge.length, 4)}`}>
                {edge.map((e, i) => (
                  <div key={i} className="ag-card">
                    <span className="ag-num">{String(i + 1).padStart(2, "0")}</span>
                    {e.title && <h3>{e.title}</h3>}
                    <p>{e.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

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

        {a.limits.length > 0 && (
          <section className="block ag-limits">
            <div className="wrap ag-limits-in">
              <div className="section-head">
                <span className="eyebrow grad-text">{t.limitsEyebrow}</span>
                <h2>{t.limitsTitle(name)}</h2>
                <p className="ag-lede">{t.honest(owner)}</p>
              </div>
              <ul>
                {a.limits.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
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

      <section className="final-cta">
        <div className="wrap">
          <h2>{t.finalTitle(name)}</h2>
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
