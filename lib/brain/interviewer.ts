import type { MessageParam, Tool, ToolResultBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { MODELS, getClaude, logAiError } from "../claude";
import type { Lang } from "../i18n";
import { slugify } from "../ai";
import { getBusinessById, isSlugTaken, updateBusinessDetails, updateBusinessPlan, updateBusinessSlug, type BusinessRow } from "../db";
import {
  APPROVAL_BLOCKS,
  allApproved,
  blockHasContent,
  missingProfile,
  parsePlan,
  parseProfile,
  requestMoreIdeas,
  MAX_IDEA_ROUNDS,
  str,
  type ApprovalBlock,
  type BusinessPlan,
  type PlanStage,
} from "../plan";
import { codeGuard } from "./guard";
import { fillStoreFromPlan } from "../storeFill";
import { textOf, today } from "./common";
import { researchWouldStart } from "../usage";

// The Brain's chat. The code decides the stage; in each stage the model only
// talks and saves through the tools that stage allows.

const INTERVIEWER = `Eres el Entrevistador de Sevrii. Ayudas a dueños de pequeños negocios de servicios en EE. UU. a definir su servicio. En esta etapa solo entiendes; no propones.

Cómo conversas:
- Pocas preguntas: en cada mensaje pregunta juntos 2 o 3 datos de "missing" que vayan de la mano, en una sola frase natural. Por ejemplo: ciudad, estado y hasta dónde viaja; a quién le vende y cómo consigue clientes hoy; cuánto cobra y cuánto le cuesta cada trabajo; años de experiencia e idiomas; qué lo hace distinto y si tiene seguro. Así la entrevista dura unos 5 o 6 mensajes.
- Corto y amable. Responde en el idioma en que te escribe el usuario (en español, tutea).
- Sigue la lista "missing" del estado, en orden. Nunca preguntes algo que ya está en el expediente.
- Si responde solo una parte, guarda eso y en el siguiente mensaje pregunta lo que faltó junto con lo que sigue.
- serviceMode: si el servicio es claramente en persona (limpieza, mudanzas, reparaciones, jardinería, belleza a domicilio…), guárdalo como local sin preguntarlo; pregúntalo solo si puede hacerse a distancia.
- Si una respuesta trae datos, guárdalos todos con save_profile en ese mismo turno y no los vuelvas a preguntar.
- Nunca adivines ni supongas datos: guarda solo lo que la persona dijo de forma explícita (por ejemplo, no supongas sus idiomas por el idioma en que escribe; pregúntalo). La única excepción es serviceMode, como se explica abajo.
- Siempre termina tu turno con un mensaje para la persona: confirma en pocas palabras y haz la siguiente pregunta.
- Si la respuesta es vaga, pide un ejemplo concreto: "¿cuál fue el último trabajo que hiciste?".
- Cuando ayude, ofrece las opciones en la misma pregunta (por ejemplo: "¿español, inglés o los dos?").
- Confirma en muy pocas palabras lo que guardaste (sin repetirlo todo) y sigue.
- Máximo 60 palabras por mensaje. Sin títulos ni listas largas.

Si mode es "C: an AI agent" la persona está creando un agente de IA que hará su servicio solo, en el chat de su página, y cobrará por usarlo. Pregunta por el servicio que dará el agente, qué hace con cada cliente de principio a fin, su experiencia, a quién le sirve, de qué estado es y si atiende solo su estado o todo EE. UU., idiomas, qué conocimiento le va a enseñar (su método, apuntes, materiales), qué no debe hacer nunca y cuándo entra él, y cuánto cobraría. Explícale en una línea, si pregunta, que el agente dice siempre que es una IA creada por él.

Qué no haces:
- No das precios, ideas ni estrategia: eso viene después de investigar.
- No prometes ingresos ni clientes.
- No pides contraseñas, número de Seguro Social, datos bancarios ni de tarjetas.

Cuando save_profile responda que el perfil está completo, dile en una o dos líneas que ahora vas a investigar su zona (1 a 2 minutos) y que aquí mismo verá el avance y después la propuesta.`;

const CHOOSER = `Eres el Cerebro de Sevrii. La persona está escogiendo entre las 3 ideas de servicio que aparecen en el estado ("ideas"); las ve en una tarjeta en este mismo chat, con un botón para escoger cada una. Responde sus dudas en pocas líneas, con los datos de cada idea; no inventes cifras. No prometas ingresos.
- Si dice cuál quiere, llama a choose_idea con su número (1, 2 o 3).
- Si ninguna le convence ("no me gusta", "dame otras", "no me siento cómoda con eso"), pregúntale en una línea qué no le gustó o qué preferiría, si no lo dijo ya. Con su respuesta llama a more_ideas con ese feedback. No insistas en las ideas que rechazó.
- Si "roundsLeft" es 0, no puedes buscar más: ayúdale a escoger entre las actuales o a describir un servicio concreto que quiera ofrecer.
Máximo 70 palabras.`;

const EDITOR = `Eres el Cerebro de Sevrii. El dueño revisa su propuesta aquí mismo en el chat, una parte a la vez y en este orden: servicio, presentación, paquetes, oferta, campaña y preguntas frecuentes. La parte que están viendo ahora es "currentPart" en el estado: el sistema la muestra en una tarjeta justo debajo de tu mensaje, con botones de Aprobar y Cambiar.
- No repitas el contenido de la tarjeta ni hagas listas: ya la está viendo. Habla de la parte actual, en 1 a 3 frases.
- Si dice que está bien ("sí", "me gusta", "dale", "apruebo"), llama a approve_blocks con currentPart y no digas nada de la siguiente: el sistema la muestra sola. Responde solo algo corto como "Perfecto, aprobado."
- Si pide un cambio, hazlo con update_proposal (solo los campos que cambian) y confírmalo en una línea; la tarjeta actualizada aparece sola debajo. Cambiar una parte ya aprobada le quita la aprobación y vuelve a mostrarse.
- Si pregunta algo, responde corto con los datos del expediente y termina preguntando si la deja así o qué le cambias.
- Si quiere aprobar todo de una vez, llama a approve_blocks con todas las partes que faltan.
- Si mode es C (agente), la parte "service" incluye el agente (nombre, qué hace paso a paso, límites y saludo): sus cambios van en el campo agent. El agente siempre dice que es una IA; los precios de acceso son de $15 o más.
- Usa solo hechos que él da o que están en el expediente. Nada de reseñas, "el mejor", "garantizado" ni cifras inventadas.
- Precios: si los cambia, explica en una línea cómo queda el margen frente a sus costos y al rango de la zona.
- Oferta: solo si él la quiere. Una oferta de bienvenida para clientes nuevos (solo su primer servicio) no necesita fecha: guárdala con forNewClients=true. Cualquier otra promoción necesita una fecha de fin real (YYYY-MM-DD, hoy es {TODAY}). Si no quiere oferta, guarda noOffer=true y apruébala.
- Si la propuesta ya está aprobada ("stage": "approved"), ayuda con cambios igual que antes.
- Máximo 60 palabras. Sin títulos ni listas.`;

const PROFILE_PROPS: Record<string, unknown> = {
  businessName: { type: "string" },
  city: { type: "string" },
  state: { type: "string", description: "2-letter US state code, e.g. FL" },
  radiusMiles: { type: "number", description: "Local services: how many miles they travel from their city" },
  serviceMode: {
    type: "string",
    enum: ["local", "remote"],
    description: "local = done in person in an area (cleaning, moving, repairs, beauty at home). remote = can be done online from anywhere (video editing, design, bookkeeping, tutoring online).",
  },
  remoteScope: {
    type: "string",
    enum: ["us", "state", "world"],
    description: "Remote only: customers anywhere in the US (us), only in their own state (state: e.g. helping people get a Texas license, state-specific taxes or paperwork; save their state too) or also in other countries (world)",
  },
  languages: { type: "string", enum: ["es", "en", "both"] },
  yearsExperience: { type: "number" },
  mainService: { type: "string" },
  exampleJob: { type: "string" },
  typicalCustomer: { type: "string" },
  howGetsClients: { type: "string" },
  currentPrice: { type: "string" },
  costs: { type: "string" },
  differentiators: { type: "string" },
  licenseStatus: { type: "string", enum: ["has", "no", "not_needed"] },
  licenseNote: { type: "string", description: "Which license / certification, if any" },
  insured: { type: "string", enum: ["yes", "no"] },
  workHistory: { type: "string" },
  askedFor: { type: "string" },
  tools: { type: "string" },
  hasVehicle: { type: "string", enum: ["yes", "no"] },
  hoursPerWeek: { type: "number" },
  startBudgetUsd: { type: "number" },
  notWant: { type: "string" },
  goal: { type: "string", enum: ["extra", "fulltime"] },
  toolsReady: { type: "string", enum: ["yes", "no"] },
  agentTask: { type: "string", description: "C only: what the AI agent will do with each customer, start to finish" },
  agentKnowledge: { type: "string", description: "C only: what the owner knows and will teach the agent (method, notes, materials)" },
  agentLimits: { type: "string", description: "C only: what the agent must never do, and when the owner steps in" },
};

const SAVE_PROFILE: Tool = {
  name: "save_profile",
  description: "Save what the owner told you. Send only the fields you learned in this message.",
  input_schema: { type: "object", properties: PROFILE_PROPS },
};
const CHOOSE_IDEA: Tool = {
  name: "choose_idea",
  description: "The person picked one of the 3 ideas.",
  input_schema: { type: "object", properties: { number: { type: "integer", enum: [1, 2, 3] } }, required: ["number"] },
};
const MORE_IDEAS: Tool = {
  name: "more_ideas",
  description: "None of the 3 ideas convinces the person: search for different ones, taking their feedback into account.",
  input_schema: {
    type: "object",
    properties: { feedback: { type: "string", description: "What they didn't like and what they'd prefer, in their words" } },
    required: ["feedback"],
  },
};
const UPDATE_PROPOSAL: Tool = {
  name: "update_proposal",
  description: "Change parts of the proposal. Send only the fields that change; lists replace the previous list.",
  input_schema: {
    type: "object",
    properties: {
      service: { type: "string" },
      serviceIncludes: { type: "string" },
      serviceExcludes: { type: "string" },
      steps: { type: "array", items: { type: "string" } },
      customer: { type: "string" },
      problem: { type: "string" },
      promise: { type: "string" },
      differentiators: { type: "array", items: { type: "string" } },
      packages: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, price: { type: "string" }, includes: { type: "string" }, note: { type: "string" } },
          required: ["name", "price"],
        },
      },
      pricingNote: { type: "string" },
      offer: {
        type: "object",
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          endsAt: { type: "string", description: "YYYY-MM-DD, a real date the owner gave (not needed for a new-customer offer)" },
          forNewClients: { type: "boolean", description: "Only for each customer's first service (no end date needed)" },
        },
        required: ["label"],
      },
      noOffer: { type: "boolean", description: "true if the owner doesn't want an offer" },
      campaignType: { type: "string" },
      channels: { type: "array", items: { type: "object", properties: { channel: { type: "string" }, why: { type: "string" } }, required: ["channel", "why"] } },
      faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } },
      agent: {
        type: "object",
        description: "C only: the AI agent (send the whole object when it changes)",
        properties: {
          name: { type: "string" },
          role: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          limits: { type: "array", items: { type: "string" } },
          greeting: { type: "string" },
        },
      },
    },
  },
};
const APPROVE_BLOCKS: Tool = {
  name: "approve_blocks",
  description: "The owner approved these blocks.",
  input_schema: {
    type: "object",
    properties: { blocks: { type: "array", items: { type: "string", enum: APPROVAL_BLOCKS } } },
    required: ["blocks"],
  },
};

const FIELD_BLOCK: Record<string, ApprovalBlock> = {
  service: "service",
  serviceIncludes: "service",
  serviceExcludes: "service",
  steps: "service",
  customer: "service",
  problem: "service",
  promise: "pitch",
  differentiators: "pitch",
  packages: "packages",
  pricingNote: "packages",
  offer: "offer",
  noOffer: "offer",
  campaignType: "campaign",
  channels: "campaign",
  faq: "faq",
  agent: "service",
};

export const LOCKED_STAGES: PlanStage[] = ["ideas_research", "research"];

function stageOf(plan: BusinessPlan): { system: string; tools: Tool[] } {
  if (plan.stage === "interview" || plan.stage === "ready_check") return { system: INTERVIEWER, tools: [SAVE_PROFILE] };
  if (LOCKED_STAGES.includes(plan.stage)) return { system: INTERVIEWER, tools: [SAVE_PROFILE] };
  if (plan.stage === "choose") return { system: CHOOSER, tools: [CHOOSE_IDEA, MORE_IDEAS] };
  return { system: EDITOR.replace("{TODAY}", today()), tools: [UPDATE_PROPOSAL, APPROVE_BLOCKS] };
}

function state(b: BusinessRow) {
  const p = b.plan;
  const base = {
    stage: p.stage,
    mode: p.mode === "new" ? "B: starting a new service" : p.mode === "agent" ? "C: an AI agent that delivers the service by itself" : "A: already offers a service",
    today: today(),
  };
  if (p.stage === "interview" || p.stage === "ready_check") {
    const idea = p.chosenIdea !== null ? p.ideas[p.chosenIdea] : null;
    return { ...base, missing: missingProfile(p), profile: p.profile, ...(idea ? { chosenIdea: idea } : {}) };
  }
  if (p.stage === "choose")
    return { ...base, ideas: p.ideas.map((i, n) => ({ number: n + 1, ...i })), rejectedBefore: p.rejectedIdeas, roundsLeft: Math.max(0, MAX_IDEA_ROUNDS - p.ideaRounds) };
  return {
    ...base,
    profile: p.profile,
    market: { prices: p.market.prices, requirements: p.market.requirements },
    proposal: {
      service: p.service,
      serviceIncludes: p.serviceIncludes,
      customer: p.customer,
      problem: p.problem,
      promise: p.promise,
      differentiators: p.differentiators,
      packages: p.packages,
      pricingNote: p.pricingNote,
      offer: p.offer,
      noOffer: p.noOffer,
      campaignType: p.campaignType,
      channels: p.channels,
      faq: p.faq,
      ...(p.mode === "agent" ? { agent: p.agent } : {}),
    },
    approvals: p.approvals,
    notApprovedYet: APPROVAL_BLOCKS.filter((x) => !p.approvals[x]),
    currentPart: p.stage === "proposal" ? (APPROVAL_BLOCKS.find((x) => !p.approvals[x]) ?? "all approved") : "none (approved)",
  };
}

// Approve blocks; when all are approved and the final checks pass, the
// expediente is done.
export function applyApprovals(plan: BusinessPlan, blocks: ApprovalBlock[], lang: Lang): { plan: BusinessPlan; refused: string[] } {
  const refused: string[] = [];
  const approvals = { ...plan.approvals };
  let next = { ...plan };
  for (const blk of blocks) {
    if (blk === "offer" && !plan.offer) next = { ...next, noOffer: true };
    if (blk === "offer" && plan.offer && !plan.offer.endsAt && !plan.offer.forNewClients) {
      refused.push(lang === "es" ? "La oferta necesita una fecha de fin. Dímela en el chat o quita la oferta." : "The offer needs an end date. Tell me in the chat or remove the offer.");
      continue;
    }
    if (!blockHasContent(next, blk)) continue;
    approvals[blk] = true;
  }
  next = { ...next, approvals };
  if (allApproved(next)) {
    const g = codeGuard(next, lang, true);
    if (g.block.length) {
      refused.push(...g.block);
      next = { ...next, guard: { ...next.guard, block: g.block } };
    } else {
      next = { ...next, stage: "approved", ready: true, approvedAt: today(), guard: { block: [], warn: next.guard.warn } };
    }
  }
  return { plan: parsePlan(next), refused };
}

async function renameProject(b: BusinessRow, name: string) {
  const clean = name.trim().slice(0, 80);
  if (!clean || clean === b.name) return;
  await updateBusinessDetails(b.id, { name: clean });
  // The temporary address changes to the real name while the page is a draft.
  if (!b.published && b.slug.startsWith("proyecto-")) {
    const base = slugify(clean) || "negocio";
    let slug = base;
    for (let n = 2; await isSlugTaken(slug); n++) slug = `${base}-${n}`;
    await updateBusinessSlug(b.id, slug);
  }
}

// Did the owner actually talk about languages? (the model sometimes guesses
// them from the language they write in, or from "Hispanic customers").
const SAID_LANGUAGES = /\b(espa[ñn]ol|ingl[eé]s|spanish|english|idiomas?|languages?|biling[uü]e|bilingual|ambos|los dos|both)\b/i;

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, lang: Lang, ownerSaid = ""): Promise<{ out: string; startPipeline?: boolean }> {
  const plan = b.plan;
  switch (name) {
    case "save_profile": {
      if (plan.stage !== "interview" && plan.stage !== "ready_check") return { out: "error: not in the interview" };
      let note = "";
      if (input.languages !== undefined && !SAID_LANGUAGES.test(ownerSaid)) {
        delete input.languages;
        note = " (languages NOT saved: the owner never said which languages they serve in; ask them: español, inglés o los dos)";
      }
      const profile = parseProfile({ ...plan.profile, ...input });
      let next: BusinessPlan = { ...plan, profile };
      if (typeof input.businessName === "string" && profile.businessName) await renameProject(b, profile.businessName);
      const left = missingProfile(next);
      if (left.length) {
        await updateBusinessPlan(b.id, parsePlan(next));
        return { out: `saved${note}. still missing: ${left.join(", ")}` };
      }
      const stage: PlanStage = plan.stage === "interview" && plan.mode === "new" ? "ideas_research" : "research";
      if (!(await researchWouldStart(b.userId))) {
        await updateBusinessPlan(b.id, parsePlan(next));
        return { out: "saved. profile complete, BUT the research can't start: the owner reached this month's research limit (or AI budget) of their plan. Tell them kindly: everything is saved; they can upgrade in Plans to continue now, or continue next month right where they left off." };
      }
      next = { ...next, stage, runId: "" };
      await updateBusinessPlan(b.id, parsePlan(next));
      return { out: `saved. profile complete: stage moved to ${stage}. Tell the owner you will now research their area (1-2 minutes) and they will see the progress here in the chat.`, startPipeline: true };
    }
    case "choose_idea": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      const i = Number(input.number) - 1;
      const idea = plan.ideas[i];
      if (!idea) return { out: "error: unknown idea" };
      await updateBusinessPlan(b.id, parsePlan(chooseIdea(plan, i)));
      return { out: `chosen: ${idea.title}. Now ask the remaining readiness questions (see missing).` };
    }
    case "more_ideas": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      if (plan.ideaRounds >= MAX_IDEA_ROUNDS) return { out: "error: no more idea rounds; help them pick or describe a service they want" };
      if (!(await researchWouldStart(b.userId, { budgetOnly: true })))
        return { out: "error: the plan's AI budget for this month is used up, so no new search now. Their 3 ideas are still here: help them pick one, or they can upgrade in Plans." };
      await updateBusinessPlan(b.id, requestMoreIdeas(plan, str(input.feedback, 300)));
      return { out: "searching new ideas. Tell them in one line you're looking for different options with what they said (1-2 minutes) and they'll see them here in the chat.", startPipeline: true };
    }
    case "update_proposal": {
      if (plan.stage !== "proposal" && plan.stage !== "approved") return { out: "error: no proposal yet" };
      const touched = new Set<ApprovalBlock>();
      for (const k of Object.keys(input)) if (FIELD_BLOCK[k]) touched.add(FIELD_BLOCK[k]);
      const approvals = { ...plan.approvals };
      for (const t of touched) delete approvals[t];
      const patch: Record<string, unknown> = { ...input };
      // "Make it 20%" sends only the changed offer field: keep the rest
      // (who it's for, the detail, the end date) instead of losing it.
      if (input.offer && typeof input.offer === "object" && plan.offer) patch.offer = { ...plan.offer, ...(input.offer as Record<string, unknown>) };
      if (input.offer) patch.noOffer = false;
      if (input.agent && typeof input.agent === "object" && plan.agent) patch.agent = { ...plan.agent, ...(input.agent as Record<string, unknown>) };
      if (input.noOffer === true) patch.offer = null;
      // Only an edit to an approval block reopens the proposal; anything else
      // (video script, photo ideas…) keeps the stage as it was.
      const reopen = touched.size > 0;
      let next = parsePlan({ ...plan, ...patch, approvals, ...(reopen ? { stage: "proposal", ready: false } : {}) });
      const g = codeGuard(next, lang, false);
      next = { ...next, guard: { block: g.block, warn: plan.guard.warn } };
      // Everything still approved (nothing to re-approve): finish it again.
      if (next.stage === "proposal" && allApproved(next)) next = applyApprovals(next, [], lang).plan;
      await updateBusinessPlan(b.id, next);
      return { out: `saved. blocks that need approval again: ${[...touched].join(", ") || "none"}${g.block.length ? `; problems: ${g.block.join(" ")}` : ""}` };
    }
    case "approve_blocks": {
      if (plan.stage !== "proposal") return { out: "error: nothing to approve" };
      const blocks = (Array.isArray(input.blocks) ? input.blocks : []).filter((x): x is ApprovalBlock => APPROVAL_BLOCKS.includes(x as ApprovalBlock));
      const { plan: next, refused } = applyApprovals(plan, blocks, lang);
      await updateBusinessPlan(b.id, next);
      const built = next.stage === "approved" ? (await fillStoreFromPlan(b.id, lang, { onlyIfEmpty: true })).filled : false;
      return { out: `${next.stage === "approved" ? (built ? "all approved: the store page was built from the expediente automatically; tell the owner to open Store to see it" : "all approved: the expediente is ready; the owner can update the page from Store") : "approved"}${refused.length ? `; not approved: ${refused.join(" ")}` : ""}` };
    }
    default:
      return { out: "error: unknown tool" };
  }
}

export function chooseIdea(plan: BusinessPlan, i: number): BusinessPlan {
  const idea = plan.ideas[i];
  return parsePlan({
    ...plan,
    chosenIdea: i,
    stage: "ready_check",
    service: idea.title,
    profile: { ...plan.profile, mainService: idea.title },
  });
}

export type BrainChatResult = { reply: string; business: BusinessRow; startPipeline: boolean; debug?: string };

export async function runPlanChatTurn(opts: {
  business: BusinessRow;
  history: { role: "user" | "assistant"; content: string }[];
  message: string;
  lang: Lang;
}): Promise<BrainChatResult> {
  let business = opts.business;
  const es = opts.lang === "es";
  if (LOCKED_STAGES.includes(business.plan.stage)) {
    return {
      reply: es ? "Estoy investigando tu zona. En un momento te muestro lo que encontré." : "I'm researching your area. I'll show you what I found in a moment.",
      business,
      startPipeline: true,
    };
  }
  const client = getClaude();
  if (!client) {
    console.error("[ai:brain] ANTHROPIC_API_KEY is not set");
    return {
      reply: es ? "El asistente no está disponible en este momento. Inténtalo de nuevo en unos minutos." : "The assistant isn't available right now. Please try again in a few minutes.",
      business,
      startPipeline: false,
    };
  }

  // What the owner wrote in this chat (to check facts the model saves).
  const ownerSaid = [...opts.history.filter((h) => h.role === "user").map((h) => h.content), opts.message].join("\n");
  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(state(business))}\n\nOwner: ${opts.message}` },
  ];
  let reply = "";
  let startPipeline = false;
  let nudged = false;
  let debug = "";
  try {
    for (let step = 0; step < 7; step++) {
      const { system, tools } = stageOf(business.plan);
      const res = await client.messages.create({
        model: MODELS.chat,
        max_tokens: 6000,
        thinking: { type: "between_tools" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: `${system}\n\nReply in ${es ? "Spanish (neutral, 'tú')" : "English"}.`, cache_control: { type: "ephemeral" } }],
        ...(tools.length ? { tools } : {}),
        messages,
      });
      const text = textOf(res.content);
      if (text) reply = text;
      const uses = res.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
      // Tools run whenever the model asked for them (a cut-off answer may hold
      // an unfinished one, so not then).
      if (uses.length === 0 || res.stop_reason === "max_tokens") {
        // Sometimes the model ends a turn without a word for the person. Ask once more.
        if (!reply && !nudged) {
          nudged = true;
          // Never resend a tool call without its result (the API rejects it).
          const kept = res.content.filter((c) => c.type !== "tool_use");
          if (kept.some((c) => c.type === "text")) messages.push({ role: "assistant", content: kept });
          messages.push({
            role: "user",
            content: es
              ? "(Sistema: no respondiste nada. Si la persona te dio datos, guárdalos con save_profile. Después respóndele en una o dos frases y haz la siguiente pregunta de \"missing\".)"
              : "(System: you didn't reply. If the person gave you data, save it with save_profile. Then reply in one or two sentences and ask the next question from \"missing\".)",
          });
          continue;
        }
        break;
      }
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          const r = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business, opts.lang, ownerSaid);
          out = r.out;
          if (r.startPipeline) startPipeline = true;
        } catch (err) {
          console.error("[ai:brain] tool failed", u.name, err);
          out = "error: could not save";
        }
        business = (await getBusinessById(business.id))!;
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "assistant", content: res.content });
      messages.push({ role: "user", content: [...results, { type: "text", text: `Updated state (JSON):\n${JSON.stringify(state(business))}` }] });
    }
  } catch (err) {
    logAiError("brain", err);
    debug = String((err as Error)?.message || err).slice(0, 400);
    reply = es ? "Tuve un problema para guardar eso. Inténtalo de nuevo en un momento." : "I had a problem saving that. Please try again in a moment.";
  }
  if (!reply && startPipeline) {
    reply = es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en 1 o 2 minutos te muestro aquí lo que encontré." : "Done! I have what I need. I'll research your area now; I'll show you what I found here in 1-2 minutes.";
  }
  return { reply: reply || (es ? "Listo." : "Done."), business, startPipeline, debug };
}

export function planGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const p = b.plan;
  if (p.mode === "agent") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Vamos a crear tu agente: una IA que hace tu servicio sola, en el chat de tu página, las 24 horas, y que cobra por usarlo. Primero te entiendo, después investigo el mercado y te propongo el agente, sus precios y su campaña. Para empezar: ¿qué servicio quieres que haga tu agente, y para quién?"
      : "Hi! I'm Sevrii's Brain. Let's create your agent: an AI that delivers your service by itself, in your page chat, 24/7, and charges for it. First I'll get to know you, then I'll research the market and propose the agent, its prices and its campaign. To start: what service do you want your agent to deliver, and for whom?";
  }
  if (p.mode === "new") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Te voy a ayudar a escoger un servicio que puedas empezar a ofrecer, según tu experiencia, tu tiempo y tu zona. Después investigo el mercado y te propongo cómo venderlo. Para empezar: ¿en qué ciudad y estado vives?"
      : "Hi! I'm Sevrii's Brain. I'll help you pick a service you can start offering, based on your experience, your time and your area. Then I'll research the market and propose how to sell it. To start: what city and state do you live in?";
  }
  return es
    ? "¡Hola! Soy el Cerebro de Sevrii. Primero te entiendo bien, después investigo tu zona y te propongo cómo vender tu servicio: a quién, a qué precio y con qué campaña. Para empezar: ¿qué servicio quieres vender y cuál fue el último trabajo que hiciste?"
    : "Hi! I'm Sevrii's Brain. First I'll get to know your business, then I'll research your area and propose how to sell your service: to whom, at what price and with what campaign. To start: what service do you want to sell, and what was the last job you did?";
}
