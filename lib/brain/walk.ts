import type { Lang } from "../i18n";
import { APPROVAL_BLOCKS, type ApprovalBlock, type BusinessPlan } from "../plan";
import { pageMatchesPlan } from "../planToStore";

// The proposal is reviewed inside the Brain chat, one part at a time. A chat
// message carries a token at its end and the chat draws the matching card:
//   [[part:service]]  one part of the proposal, with Approve / Change
//   [[ideas]]         the 3 ideas to pick from (new-service path)
//   [[done]]          everything approved: go to Store / Marketing
//   [[summary]]       A and B: the whole strategy on one card, one confirmation

export const TOKEN = /\s*\[\[(part|ideas|done|market|summary)(?::([a-z]+))?\]\]\s*$/;

export const partToken = (b: ApprovalBlock) => `[[part:${b}]]`;
export const IDEAS_TOKEN = "[[ideas]]";
export const DONE_TOKEN = "[[done]]";
export const MARKET_TOKEN = "[[market]]";
export const SUMMARY_TOKEN = "[[summary]]";
// A and B review everything at once and confirm once; C goes part by part.
export const oneConfirmation = (p: BusinessPlan) => p.mode !== "agent";

export function firstPending(p: BusinessPlan): ApprovalBlock | null {
  if (p.stage !== "proposal") return null;
  return APPROVAL_BLOCKS.find((b) => !p.approvals[b]) ?? null;
}

const NAMES: Record<Lang, Record<ApprovalBlock, string>> = {
  es: { service: "Tu servicio", pitch: "Cómo te presentas", packages: "Paquetes y precios", offer: "Oferta de bienvenida", faq: "Preguntas frecuentes" },
  en: { service: "Your service", pitch: "How you present yourself", packages: "Packages and prices", offer: "Welcome offer", faq: "Frequently asked questions" },
};
export const partName = (b: ApprovalBlock, lang: Lang) => NAMES[lang][b];

const INTRO: Record<Lang, Record<ApprovalBlock, string>> = {
  es: {
    service: "Empecemos por tu servicio: qué haces, para quién y qué incluye. ¿Así está bien?",
    pitch: "Ahora, cómo te presentas: la promesa y las razones para escogerte. ¿Te suena a ti?",
    packages: "Tus paquetes y precios, con lo que se cobra en tu zona.",
    offer: "Una oferta de bienvenida ayuda a que te prueben. Es opcional: puedes dejarla, cambiarla o quitarla.",
    faq: "Última parte: las preguntas que más hacen los clientes, con tus respuestas para la página.",
  },
  en: {
    service: "Let's start with your service: what you do, for whom and what it includes. Does this look right?",
    pitch: "Now, how you present yourself: your promise and the reasons to choose you. Does it sound like you?",
    packages: "Your packages and prices, with what's charged in your area.",
    offer: "A welcome offer helps people try you. It's optional: keep it, change it or remove it.",
    faq: "Last part: the questions customers ask most, with your answers for the page.",
  },
};

// The message that shows the next part to review (or null when none is left).
const AGENT_INTRO: Record<Lang, string> = {
  es: "Empecemos por tu agente: qué servicio da, cómo trabaja con cada cliente y qué no hace nunca. ¿Así está bien?",
  en: "Let's start with your agent: what service it gives, how it works with each customer and what it never does. Does this look right?",
};
const introFor = (p: BusinessPlan, b: ApprovalBlock, lang: Lang) => (p.mode === "agent" && b === "service" ? AGENT_INTRO[lang] : INTRO[lang][b]);

export function nextPartMessage(p: BusinessPlan, lang: Lang): string | null {
  if (oneConfirmation(p)) {
    if (p.stage !== "proposal") return null;
    return `${
      lang === "es"
        ? (p.mode === "existing" ? "Aquí está tu plan para conseguir más clientes, con tu página lista para venderlo." : "Aquí está tu estrategia completa.") + " Revísala: los precios marcados «Referencia de mercado» son lo que se cobra en tu zona, no tus precios; escribe los tuyos en la tarjeta si quieres. Si algo no te gusta, dímelo aquí y lo cambio. Cuando esté bien, confírmala y paso a crear tu página."
        : (p.mode === "existing" ? "Here's your plan to get more clients, with your page ready to sell it." : "Here's your complete strategy.") + " Review it: prices marked \"Market reference\" are what's charged in your area, not your prices; type yours on the card if you like. If something's off, tell me here and I'll change it. When it's right, confirm it and I'll move on to building your page."
    }\n\n${SUMMARY_TOKEN}`;
  }
  const b = firstPending(p);
  if (!b) return null;
  return `${introFor(p, b, lang)}\n\n${partToken(b)}`;
}

// What each part is made of, to notice when the chat changed it.
export function partSignature(p: BusinessPlan, b: ApprovalBlock): string {
  switch (b) {
    case "service":
      return JSON.stringify([p.service, p.serviceIncludes, p.serviceExcludes, p.steps, p.customer, p.problem, p.agent]);
    case "pitch":
      return JSON.stringify([p.promise, p.differentiators]);
    case "packages":
      return JSON.stringify([p.packages, p.pricingNote]);
    case "offer":
      return JSON.stringify([p.offer, p.noOffer]);
    case "faq":
      return JSON.stringify(p.faq);
  }
}

// After a chat turn: what goes under the reply — the next part (with its
// intro) when the chat moved on, the same part's card again when it changed.
export function cardAfterTurn(before: BusinessPlan, after: BusinessPlan, lang: Lang): string | null {
  if (after.stage === "approved") return before.stage === "approved" ? null : DONE_TOKEN;
  if (oneConfirmation(after)) {
    if (after.stage !== "proposal") return null;
    if (before.stage !== "proposal") return SUMMARY_TOKEN;
    // A's plan for more clients is part of the card too: a change there shows it again.
    const growthChanged = JSON.stringify([before.growth, before.channels]) !== JSON.stringify([after.growth, after.channels]);
    return growthChanged || APPROVAL_BLOCKS.some((b) => partSignature(before, b) !== partSignature(after, b)) ? SUMMARY_TOKEN : null;
  }
  const now = firstPending(after);
  if (!now) return null;
  const was = firstPending(before);
  // Reopened from an approved plan: just the changed part, no "next part" intro.
  if (before.stage !== "proposal") return partToken(now);
  // The reply already introduces the next part: just its card.
  if (was !== now) return partToken(now);
  return partSignature(before, now) !== partSignature(after, now) ? partToken(now) : null;
}

// Tokens are for the screen; the model reads a plain note instead.
export function forModel(content: string, lang: Lang): string {
  // The balance warning is for the screen only.
  return content.replace(/\n\n⚠ [\s\S]*$/, "").replace(TOKEN, (_m, kind: string, arg?: string) => {
    if (kind === "part" && arg && (APPROVAL_BLOCKS as string[]).includes(arg))
      return lang === "es" ? `\n(Tarjeta mostrada: ${partName(arg as ApprovalBlock, lang)})` : `\n(Card shown: ${partName(arg as ApprovalBlock, lang)})`;
    if (kind === "ideas") return lang === "es" ? "\n(Tarjeta mostrada: las ideas)" : "\n(Card shown: the ideas)";
    if (kind === "summary") return lang === "es" ? "\n(Tarjeta mostrada: la estrategia completa con el botón Confirmar)" : "\n(Card shown: the whole strategy with the Confirm button)";
    if (kind === "market") return lang === "es" ? "\n(Tarjeta mostrada: lo que encontré en el mercado)" : "\n(Card shown: what I found in the market)";
    return lang === "es" ? "\n(Tarjeta mostrada: expediente aprobado)" : "\n(Card shown: plan approved)";
  });
}

// ---------- after the approval: what the page really has ----------
export type PageState = "built" | "stale" | "todo";
// "built": the page has what was just approved. "stale": a page exists but
// was made from an earlier version (Store offers «Actualizar mi página»).
// "todo": no page yet.
export function pageState(filled: boolean, hasPage: boolean, b: { plan: BusinessPlan; site: { fromPlan: string } } | undefined): PageState {
  if (filled) return "built";
  if (!hasPage) return "todo";
  return b && pageMatchesPlan(b.site.fromPlan, b.plan) ? "built" : "stale";
}

// What comes after the Brain, said every time the strategy is approved: the
// owner never has to guess the next step.
export function nextSteps(lang: Lang, page: PageState, hasOffer = true): string {
  const es = lang === "es";
  // Only what the strategy really has (never "tu oferta" when there is none).
  const what = es ? (hasOffer ? "tu servicio, tus precios, tu oferta y tus preguntas" : "tu servicio, tus precios y tus preguntas") : hasOffer ? "your service, prices, offer and FAQ" : "your service, prices and FAQ";
  const store = es
    ? page === "built"
      ? `ya armé tu página con lo que aprobamos: ${what}. Revísala, agrega fotos tuyas y de tu trabajo, y cambia lo que quieras.`
      : page === "stale"
        ? "tu página todavía muestra la versión anterior: no la cambié sin tu permiso, porque ya la habías armado. Ahí toca «Actualizar mi página» para pasarle lo que acabamos de aprobar, y revisa tus fotos y textos."
        : `ahí se arma tu página con lo que aprobamos: ${what}. Revísala, agrega fotos tuyas y de tu trabajo, y cambia lo que quieras.`
    : page === "built"
      ? `I already built your page from what we approved: ${what}. Review it, add photos of you and your work, and change anything you like.`
      : page === "stale"
        ? "your page still shows the earlier version: I didn't change it without your OK, since you had already built it. Tap \"Update my page\" there to bring in what we just approved, and check your photos and texts."
        : `your page is built there from what we approved: ${what}. Review it, add photos of you and your work, and change anything you like.`;
  const tap = es
    ? page === "stale"
      ? "Toca «Armar mi página en Store» y luego «Actualizar mi página»."
      : "Toca «Armar mi página en Store» para empezar."
    : page === "stale"
      ? "Tap \"Build my page in Store\", then \"Update my page\"."
      : "Tap \"Build my page in Store\" to start.";
  return es
    ? `¡Listo, tu estrategia está aprobada! Esto es lo que sigue, paso a paso:\n1. Store (ya abierto): ${store}\n2. Publicar: cuando te guste, la publicas en sevrii.com y tus clientes te escriben por su chat.\n3. Pagos (opcional): conecta tu cuenta en Payments para que tus clientes paguen con tarjeta. Puedes publicar sin esto y conectarlo cuando quieras.\n4. Afiliados (opcional): otras personas pueden vender tu servicio y tú les pagas una comisión. Payments, Afiliados y publicar vienen en el plan Starter.\n${tap}`
    : `Done, your strategy is approved! Here's what comes next, step by step:\n1. Store (now open): ${store}\n2. Publish: when you like it, publish it on sevrii.com and customers message you through its chat.\n3. Payments (optional): connect your account in Payments so customers can pay by card. You can publish without it and connect it whenever you want.\n4. Affiliates (optional): other people can sell your service and you pay them a commission. Payments, Affiliates and publishing come with the Starter plan.\n${tap}`;
}
