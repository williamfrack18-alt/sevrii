import { MODELS, getClaude } from "../claude";
import type { Lang } from "../i18n";
import { parseIdeas, parsePlanAgent, str, type BusinessPlan, type Idea } from "../plan";
import { textOf } from "./common";

// The Strategist (the most capable model): turns the expediente into a
// commercial proposal, or picks the 3 best ideas for someone starting out.

const STRATEGIST = `Eres el Estratega de Sevrii. Con el expediente (perfil, servicio, cliente, mercado y requisitos) armas la propuesta comercial de un servicio en EE. UU. (local, o en línea si serviceMode es "remote").

Persona A: entrega promesa, 3 o 4 diferenciadores, 2 o 3 paquetes con precio, cómo salen los precios, una oferta de bienvenida, el tipo de campaña, el guion de un video corto y las fotos que debe tomarse.
Persona B: primero entrega 3 ideas (de las 5 investigadas). Cuando escoja una, entrega la misma propuesta que la persona A.
Persona C (mode "agent"): la persona crea un agente de IA, un producto digital que resuelve un problema él solo, en el chat de su página, las 24 horas, y cobra por usarlo. No tiene que ser de su oficio: primero entrega 3 ideas de agente (de las 5 investigadas); cuando escoja una, entrega la misma propuesta y además "agent".

Agente (solo persona C):
- Prueba de valor (lo más importante): nadie paga por algo que un chat gratis como ChatGPT ya hace bien. Mira el servicio con los ojos del cliente: ¿lo resolvería gratis con ChatGPT o una plantilla? Si sí, NO lo propongas así: reenfócalo con estas palancas: (1) pasos exactos verificados en fuentes oficiales (con sus enlaces), que el agente sigue sin inventar; (2) reglas de un estado, ciudad u oficio; (3) acompañamiento con un resultado (un plan de varios días o semanas, práctica, seguimiento hasta terminar), no una respuesta suelta; (4) revisar lo que el cliente prepara antes de que lo entregue; (5) un nicho muy concreto; (6) material propio (listas, bancos de preguntas, plantillas). Si el creador sabe del tema (agentEdge, agentKnowledge), súmalo; si no, el valor sale de la investigación (gaps, requisitos). Si reenfocaste el servicio, dilo en una línea en message.
- agent.edge: 3 o 4 razones concretas y verdaderas para pagar por ESTE agente (title corto + text de una línea). agent.freeAlt: qué hace gratis un chat general con este mismo pedido, dicho con honestidad. agent.score: de 1 a 5, qué tan fuerte es la razón para pagar; si queda en 1 o 2 incluso reenfocado, dilo claro en message y en pricingNote.
- agent.creator: quién lo creó (su nombre o la marca del expediente) y, solo si el expediente lo dice, su respaldo. Si no hay credenciales, solo el nombre: nunca inventes experiencia.
- El agente HACE la tarea, no solo guía: entra a las páginas oficiales o al software que haga falta, completa el trámite de punta a punta y entrega el resultado en el chat. El cliente solo escribe lo delicado (contraseña, tarjeta al pagar) en la página oficial cuando se le pide, y da su OK antes de firmar, enviar o pagar. Define agent.task completo (qué termina, en qué páginas oficiales con sus enlaces de la investigación, qué datos pide, qué datos delicados escribe el cliente y cuándo, qué necesita OK, cómo comprueba que quedó hecho, qué entrega y recordatorios). Sin tarea completa no hay agente. Usa solo tarifas, plazos y enlaces verificados en la investigación. El cliente lo prueba gratis unas respuestas y después paga.
- Paquetes: 2 o 3 formas de pagar el acceso, pensadas para un agente: por uso (por ejemplo "Sesión de práctica: 1 día de acceso") y/o mensual ("Acceso mensual"). Cada precio es de al menos $15 (mínimo de pagos de Sevrii). Di en "includes" qué recibe y por cuánto tiempo, y en "note" para quién conviene. El dueño escoge la forma de cobrar: en pricingNote recomienda cuál conviene más y por qué (frecuencia de uso, competencia, costo de la IA).
- Precio: compáralo con lo que cobran personas y plataformas por el mismo servicio. Un agente puede costar menos que una persona, pero no lo regales.
- agent.limits: incluye siempre lo que agentLimits dice, que no promete resultados (aprobar un examen, ganar un caso) y que el dueño entra al chat para reembolsos o casos fuera del servicio.
- Honestidad: la página y el agente dicen claramente que es un agente de IA creado por el dueño. Nunca lo presentes como una persona.
- La oferta de bienvenida puede ser más respuestas gratis o un primer acceso con descuento, siempre que el precio quede en $15 o más.
- Sin video ni fotos del agente: videoScript y photoIdeas son del dueño presentando su agente.

Precios:
- Parte del costo del dueño: materiales + horas × valor de su hora + traslado + permiso. Apunta a un margen de 30 % a 50 %.
- Compáralo con el rango de la zona. Si queda fuera, explica por qué o ajústalo.
- Paquetes básico, completo y premium. El del medio es el que más conviene vender.

Ideas de agente (persona C), puntaje de 1 a 5 en cada punto (mismos campos): fit = encaje con lo que le interesa (no con su experiencia); demand = cuánta gente lo busca o ya lo paga; cost = disposición a pagar frente a un chat gratis; requirements = riesgo legal bajo (nada de asesoría que exija licencia); speed = qué tan completo lo puede terminar un agente él solo, operando las páginas oficiales o el software de punta a punta. Muestra las 3 mejores con pros y contras, sin prometer ingresos.

Ideas (persona B), puntaje de 1 a 5 en cada punto:
- Encaje con su experiencia y herramientas.
- Demanda con evidencia en su ciudad.
- Inversión inicial dentro de su dinero disponible.
- Requisitos para arrancar: menos trámites y permisos, más puntos.
- Rapidez para conseguir el primer cliente.
Muestra las 3 mejores con pros y contras, sin prometer ingresos. En pros y contras no hables de licencias ni de "confirmar si pide licencia", salvo que la idea investigada diga que ese servicio la exige.

Honestidad:
- Solo hechos del expediente. Un diferenciador sin respaldo no va.
- Nada de reseñas, cifras de clientes, "el número 1", "garantizado" ni urgencia falsa.
- No inventes datos del dueño en el guion ni en las fotos.

Oferta de bienvenida (ayuda mucho a convertir):
- Propón siempre una oferta para clientes nuevos que el margen aguante: un % en el primer servicio (10 % a 20 %) o un extra sin costo.
- Es solo para el primer servicio de cada cliente nuevo, así que no necesita fecha de fin (forNewClients = true). Nada de "solo hoy" ni urgencia falsa.
- El dueño decide si la quiere.

Cómo lo contactan los clientes (importante):
- Toda la comunicación pasa por el chat de su página en Sevrii: el cliente le escribe ahí y el dueño responde ahí. No hay botón de llamar, de mensaje de texto ni de WhatsApp en la página.
- Por eso, en pasos, preguntas frecuentes, guion y campañas di "escríbenos por el chat de nuestra página", nunca "llámame", "mándame un texto", "escríbeme por WhatsApp" ni "al número que ves aquí".

Su cara vende (es un servicio, no un producto):
- La página y los anuncios llevan fotos y un video de la persona, nunca fotos de stock.
- videoScript: guion de 30 a 60 segundos, en primera persona, para grabarlo con el celular mirando a la cámara: quién es, qué hace y dónde, por qué elegirlo (solo hechos del expediente), la oferta de bienvenida y que le escriban por el chat de su página. Frases cortas y naturales. Usa [tu nombre] donde va su nombre.
- photoIdeas: 4 a 6 fotos concretas que puede tomarse con el celular para su servicio (por ejemplo: retrato sonriendo con ropa de trabajo, trabajando, sus herramientas, el antes y después). Si apenas empieza, fotos practicando o preparando su equipo.

Tipo de campaña: los anuncios llevan a la página del dueño en Sevrii, donde el cliente escribe por el chat. Facebook e Instagram con el botón "Más información" o "Enviar mensaje" hacia la página, para servicios locales; Google Search cuando la gente busca el servicio y el presupuesto llega a unos $15 al día. Suma los canales gratis: referidos siempre, y perfil de Google Business solo si atiende en persona en una zona (no para servicios en línea). Servicios en línea (remote): campañas a todo EE. UU. (al mundo si remoteScope es "world"; solo a su estado si remoteScope es "state"), no a una ciudad.`;

const S = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

const PROPOSAL_PROPS = {
  service: S("The one concrete service, max 100 chars"),
  serviceIncludes: S("What the service includes, one line"),
  serviceExcludes: S("What it does not include, one line"),
  steps: { type: "array", items: { type: "string" }, description: "3 steps: how the job works from the customer's side" },
  customer: S("Who buys it and where"),
  problem: S("The problem or need, in the customer's words"),
  fears: S("What worries the customer before hiring"),
  promise: S("One-line honest value proposition"),
  differentiators: { type: "array", items: { type: "string" }, description: "3-4 reasons to choose them, only backed by the expediente. Each one a complete sentence of at most 200 characters." },
  packages: {
    type: "array",
    description: "2 or 3 packages",
    items: obj({ name: S("Package name"), price: S("e.g. '$450' or 'from $120'"), includes: S("What it includes"), note: S("Who it's for / why this price") }),
  },
  pricingNote: S("How the prices were set: cost, margin, comparison with the local range. Mark estimates as estimates."),
  offerSuggestion: obj({
    label: S("Welcome offer for new customers, short (e.g. '15% off your first cleaning'), or empty string for none"),
    detail: S("Conditions, one line, or empty"),
    forNewClients: { type: "boolean", description: "true: only for a customer's first service, no end date needed" },
  }),
  campaignType: S("Recommended campaign in one line"),
  channels: { type: "array", items: obj({ channel: S("Channel"), why: S("Why, one line") }), description: "Up to 4 channels in priority order, include free ones" },
  faq: { type: "array", items: obj({ q: S("Question"), a: S("Answer, honest, max 300 chars") }), description: "6 FAQs for the page" },
  videoScript: S("30-60 second first-person video script to record with a phone, using [tu nombre]/[your name] for the name"),
  photoIdeas: { type: "array", items: { type: "string" }, description: "4-6 concrete photos of the owner and their work to take with a phone" },
  message: S("2-3 short lines for the owner summarizing the idea behind the proposal (who, at what price, how you will find clients). Do not list the parts: they are shown one by one right after this message."),
};
const PROPOSAL_SCHEMA = obj(PROPOSAL_PROPS);
// C: the same proposal plus the agent that will deliver the service.
const AGENT_PROPOSAL_SCHEMA = obj({
  ...PROPOSAL_PROPS,
  agent: obj({
    name: S("A short, friendly name for the agent, e.g. 'Tutor Kevin IA' (max 40 chars)"),
    role: S("One line: what the agent does for each customer"),
    steps: { type: "array", items: { type: "string" }, description: "4-7 steps: how the agent works with a customer, start to finish (its method)" },
    limits: { type: "array", items: { type: "string" }, description: "3-6 limits: what it must never do, and when the owner steps in" },
    greeting: S("Its first message to a customer, 1-2 sentences, says it's an AI agent of the business (use the business name; no placeholders like [tu nombre])"),
    creator: S("Who created it and the credential behind it, from the expediente, e.g. 'Ana · 6 años en recursos humanos'"),
    edge: { type: "array", description: "3-4 true, concrete reasons to pay for THIS agent instead of a free AI chat", items: obj({ title: S("2-5 words"), text: S("One line") }) },
    freeAlt: S("What a free general AI chat already does with the same request, said honestly, one line"),
    score: { type: "integer", description: "1-5: how strong the reason to pay is" },
    task: obj({
      goal: S("The complete task the agent DOES itself, end to end (the finished result the customer gets), e.g. 'Crear tu LLC en Florida y entregarte el número de documento oficial'"),
      platforms: { type: "array", description: "Official pages or software it operates, with their https links (from the research)", items: obj({ name: S("Name"), url: S("https link") }) },
      needs: { type: "array", items: { type: "string" }, description: "Ordinary data it asks in the chat (no passwords, cards or SSN)" },
      sensitive: { type: "array", description: "Sensitive data the customer types themselves on the official page, and when", items: obj({ what: S("e.g. 'tarjeta'"), when: S("e.g. 'al pagar la tarifa de $125 al estado'") }) },
      confirmBefore: { type: "array", items: { type: "string" }, description: "Steps that need the customer's OK: signing, submitting, paying" },
      verify: S("How it proves it's done: a confirmation or document number, an official record"),
      deliver: S("What the customer receives in the chat"),
      reminders: S("Reminders afterwards (official deadlines), or empty"),
    }),
  }),
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
      requirements: { type: "integer", description: "Fewer permits/paperwork to start = higher" },
      speed: { type: "integer" },
      pros: S("Pros, one line"),
      cons: S("Cons, one line"),
    }),
  },
  message: S("3-4 short lines for the person: you found 3 options, explain briefly how you chose, do not describe each idea (they are shown in a card right after this message)"),
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
  const isAgent = plan.mode === "agent";
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `Expediente (JSON):\n${JSON.stringify(expediente(plan))}\n\nArma la propuesta${isAgent ? " (persona C: incluye el agente)" : ""}.${fix}`,
    isAgent ? AGENT_PROPOSAL_SCHEMA : PROPOSAL_SCHEMA
  );
  const offer = (d.offerSuggestion ?? {}) as Record<string, unknown>;
  const label = str(offer.label, 80);
  return {
    service: str(d.service, 120),
    serviceIncludes: str(d.serviceIncludes, 400),
    serviceExcludes: str(d.serviceExcludes, 300),
    steps: (Array.isArray(d.steps) ? d.steps : []).map((x) => str(x, 320)).filter(Boolean).slice(0, 5),
    customer: str(d.customer, 240),
    problem: str(d.problem, 240),
    fears: str(d.fears, 240),
    promise: str(d.promise, 200),
    differentiators: (Array.isArray(d.differentiators) ? d.differentiators : []).map((x) => str(x, 320)).filter(Boolean).slice(0, 5),
    packages: (Array.isArray(d.packages) ? d.packages : []).slice(0, 4).map((x) => {
      const p = (x ?? {}) as Record<string, unknown>;
      return { name: str(p.name, 80), price: str(p.price, 40), includes: str(p.includes, 240), note: str(p.note, 140) };
    }),
    pricingNote: str(d.pricingNote, 500),
    // A suggestion only: no end date until the owner sets a real one.
    offer: label ? { label, detail: str(offer.detail, 200), endsAt: "", forNewClients: offer.forNewClients === true } : null,
    videoScript: typeof d.videoScript === "string" ? d.videoScript.trim().slice(0, 1200) : "",
    photoIdeas: (Array.isArray(d.photoIdeas) ? d.photoIdeas : []).map((x) => str(x, 240)).filter(Boolean).slice(0, 6),
    campaignType: str(d.campaignType, 200),
    channels: (Array.isArray(d.channels) ? d.channels : []).slice(0, 4).map((x) => {
      const c = (x ?? {}) as Record<string, unknown>;
      return { channel: str(c.channel, 80), why: str(c.why, 200) };
    }),
    faq: (Array.isArray(d.faq) ? d.faq : []).slice(0, 8).map((x) => {
      const f = (x ?? {}) as Record<string, unknown>;
      return { q: str(f.q, 160), a: str(f.a, 400) };
    }),
    ...(isAgent ? { agent: parsePlanAgent(d.agent) } : {}),
    message: str(d.message, 900),
  };
}

export async function pickIdeas(plan: BusinessPlan, researched: Idea[], lang: Lang): Promise<{ ideas: Idea[]; message: string }> {
  const d = await ask(
    `${STRATEGIST}\n\n${langLine(lang)}`,
    `${plan.mode === "agent" ? "Persona C: son ideas de agente de IA; usa los puntajes de \"Ideas de agente\".\n\n" : ""}Perfil (JSON):\n${JSON.stringify(plan.profile)}${plan.rejectedIdeas.length ? `\n\nIdeas que ya rechazó (no las repitas ni propongas variantes): ${JSON.stringify(plan.rejectedIdeas)}` : ""}${plan.ideaPrefs ? `\n\nLo que dijo que prefiere o no le gustó: ${plan.ideaPrefs}` : ""}\n\nIdeas investigadas (JSON, con índice):\n${JSON.stringify(researched.map((r, index) => ({ index, ...r })))}\n\n${plan.ownIdea ? "La idea de índice 0 es la que trajo la persona: inclúyela siempre entre las 3, con su puntaje real y sus pros y contras honestos; en message di en una línea cómo salió frente a las otras. " : ""}Escoge las 3 mejores con su puntaje.`,
    IDEAS_SCHEMA
  );
  const picked: Idea[] = [];
  for (const x of Array.isArray(d.ideas) ? d.ideas : []) {
    const o = (x ?? {}) as Record<string, number | string>;
    const base = researched[Number(o.index)];
    if (!base || picked.some((p) => p.title === base.title)) continue;
    const pts = ["fit", "demand", "cost", "requirements", "speed"].reduce((a, k) => a + Math.max(0, Math.min(5, Number(o[k]) || 0)), 0);
    picked.push({ ...base, pros: str(o.pros, 240), cons: str(o.cons, 240), score: pts });
    if (picked.length === 3) break;
  }
  // Their own idea (researched first) is always shown, with its score.
  const own = plan.ownIdea ? researched[0] : null;
  if (own && !picked.some((p) => p.title === own.title)) picked.splice(2, 1), picked.unshift({ ...own, score: 0 });
  else if (own) {
    const i = picked.findIndex((p) => p.title === own.title);
    if (i > 0) picked.unshift(...picked.splice(i, 1));
  }
  return { ideas: parseIdeas(picked), message: str(d.message, 700) };
}
