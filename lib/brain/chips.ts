// Quick answers under the Brain's chat for what it is asking right now (one
// tap sends it). Optional: the person can always write freely. Pure, shared
// by the screen and the tests.
import { missingProfile, type BusinessPlan } from "../plan";

export type ChatChip = { label: string; send?: boolean; text?: string };

// What the Brain's last question is about (the chips answer THAT question,
// not whatever the list says is missing first: it may ask in another order).
const ASKED_ABOUT: [string, RegExp][] = [
  ["goal", /(ingreso extra|dinero extra|vivir de (esto|ello|eso)|tiempo completo|extra income|side income|live (from|off) (it|this)|full[- ]time)/i],
  ["howGetsClients", /(c[oó]mo (te )?(llegan|consigues|encuentran)|c[oó]mo consigues|how do (you get|(your )?(customers|clients|people) find)|how (customers|clients|people) find)/i],
  // "¿En qué ciudad (y en qué país)?" is the city question; "¿En qué país vives?" the country one.
  ["city", /(qu[eé] ciudad|en qu[eé] zona|d[oó]nde (trabajas|vives|atiendes|lo ofrecer[ií]as)|what city|which city|where (do you|would you) (work|live|offer))/i],
  ["country", /(qu[eé] pa[ií]s|what country|which country)/i],
  ["serviceMode", /(en persona|in person)/i],
  ["languages", /(idiomas?|languages?)/i],
  ["currentPrice", /(cu[aá]nto (cobras|cuesta|vale|pides)|qu[eé] (cobras|precio)|tus? precios?|how much do you charge|what do you charge|your prices?)/i],
];
export function askedAbout(lastAi: string): string {
  const qs = lastAi.match(/¿[^?]*\?|[^.!?¿\n]*\?/g) ?? [];
  const q = qs[qs.length - 1] ?? "";
  if (!q) return "";
  return ASKED_ABOUT.find(([, re]) => re.test(q))?.[0] ?? "?";
}

export function answerChips(plan: BusinessPlan, es: boolean, lastAi = ""): ChatChip[] {
  if (plan.stage !== "interview" && plan.stage !== "ready_check") return [];
  const missing = missingProfile(plan).map((x) => x.split(" ")[0]);
  // A and B talk freely: chips only for the question just asked, and only
  // while that answer is still missing. C keeps its fixed order.
  const topic = plan.mode === "agent" ? "" : askedAbout(lastAi);
  if (plan.mode !== "agent" && (!topic || topic === "?" || !missing.includes(topic))) return [];
  const next = topic || (missing[0] ?? "");
  const s = (label: string, en: string): ChatChip => ({ label: es ? label : en, send: true });
  switch (next) {
    case "remoteScope":
      return [s("Todo mi país", "My whole country"), s("Solo mi estado o región", "Only my state or region"), s("También otros países", "Other countries too")];
    case "languages":
      return [s("Español", "Spanish"), s("Inglés", "English"), s("Los dos", "Both")];
    case "typicalCustomer":
      return plan.mode === "agent" ? [s("A cualquiera", "Anyone")] : [];
    case "agentInterest":
      return [s("Propónme ideas abiertas", "Suggest open ideas")];
    case "agentTask":
    case "agentLimits":
      return [s("Sí, confirmado", "Yes, confirmed"), { label: es ? "Quiero cambiar algo" : "I want to change something", text: es ? "Quiero cambiar esto: " : "I want to change this: " }];
    case "serviceMode":
      return [s("En persona, en mi zona", "In person, in my area"), s("En línea, a distancia", "Online, remote")];
    case "insured":
    case "hasVehicle":
    case "toolsReady":
      return [s("Sí", "Yes"), s("No", "No")];
    case "goal":
      return [s("Un ingreso extra", "Extra income"), s("Vivir de esto", "To live from it")];
    // Quick answers, never required: the person can always write freely.
    case "howGetsClients":
      return [s("Pasan por mi local", "They walk by my place"), s("Por recomendación", "Word of mouth"), s("Por redes sociales", "Social media"), s("Todavía casi no tengo clientes", "I barely have clients yet")];
    case "currentPrice":
      return [s("No tengo un precio fijo", "I don't have a fixed price"), s("Depende del trabajo", "It depends on the job")];
    case "city":
      return [s(plan.mode === "new" ? "Quiero trabajar en línea" : "Trabajo en línea", plan.mode === "new" ? "I want to work online" : "I work online")];
    default:
      return [];
  }
}
