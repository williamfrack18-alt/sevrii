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
  type ApprovalBlock,
  type BusinessPlan,
  type PlanStage,
} from "../plan";
import { codeGuard } from "./guard";
import { textOf, today } from "./common";

// The Brain's chat. The code decides the stage; in each stage the model only
// talks and saves through the tools that stage allows.

const INTERVIEWER = `Eres el Entrevistador de Sevrii. Ayudas a dueños de pequeños negocios de servicios en EE. UU. (muchos son hispanos) a definir su servicio. En esta etapa solo entiendes; no propones.

Cómo conversas:
- Una pregunta a la vez, corta y amable. Tutea. Español neutro, o inglés si el usuario escribe en inglés.
- Sigue la lista "missing" del estado, en orden. Nunca preguntes algo que ya está en el expediente.
- Si una respuesta trae varios datos, guárdalos todos con save_profile y no los vuelvas a preguntar.
- Si la respuesta es vaga, pide un ejemplo concreto: "¿cuál fue el último trabajo que hiciste?".
- Cuando ayude, ofrece las opciones en la misma pregunta (por ejemplo: "¿español, inglés o los dos?").
- Confirma en pocas palabras lo que guardaste y sigue.
- Máximo 60 palabras por mensaje. Sin títulos ni listas largas.

Qué no haces:
- No das precios, ideas ni estrategia: eso viene después de investigar.
- No prometes ingresos ni clientes.
- No pides contraseñas, número de Seguro Social, datos bancarios ni de tarjetas.

Cuando save_profile responda que el perfil está completo, dile en una o dos líneas que ahora vas a investigar su zona (1 a 2 minutos) y que verá el avance abajo.`;

const CHOOSER = `Eres el Cerebro de Sevrii. La persona está escogiendo entre las 3 ideas de servicio que aparecen en el estado ("ideas"). Responde sus dudas en pocas líneas, con los datos de cada idea; no inventes cifras. No prometas ingresos. Si dice cuál quiere, llama a choose_idea con su número (1, 2 o 3). Máximo 70 palabras.`;

const EDITOR = `Eres el Cerebro de Sevrii. El dueño está revisando su propuesta (servicio, presentación, paquetes, oferta, campaña y preguntas frecuentes), que se ve debajo del chat en tarjetas con botones de Aprobar.
- Si pide un cambio, hazlo con update_proposal (solo los campos que cambian) y confírmalo en una línea. Cambiar un bloque le quita la aprobación a ese bloque.
- Usa solo hechos que él da o que están en el expediente. Nada de reseñas, "el mejor", "garantizado" ni cifras inventadas.
- Precios: si los cambia, explica en una línea cómo queda el margen frente a sus costos y al rango de la zona.
- Oferta: solo si él la quiere. Pide una fecha de fin real y guárdala como YYYY-MM-DD (hoy es {TODAY}). Si no quiere oferta, guarda noOffer=true.
- Si dice que aprueba uno o varios bloques, llama a approve_blocks.
- Máximo 70 palabras. Sin títulos.`;

const PROFILE_PROPS: Record<string, unknown> = {
  businessName: { type: "string" },
  city: { type: "string" },
  state: { type: "string", description: "2-letter US state code, e.g. FL" },
  radiusMiles: { type: "number" },
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
        properties: { label: { type: "string" }, detail: { type: "string" }, endsAt: { type: "string", description: "YYYY-MM-DD, a real date the owner gave" } },
        required: ["label"],
      },
      noOffer: { type: "boolean", description: "true if the owner doesn't want an offer" },
      campaignType: { type: "string" },
      channels: { type: "array", items: { type: "object", properties: { channel: { type: "string" }, why: { type: "string" } }, required: ["channel", "why"] } },
      faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] } },
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
};

export const LOCKED_STAGES: PlanStage[] = ["ideas_research", "research"];

function stageOf(plan: BusinessPlan): { system: string; tools: Tool[] } {
  if (plan.stage === "interview" || plan.stage === "ready_check") return { system: INTERVIEWER, tools: [SAVE_PROFILE] };
  if (LOCKED_STAGES.includes(plan.stage)) return { system: INTERVIEWER, tools: [SAVE_PROFILE] };
  if (plan.stage === "choose") return { system: CHOOSER, tools: [CHOOSE_IDEA] };
  return { system: EDITOR.replace("{TODAY}", today()), tools: [UPDATE_PROPOSAL, APPROVE_BLOCKS] };
}

function state(b: BusinessRow) {
  const p = b.plan;
  const base = { stage: p.stage, mode: p.mode === "new" ? "B: starting a new service" : "A: already offers a service", today: today() };
  if (p.stage === "interview" || p.stage === "ready_check") {
    const idea = p.chosenIdea !== null ? p.ideas[p.chosenIdea] : null;
    return { ...base, missing: missingProfile(p), profile: p.profile, ...(idea ? { chosenIdea: idea } : {}) };
  }
  if (p.stage === "choose") return { ...base, ideas: p.ideas.map((i, n) => ({ number: n + 1, ...i })) };
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
    },
    approvals: p.approvals,
    notApprovedYet: APPROVAL_BLOCKS.filter((x) => !p.approvals[x]),
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
    if (blk === "offer" && plan.offer && !plan.offer.endsAt) {
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

async function runTool(name: string, input: Record<string, unknown>, b: BusinessRow, lang: Lang): Promise<{ out: string; startPipeline?: boolean }> {
  const plan = b.plan;
  switch (name) {
    case "save_profile": {
      if (plan.stage !== "interview" && plan.stage !== "ready_check") return { out: "error: not in the interview" };
      const profile = parseProfile({ ...plan.profile, ...input });
      let next: BusinessPlan = { ...plan, profile };
      if (typeof input.businessName === "string" && profile.businessName) await renameProject(b, profile.businessName);
      const left = missingProfile(next);
      if (left.length) {
        await updateBusinessPlan(b.id, parsePlan(next));
        return { out: `saved. still missing: ${left.join(", ")}` };
      }
      const stage: PlanStage = plan.stage === "interview" && plan.mode === "new" ? "ideas_research" : "research";
      next = { ...next, stage, runId: "" };
      await updateBusinessPlan(b.id, parsePlan(next));
      return { out: `saved. profile complete: stage moved to ${stage}. Tell the owner you will now research their area (1-2 minutes) and they will see the progress below.`, startPipeline: true };
    }
    case "choose_idea": {
      if (plan.stage !== "choose") return { out: "error: not choosing ideas now" };
      const i = Number(input.number) - 1;
      const idea = plan.ideas[i];
      if (!idea) return { out: "error: unknown idea" };
      await updateBusinessPlan(b.id, parsePlan(chooseIdea(plan, i)));
      return { out: `chosen: ${idea.title}. Now ask the remaining readiness questions (see missing).` };
    }
    case "update_proposal": {
      if (plan.stage !== "proposal" && plan.stage !== "approved") return { out: "error: no proposal yet" };
      const touched = new Set<ApprovalBlock>();
      for (const k of Object.keys(input)) if (FIELD_BLOCK[k]) touched.add(FIELD_BLOCK[k]);
      const approvals = { ...plan.approvals };
      for (const t of touched) delete approvals[t];
      const patch: Record<string, unknown> = { ...input };
      if (input.offer) patch.noOffer = false;
      if (input.noOffer === true) patch.offer = null;
      let next = parsePlan({ ...plan, ...patch, approvals, stage: "proposal", ready: false });
      const g = codeGuard(next, lang, false);
      next = { ...next, guard: { block: g.block, warn: plan.guard.warn } };
      await updateBusinessPlan(b.id, next);
      return { out: `saved. blocks that need approval again: ${[...touched].join(", ") || "none"}${g.block.length ? `; problems: ${g.block.join(" ")}` : ""}` };
    }
    case "approve_blocks": {
      if (plan.stage !== "proposal") return { out: "error: nothing to approve" };
      const blocks = (Array.isArray(input.blocks) ? input.blocks : []).filter((x): x is ApprovalBlock => APPROVAL_BLOCKS.includes(x as ApprovalBlock));
      const { plan: next, refused } = applyApprovals(plan, blocks, lang);
      await updateBusinessPlan(b.id, next);
      return { out: `${next.stage === "approved" ? "all approved: the expediente is ready for Store" : "approved"}${refused.length ? `; not approved: ${refused.join(" ")}` : ""}` };
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

export type BrainChatResult = { reply: string; business: BusinessRow; startPipeline: boolean };

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

  const messages: MessageParam[] = [
    ...opts.history.map((h): MessageParam => ({ role: h.role, content: h.content })),
    { role: "user", content: `State (JSON):\n${JSON.stringify(state(business))}\n\nOwner: ${opts.message}` },
  ];
  let reply = "";
  let startPipeline = false;
  try {
    for (let step = 0; step < 6; step++) {
      const { system, tools } = stageOf(business.plan);
      const res = await client.messages.create({
        model: MODELS.chat,
        max_tokens: 3000,
        thinking: { type: "between_tools" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: `${system}\n\nReply in ${es ? "Spanish (neutral, US Hispanic, 'tú')" : "English"}.`, cache_control: { type: "ephemeral" } }],
        ...(tools.length ? { tools } : {}),
        messages,
      });
      const text = textOf(res.content);
      if (text) reply = text;
      const uses = res.content.filter((c): c is ToolUseBlock => c.type === "tool_use");
      if (res.stop_reason !== "tool_use" || uses.length === 0) break;
      const results: ToolResultBlockParam[] = [];
      for (const u of uses) {
        let out: string;
        try {
          const r = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, business, opts.lang);
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
    reply = es ? "Tuve un problema para guardar eso. Inténtalo de nuevo en un momento." : "I had a problem saving that. Please try again in a moment.";
  }
  if (!reply && startPipeline) {
    reply = es ? "¡Listo! Ya tengo lo que necesito. Ahora voy a investigar tu zona; en 1 o 2 minutos ves el resultado abajo." : "Done! I have what I need. I'll research your area now; you'll see the result below in 1-2 minutes.";
  }
  return { reply: reply || (es ? "Listo." : "Done."), business, startPipeline };
}

export function planGreeting(lang: Lang, b: BusinessRow): string {
  const es = lang === "es";
  const p = b.plan;
  if (p.mode === "new") {
    return es
      ? "¡Hola! Soy el Cerebro de Sevrii. Te voy a ayudar a escoger un servicio que puedas empezar a ofrecer, según tu experiencia, tu tiempo y tu zona. Después investigo el mercado y te propongo cómo venderlo. Para empezar: ¿en qué ciudad y estado vives?"
      : "Hi! I'm Sevrii's Brain. I'll help you pick a service you can start offering, based on your experience, your time and your area. Then I'll research the market and propose how to sell it. To start: what city and state do you live in?";
  }
  return es
    ? "¡Hola! Soy el Cerebro de Sevrii. Primero te entiendo bien, después investigo tu zona y te propongo cómo vender tu servicio: a quién, a qué precio y con qué campaña. Para empezar: ¿qué servicio quieres vender y cuál fue el último trabajo que hiciste?"
    : "Hi! I'm Sevrii's Brain. First I'll get to know your business, then I'll research your area and propose how to sell your service: to whom, at what price and with what campaign. To start: what service do you want to sell, and what was the last job you did?";
}
