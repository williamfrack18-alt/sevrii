// The window the owner sees when a chat runs out of capacity: which limit it
// is, what the next plan adds and its price, with "Mejorar plan" first and
// "seguir después" only as a second option. Pure data, shared by server and UI.

import { PLANS, PLAN_ORDER, type PlanId } from "./plans";

export type LimitKind = "day" | "month" | "budget";
export type LimitInfo = { kind: LimitKind; plan: PlanId; next: PlanId | null; canUpgrade: boolean };

export function nextPlan(plan: PlanId): PlanId | null {
  const i = PLAN_ORDER.indexOf(plan);
  return i >= 0 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
}

export function limitInfo(kind: LimitKind, plan: PlanId): LimitInfo {
  const next = nextPlan(plan);
  return { kind, plan, next, canUpgrade: Boolean(next && PLANS[next].available) };
}

// What each next plan adds (kept in one place; the pricing page says the same).
const GAINS: Record<"es" | "en", Partial<Record<PlanId, string[]>>> = {
  es: {
    starter: ["Publicar tu página en sevrii.com", "Links de pago y Chat con tus clientes", "Marketing con 3 videos y 1 campaña al mes", "200 mensajes y 3 investigaciones al mes"],
    pro: ["3 proyectos", "600 mensajes y 10 investigaciones al mes", "10 videos y 3 campañas al mes"],
    team: ["Varias personas en tu equipo"],
  },
  en: {
    starter: ["Publish your page on sevrii.com", "Payment links and Chat with your customers", "Marketing with 3 videos and 1 campaign a month", "200 messages and 3 research runs a month"],
    pro: ["3 projects", "600 messages and 10 research runs a month", "10 videos and 3 campaigns a month"],
    team: ["Several people on your team"],
  },
};

export function upgradeText(l: LimitInfo, lang: "es" | "en") {
  const es = lang === "es";
  const planName = (p: PlanId) => ({ free: es ? "Gratis" : "Free", starter: "Starter", pro: "Pro", team: es ? "Equipo" : "Team" })[p];
  const title =
    l.kind === "day"
      ? es ? `Usaste los mensajes de hoy de tu plan ${planName(l.plan)}` : `You used today's messages on your ${planName(l.plan)} plan`
      : es ? `Usaste la IA de este mes de tu plan ${planName(l.plan)}` : `You used this month's AI on your ${planName(l.plan)} plan`;
  const body = es
    ? "Todo lo que llevas quedó guardado: tu entrevista y tu propuesta siguen aquí, justo donde quedaron."
    : "Everything so far is saved: your interview and your proposal stay right here, where you left them.";
  const later =
    l.kind === "day"
      ? es ? "Seguir mañana con el plan gratis" : "Continue tomorrow on the free plan"
      : es ? "Seguir el próximo mes" : "Continue next month";
  const next = l.next;
  return {
    title,
    body,
    gainsTitle: next ? (es ? `Con ${planName(next)} tienes:` : `With ${planName(next)} you get:`) : "",
    gains: next ? GAINS[lang][next] ?? [] : [],
    price: next && l.canUpgrade ? (es ? `$${PLANS[next].monthly}/mes` : `$${PLANS[next].monthly}/mo`) : "",
    soon: next && !l.canUpgrade ? (es ? `${planName(next)} llega pronto.` : `${planName(next)} is coming soon.`) : "",
    cta: es ? "Mejorar plan" : "Upgrade plan",
    later,
  };
}
