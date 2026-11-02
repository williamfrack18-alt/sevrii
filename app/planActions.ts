"use server";

import { revalidatePath } from "next/cache";
import { fillStoreFromPlan } from "@/lib/storeFill";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { chatGate, gateLimit, gateMessage, researchWouldStart, runForUser } from "@/lib/usage";
import type { LimitInfo } from "@/lib/upgrade";
import { addChatMessage, getBusinessById, listChatMessages, listServices, updateBusinessPlan, type BusinessRow, type ServiceRow } from "@/lib/db";
import type { Lang } from "@/lib/i18n";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { APPROVAL_BLOCKS, MAX_IDEA_ROUNDS, allApproved, missingProfile, requestMoreIdeas, type ApprovalBlock } from "@/lib/plan";
import { PLAN_TEXT } from "@/lib/planI18n";
import { applyApprovals, chooseIdea, planGreeting, resumeStuckResearch, runPlanChatTurn } from "@/lib/brain/interviewer";
import { DONE_TOKEN, cardAfterTurn, forModel, nextPartMessage } from "@/lib/brain/walk";
import type { BusinessPlan } from "@/lib/plan";

const CHANNEL = "plan";

export type PlanChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  services: ServiceRow[];
  startPipeline?: boolean;
  notice?: string;
  limit?: LimitInfo | null;
};

// The project this chat belongs to: the one the screen shows (its id comes
// with every action), never "whatever project is active right now" — another
// tab may have switched projects in the meantime.
async function requireBusiness(businessId?: string): Promise<BusinessRow> {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  if (businessId && businessId !== user.business.id) {
    const b = await getBusinessById(businessId);
    if (b && b.userId === user.id) return b;
  }
  return user.business;
}

async function respond(b: BusinessRow, extra: Partial<PlanChatResponse> = {}): Promise<PlanChatResponse> {
  const fresh = (await getBusinessById(b.id)) ?? b;
  return {
    messages: (await listChatMessages(b.id, CHANNEL)).map((m) => ({ id: m.id, role: m.role, content: m.content })),
    business: fresh,
    services: await listServices(b.id),
    ...extra,
  };
}

export async function sendPlanChatAction(message: string, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const t = getDict(lang).dashboard;
  const text = String(message || "").trim();
  if (!text) return respond(business);

  let history = await listChatMessages(business.id, CHANNEL);
  if (history.length === 0) {
    await addChatMessage(business.id, CHANNEL, "ai", planGreeting(lang, business));
    history = await listChatMessages(business.id, CHANNEL);
  }

  // Over a limit: nothing is saved in the chat (so it never repeats); the
  // owner gets the upgrade window and their text stays in the box.
  if (text.length > LIMITS.aiMaxChars) return respond(business, { notice: t.aiTooLong });
  const reason = await chatGate(business.userId);
  if (reason) {
    const limit = await gateLimit(business.userId, reason);
    return respond(business, limit ? { limit } : { notice: gateMessage(reason, t) });
  }

  await addChatMessage(business.id, CHANNEL, "user", text);
  // A profile left waiting by a research limit that no longer applies: go on.
  const resumed = await resumeStuckResearch(business, lang);
  if (resumed) {
    revalidatePath("/dashboard");
    return respond(resumed, { startPipeline: true });
  }
  const result = await runForUser(business.userId, () => runPlanChatTurn({
    business,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: forModel(m.content, lang).slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
  }), "brain_chat", true);
  // The real error stays in the server logs; the chat only shows the plain message.
  const reply = result.reply;
  // The part the chat moved to (or changed) shows its card under the reply.
  const card = cardAfterTurn(business.plan, result.business.plan, lang);
  if (card === DONE_TOKEN) {
    // Approved from the chat: the reply, then the same step-by-step "what's next".
    await addChatMessage(business.id, CHANNEL, "ai", reply);
    await afterApproved(result.business, lang);
  } else await addChatMessage(business.id, CHANNEL, "ai", card ? `${reply}\n\n${card}` : reply);
  revalidatePath("/dashboard");
  return respond(result.business, { startPipeline: result.startPipeline });
}

// Opening the Brain with a finished profile that a research limit left waiting:
// if research can start now, it continues without the owner having to ask.
export async function resumePlanAction(businessId?: string): Promise<PlanChatResponse | null> {
  const business = await requireBusiness(businessId);
  const resumed = await resumeStuckResearch(business, await getLang());
  if (!resumed) return null;
  revalidatePath("/dashboard");
  return respond(resumed, { startPipeline: true });
}

// B: the person picks one of the 3 ideas from its card.
export async function chooseIdeaAction(index: number, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const plan = business.plan;
  if (plan.stage !== "choose" || !plan.ideas[index]) return respond(business);
  const next = chooseIdea(plan, index);
  await updateBusinessPlan(business.id, next);
  const idea = plan.ideas[index];
  await addChatMessage(business.id, CHANNEL, "user", lang === "es" ? `Escojo: ${idea.title}` : `I pick: ${idea.title}`);
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    plan.mode === "agent"
      ? lang === "es"
        ? `¡Buena elección! Antes de investigar el mercado, definamos tu agente en dos o tres mensajes. ¿Atenderá a clientes de todo EE. UU., de un solo estado o también de otros países?`
        : `Great choice! Before I research the market, let's define your agent in two or three messages. Will it serve customers in the whole US, in one state only, or in other countries too?`
      : readyQuestion(next, lang)
  );
  revalidatePath("/dashboard");
  return respond(business);
}

// After picking an idea: the first thing still needed to price it, asked in
// plain words (never an insurance or permit interrogation, never gendered).
function readyQuestion(plan: BusinessPlan, lang: Lang): string {
  const es = lang === "es";
  const key = (missingProfile(plan)[0] || "").split(" ")[0];
  const intro = es ? "¡Buena elección! Antes de investigar el mercado, unas preguntas cortas para ponerle precio." : "Great choice! Before I research the market, a few short questions to price it.";
  const q: Record<string, [string, string]> = {
    serviceMode: ["¿Lo harías en persona en tu zona o en línea?", "Would you do it in person in your area, or online?"],
    zip: ["¿Cuál es tu código postal (ZIP)?", "What's your ZIP code?"],
    radiusMiles: ["¿Hasta cuántas millas te moverías para atender a un cliente?", "How many miles would you travel to serve a customer?"],
    remoteScope: ["¿Atenderías clientes de todo EE. UU. (te lo recomiendo), solo de tu estado o también de otros países?", "Would you serve customers in the whole US (my recommendation), only your state, or other countries too?"],
    toolsReady: ["¿Ya tienes lo que necesitas para hacerlo, o te falta algo?", "Do you already have what you need to do it, or is something missing?"],
    costHoursPerJob: ["¿Cuántas horas crees que te tomaría cada trabajo? Si nunca lo has hecho, te doy un número típico.", "How many hours would each job take you? If you've never done it, I'll give you a typical number."],
    costMaterialsUsd: ["¿Cuánto gastarías en materiales o herramientas por trabajo? Puede ser $0.", "How much would you spend on materials or tools per job? It can be $0."],
    businessName: ["¿Cómo se llamará tu negocio? Si no tienes nombre, te propongo algunos.", "What will your business be called? If you have no name yet, I'll suggest some."],
  };
  const ask = q[key];
  return ask ? `${intro} ${es ? ask[0] : ask[1]}` : intro;
}

// Approve one part of the proposal from its card in the chat. The chat
// records it and moves on to the next part.
export async function approveBlockAction(block: string, approved: boolean, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const plan = business.plan;
  if (!APPROVAL_BLOCKS.includes(block as ApprovalBlock)) return respond(business);
  if (!approved) {
    if (plan.stage !== "proposal" && plan.stage !== "approved") return respond(business);
    const approvals = { ...plan.approvals };
    delete approvals[block as ApprovalBlock];
    await updateBusinessPlan(business.id, { ...plan, approvals, stage: "proposal", ready: false });
    return respond(business);
  }
  if (plan.stage !== "proposal" || plan.approvals[block as ApprovalBlock]) return respond(business);
  if (!(await allow(`brain:approve:${business.id}`, 60, 10 * 60))) return respond(business);
  // The card itself shows it as approved (once): no extra message for it.
  const { plan: next, refused } = applyApprovals(plan, [block as ApprovalBlock], lang);
  await updateBusinessPlan(business.id, next);
  await walkOn(business, next, refused, lang);
  revalidatePath("/dashboard");
  return respond(business);
}

// After an approval from a card: say what stopped it, show the next part, or
// close the expediente (build the page and tell the owner).
async function walkOn(business: BusinessRow, next: BusinessPlan, refused: string[], lang: Lang) {
  const es = lang === "es";
  if (refused.length) {
    await addChatMessage(
      business.id,
      CHANNEL,
      "ai",
      `${es ? "Antes de seguir, hay que corregir esto:" : "Before moving on, this needs a fix:"} ${refused.join(" ")}\n\n${es ? "Dime cómo lo cambio y lo dejo listo." : "Tell me how to change it and I'll fix it."}`
    );
    return;
  }
  if (next.stage === "approved") return afterApproved(business, lang);
  const msg = nextPartMessage(next, lang);
  if (msg) await addChatMessage(business.id, CHANNEL, "ai", msg);
}

// The last approval (from a card, "no offer" or "finish"): build the page
// and tell the owner, always the same way.
async function afterApproved(business: BusinessRow, lang: Lang) {
  const { filled } = await fillStoreFromPlan(business.id, lang, { onlyIfEmpty: true });
  // "Ya armé tu página" whenever the page has content now (it may have been
  // built a moment earlier, in the same approval, by the chat).
  const built = filled || (await listServices(business.id)).length > 0;
  await addChatMessage(business.id, CHANNEL, "ai", `${nextSteps(lang, built)}\n\n${DONE_TOKEN}`);
}

// What comes after the Brain, said every time the strategy is approved: the
// owner never has to guess the next step.
function nextSteps(lang: Lang, filled: boolean): string {
  return lang === "es"
    ? `¡Listo, tu estrategia está aprobada! Esto es lo que sigue, paso a paso:\n1. Store (ya abierto): ${filled ? "ya armé tu página con lo que aprobamos" : "ahí se arma tu página con lo que aprobamos"}: tu servicio, tus precios, tu oferta y tus preguntas. Revísala, agrega fotos tuyas y de tu trabajo, y cambia lo que quieras.\n2. Publicar: cuando te guste, la publicas en sevrii.com y tus clientes te escriben por su chat.\n3. Pagos (opcional): conecta tu cuenta en Payments para que tus clientes paguen con tarjeta. Puedes publicar sin esto y conectarlo cuando quieras.\n4. Marketing: después armamos tus anuncios y videos para que te encuentren.\nToca «Armar mi página en Store» para empezar.`
    : `Done, your strategy is approved! Here's what comes next, step by step:\n1. Store (now open): ${filled ? "I already built your page from what we approved" : "your page is built there from what we approved"}: your service, prices, offer and FAQ. Review it, add photos of you and your work, and change anything you like.\n2. Publish: when you like it, publish it on sevrii.com and customers message you through its chat.\n3. Payments (optional): connect your account in Payments so customers can pay by card. You can publish without it and connect it whenever you want.\n4. Marketing: then we build your ads and videos so people find you.\nTap "Build my page in Store" to start.`;
}

// Every block is approved but the plan is still open (a final check stopped
// it, or an edit reopened it): try to finish it again.
export async function finishPlanAction(businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const plan = business.plan;
  if (plan.stage !== "proposal" || !allApproved(plan)) return respond(business);
  const { plan: next, refused } = applyApprovals(plan, [], lang);
  await updateBusinessPlan(business.id, next);
  await walkOn(business, next, refused, lang);
  revalidatePath("/dashboard");
  return respond(business);
}

// "No offer" from the offer card: drop the suggestion and approve the part.
export async function noOfferAction(businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const plan = business.plan;
  if (plan.stage !== "proposal" || plan.approvals.offer) return respond(business);
  await addChatMessage(business.id, CHANNEL, "user", lang === "es" ? "Sin oferta por ahora." : "No offer for now.");
  const { plan: next, refused } = applyApprovals({ ...plan, offer: null, noOffer: true }, ["offer"], lang);
  await updateBusinessPlan(business.id, next);
  await walkOn(business, next, refused, lang);
  revalidatePath("/dashboard");
  return respond(business);
}

// B: none of the 3 ideas convinces the person. Search for different ones.
export async function moreIdeasAction(feedback: string, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const t = PLAN_TEXT[lang];
  const plan = business.plan;
  if (plan.stage !== "choose") return respond(business);
  if (plan.ideaRounds >= MAX_IDEA_ROUNDS) return respond(business, { notice: t.moreNoLeft });
  if (!(await allow(`brain:more:${business.id}`, 6, 60 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  // Checked before anything changes: over the budget, the 3 ideas stay.
  if (!(await researchWouldStart(business.userId, { budgetOnly: true }))) return respond(business, { notice: getDict(lang).dashboard.aiMonthlyLimit });
  const note = String(feedback || "").trim().replace(/\s+/g, " ").slice(0, 300);
  await updateBusinessPlan(business.id, requestMoreIdeas(plan, note));
  await addChatMessage(business.id, CHANNEL, "user", t.moreUser(note));
  await addChatMessage(business.id, CHANNEL, "ai", t.moreAi);
  revalidatePath("/dashboard");
  return respond(business, { startPipeline: true });
}
