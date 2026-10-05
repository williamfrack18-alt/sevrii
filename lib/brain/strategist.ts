import { MODELS, getClaude } from "../claude";
import type { Lang } from "../i18n";
import { parseIdeas, str, type BusinessPlan, type Idea } from "../plan";
import { textOf } from "./common";

// The Strategist (the most capable model): turns the expediente into a
// commercial proposal, or picks the 3 best ideas for someone starting out.

const STRATEGIST = `Eres el Estratega de Sevrii. Con el expediente (perfil, servicio, cliente, mercado y requisitos) armas la propuesta comercial de un servicio local en EE. UU.

Persona A: entrega promesa, 3 o 4 diferenciadores, 2 o 3 paquetes con precio, cómo salen los precios, una oferta de lanzamiento opcional y el tipo de campaña.
Persona B: primero entrega 3 ideas (de las 5 investigadas). Cuando escoja una, entrega la misma propuesta que la persona A.

Precios:
- Parte del costo del dueño: materiales + horas × valor de su hora + traslado + permiso. Apunta a un margen de 30 % a 50 %.
- Compáralo con el rango de la zona. Si queda fuera, explica por qué o ajústalo.
- Paquetes básico, completo y premium. El del medio es el que más conviene vender.

Ideas (persona B), puntaje de 1 a 5 en cada punto:
- Encaje con su experiencia y herramientas.
- Demanda con evidencia en su ciudad.
- Inversión inicial dentro de su dinero disponible.
- Licencia: si exige una que no tiene, la idea sale o se marca "primero la licencia".
- Rapidez para conseguir el primer cliente.
Muestra las 3 mejores con pros y contras, sin prometer ingresos.

Honestidad:
- Solo hechos del expediente. Un diferenciador sin respaldo no va.
- Nada de reseñas, cifras de clientes, "el número 1", "garantizado" ni urgencia falsa.
- La oferta es solo una sugerencia: el usuario decide si la quiere y pone la fecha de fin.

Tipo de campaña: Facebook e Instagram "Llamar ahora" para trabajos urgentes o locales; Google Search cuando la gente busca el servicio y el presupuesto llega a unos $15 al día; WhatsApp cuando el dueño lo usa y sus clientes prefieren escribir. Suma siempre los canales gratis: perfil de Google Business y referidos.`;

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

const PROPOSAL_SCHEMA = obj({
  service: S("The one concrete service, max 100 chars"),
  serviceIncludes: S("What the service includes, one line"),
  serviceExcludes: S("What it does not include, one line"),
  steps: { type: "array", items: { type: "string" }, description: "3 steps: how the job works from the customer's side" },
  customer: S("Who buys it and where"),
  problem: S("The problem or need, in the customer's words"),
  fears: S("What worries the customer before hiring"),
  promise: S("One-line honest value proposition"),
  differentiators: { type: "array", items: { type: "string" }, description: "3-4 reasons to choose them, only backed by the expediente" },
  packages: {
    type: "array",
    description: "2 or 3 packages",
    items: obj({ name: S("Package name"), price: S("e.g. '$450' or 'from $120'"), includes: S("What it includes"), note: S("Who it's for / why this price") }),
  },
  pricingNote: S("How the prices were set: cost, margin, comparison with the local range. Mark estimates as estimates."),
  offerSuggestion: obj({ label: S("Suggested launch offer, or empty string for none"), detail: S("Conditions, one line, or empty") }),
  campaignType: S("Recommended campaign in one line"),
  channels: { type: "array", items: obj({ channel: S("Channel"), why: S("Why, one line") }), description: "Up to 4 channels in priority order, include free ones" },
  faq: { type: "array", items: obj({ q: S("Question"), a: S("Answer, honest, max 300 chars") }), description: "6 FAQs for the page" },
  message: S("4-5 short lines for the owner explaining the proposal and asking them to review the cards below"),
});

const IDEAS_SCHEMA = obj({
  ideas: {
    type: "array",
    description: "Exactly the 3 best ideas, best first",
    items: obj({
      index: { type: "integer", description: "Index of the idea in the researched list" },
      fit: { type: "integer" },
      demand: { type: "integer" },
      cost: { type: "integer" },
      license: { type: "integer" },
      speed: { type: "integer" },
      pros: S("Pros, one line"),
      cons: S("Cons, one line"),
    }),
  },
  message: S("3-4 short lines for the person: you found 3 options, explain briefly how you chose, ask them to pick one below"),
});

function langLine(lang: Lang) {
  return lang === "es" ? "Escribe todos los textos en español neutro (EE. UU., tutea)." : "Write all text in plain US English.";
}

async function ask(system: string, user: string, schema: Record<string, unknown>): Promise<Record<string, unknown>> {
  const client = getClaude(150_000);
  if (!client) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await client.messages.create(
    {
      model: MODELS.strategy,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    },
    { timeout: 150_000 }
  );
  return JSON.parse(textOf(res.content)) as Record<string, unknown>;
}

function expediente(plan: BusinessPlan) {
  const idea = plan.chosenIdea !== null ? plan.ideas[plan.chosenIdea] : null;
  return {
    mode: plan.mode,
    profile: plan.profile,
    chosenIdea: idea,
    market: plan.market,
  };
}

export async function proposePlan(plan: BusinessPlan, lang: Lang, fixNotes: string[] = []): Promise<Partial<BusinessPlan> & { message: string }> {
  const fix = fixNotes.length
    ? `\n\nEl Guardián marcó estos problemas en tu propuesta anterior. Corrígelos:\n- ${fixNotes.join("\n- ")}`
    : "";
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `Expediente (JSON):\n${JSON.stringify(expediente(plan))}\n\nArma la propuesta.${fix}`,
    PROPOSAL_SCHEMA
  );
  const offer = (d.offerSuggestion ?? {}) as Record<string, unknown>;
  const label = str(offer.label, 80);
  return {
    service: str(d.service, 120),
    serviceIncludes: str(d.serviceIncludes, 400),
    serviceExcludes: str(d.serviceExcludes, 300),
    steps: (Array.isArray(d.steps) ? d.steps : []).map((x) => str(x, 160)).filter(Boolean).slice(0, 5),
    customer: str(d.customer, 240),
    problem: str(d.problem, 240),
    fears: str(d.fears, 240),
    promise: str(d.promise, 200),
    differentiators: (Array.isArray(d.differentiators) ? d.differentiators : []).map((x) => str(x, 140)).filter(Boolean).slice(0, 5),
    packages: (Array.isArray(d.packages) ? d.packages : []).slice(0, 4).map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return { name: str(p.name, 80), price: str(p.price, 40), includes: str(p.includes, 240), note: str(p.note, 140) };
    }),
    pricingNote: str(d.pricingNote, 500),
    // A suggestion only: no end date until the owner sets a real one.
    offer: label ? { label, detail: str(offer.detail, 200), endsAt: "" } : null,
    campaignType: str(d.campaignType, 200),
    channels: (Array.isArray(d.channels) ? d.channels : []).slice(0, 4).map((x) => {
      const c = (x ?? {}) as Record<string, unknown>;
      return { channel: str(c.channel, 80), why: str(c.why, 200) };
    }),
    faq: (Array.isArray(d.faq) ? d.faq : []).slice(0, 8).map((x) => {
      const f = (x ?? {}) as Record<string, unknown>;
      return { q: str(f.q, 160), a: str(f.a, 400) };
    }),
    message: str(d.message, 900),
  };
}

export async function pickIdeas(plan: BusinessPlan, researched: Idea[], lang: Lang): Promise<{ ideas: Idea[]; message: string }> {
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `Perfil (JSON):\n${JSON.stringify(plan.profile)}\n\nIdeas investigadas (JSON, con índice):\n${JSON.stringify(researched.map((r, index) => ({ index, ...r })))}\n\nEscoge las 3 mejores con su puntaje.`,
    IDEAS_SCHEMA
  );
  const picked: Idea[] = [];
  for (const x of Array.isArray(d.ideas) ? d.ideas : []) {
    const o = (x ?? {}) as Record<string, number | string>;
    const base = researched[Number(o.index)];
    if (!base || picked.some((p) => p.title === base.title)) continue;
    const pts = ["fit", "demand", "cost", "license", "speed"].reduce((a, k) => a + Math.max(0, Math.min(5, Number(o[k]) || 0)), 0);
    picked.push({ ...base, pros: str(o.pros, 240), cons: str(o.cons, 240), score: pts });
    if (picked.length === 3) break;
  }
  return { ideas: parseIdeas(picked), message: str(d.message, 700) };
}
