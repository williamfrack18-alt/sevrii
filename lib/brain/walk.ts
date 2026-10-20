import type { Lang } from "../i18n";
import { APPROVAL_BLOCKS, type ApprovalBlock, type BusinessPlan } from "../plan";

// The proposal is reviewed inside the Brain chat, one part at a time. A chat
// message carries a token at its end and the chat draws the matching card:
//   [[part:service]]  one part of the proposal, with Approve / Change
//   [[ideas]]         the 3 ideas to pick from (new-service path)
//   [[done]]          everything approved: go to Store / Marketing

export const TOKEN = /\s*\[\[(part|ideas|done)(?::([a-z]+))?\]\]\s*$/;

export const partToken = (b: ApprovalBlock) => `[[part:${b}]]`;
export const IDEAS_TOKEN = "[[ideas]]";
export const DONE_TOKEN = "[[done]]";

export function firstPending(p: BusinessPlan): ApprovalBlock | null {
  if (p.stage !== "proposal") return null;
  return APPROVAL_BLOCKS.find((b) => !p.approvals[b]) ?? null;
}

const NAMES: Record<Lang, Record<ApprovalBlock, string>> = {
  es: { service: "Tu servicio", pitch: "Cómo te presentas", packages: "Paquetes y precios", offer: "Oferta de bienvenida", campaign: "Tipo de campaña", faq: "Preguntas frecuentes" },
  en: { service: "Your service", pitch: "How you present yourself", packages: "Packages and prices", offer: "Welcome offer", campaign: "Campaign type", faq: "Frequently asked questions" },
};
export const partName = (b: ApprovalBlock, lang: Lang) => NAMES[lang][b];

const INTRO: Record<Lang, Record<ApprovalBlock, string>> = {
  es: {
    service: "Empecemos por tu servicio: qué haces, para quién y qué incluye. ¿Así está bien?",
    pitch: "Ahora, cómo te presentas: la promesa y las razones para escogerte. ¿Te suena a ti?",
    packages: "Tus paquetes y precios. Los armé con tus costos y lo que se cobra en tu zona.",
    offer: "Una oferta de bienvenida ayuda a que te prueben. Es opcional: puedes dejarla, cambiarla o quitarla.",
    campaign: "Así te buscaría clientes: el tipo de campaña y los canales, en orden.",
    faq: "Última parte: las preguntas que más hacen los clientes, con tus respuestas para la página.",
  },
  en: {
    service: "Let's start with your service: what you do, for whom and what it includes. Does this look right?",
    pitch: "Now, how you present yourself: your promise and the reasons to choose you. Does it sound like you?",
    packages: "Your packages and prices. I built them from your costs and what's charged in your area.",
    offer: "A welcome offer helps people try you. It's optional: keep it, change it or remove it.",
    campaign: "This is how I'd find you customers: the campaign type and the channels, in order.",
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
    case "campaign":
      return JSON.stringify([p.campaignType, p.channels]);
    case "faq":
      return JSON.stringify(p.faq);
  }
}

// After a chat turn: what goes under the reply — the next part (with its
// intro) when the chat moved on, the same part's card again when it changed.
export function cardAfterTurn(before: BusinessPlan, after: BusinessPlan, lang: Lang): string | null {
  if (after.stage === "approved") return before.stage === "approved" ? null : DONE_TOKEN;
  const now = firstPending(after);
  if (!now) return null;
  const was = firstPending(before);
  // Reopened from an approved plan: just the changed part, no "next part" intro.
  if (before.stage !== "proposal") return partToken(now);
  if (was !== now) return `${introFor(after, now, lang)}\n\n${partToken(now)}`;
  return partSignature(before, now) !== partSignature(after, now) ? partToken(now) : null;
}

// Tokens are for the screen; the model reads a plain note instead.
export function forModel(content: string, lang: Lang): string {
  return content.replace(TOKEN, (_m, kind: string, arg?: string) => {
    if (kind === "part" && arg && (APPROVAL_BLOCKS as string[]).includes(arg))
      return lang === "es" ? `\n(Tarjeta mostrada: ${partName(arg as ApprovalBlock, lang)})` : `\n(Card shown: ${partName(arg as ApprovalBlock, lang)})`;
    if (kind === "ideas") return lang === "es" ? "\n(Tarjeta mostrada: las 3 ideas)" : "\n(Card shown: the 3 ideas)";
    return lang === "es" ? "\n(Tarjeta mostrada: expediente aprobado)" : "\n(Card shown: plan approved)";
  });
}
