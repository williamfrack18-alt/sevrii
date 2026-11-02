"use server";

import { revalidatePath } from "next/cache";
import { fillStoreFromPlan } from "@/lib/storeFill";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { budgetUsed, chatGate, gateLimit, gateMessage, month, researchLimitText, researchUsage, researchWouldStart, runForUser } from "@/lib/usage";
import { cleanAnswers, isOnlinePlace, pendingCards, cardTitle, type CardAnswers } from "@/lib/cards";
import { markReferencePrices, readyForPage } from "@/lib/brain/checks";
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
    fullHistory: history.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: forModel(m.content, lang).slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
  }), "brain_chat", true);
  // The real error stays in the server logs; the chat only shows the plain message.
  let reply = result.reply;
  // Before the AI balance runs out, say so once (the work stays saved).
  try {
    const used = await budgetUsed(business.userId);
    if (used >= 0.85 && used < 1 && (await allow(`brain:nearbudget:${business.userId}:${month()}`, 1, 32 * 24 * 60 * 60))) {
      const pct = Math.round(used * 100);
      reply += lang === "es"
        ? `\n\n⚠ Aviso: ya usaste el ${pct}% del saldo de IA de tu plan este mes. Cuando se acabe, todo queda guardado y puedes mejorar tu plan en Planes para seguir.`
        : `\n\n⚠ Heads-up: you've used ${pct}% of this month's AI balance on your plan. When it runs out, everything stays saved and you can upgrade in Plans to keep going.`;
    }
  } catch {}
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
  const idea = plan.ideas[index];
  const es = lang === "es";
  await addChatMessage(business.id, CHANNEL, "user", es ? `Escojo: ${idea.title}` : `I pick: ${idea.title}`);
  // B: nothing essential missing → straight to the research of that service.
  if (plan.mode !== "agent" && missingProfile(next).length === 0 && (await researchWouldStart(business.userId))) {
    await updateBusinessPlan(business.id, { ...next, stage: "research", runId: "" });
    await addChatMessage(
      business.id,
      CHANNEL,
      "ai",
      es
        ? `¡Buena elección! Ahora investigo precios, competencia y clientes de «${idea.title}» en tu zona (1 o 2 minutos). Verás el avance aquí mismo.`
        : `Great choice! I'm now researching prices, competition and customers for "${idea.title}" in your area (1-2 minutes). You'll see the progress right here.`
    );
    revalidatePath("/dashboard");
    return respond(business, { startPipeline: true });
  }
  await updateBusinessPlan(business.id, next);
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    plan.mode === "agent"
      ? es
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
  const intro = es ? "¡Buena elección! Antes de investigar, una sola cosa." : "Great choice! Before I research, just one thing.";
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
  if (!(await allow(`brain:more:${business.id}`, 30, 60 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  // Checked before anything changes: over the budget, the 3 ideas stay.
  if (!(await researchWouldStart(business.userId, { budgetOnly: true }))) return respond(business, { notice: getDict(lang).dashboard.aiMonthlyLimit });
  const note = String(feedback || "").trim().replace(/\s+/g, " ").slice(0, 300);
  await updateBusinessPlan(business.id, requestMoreIdeas(plan, note));
  await addChatMessage(business.id, CHANNEL, "user", t.moreUser(note));
  await addChatMessage(business.id, CHANNEL, "ai", t.moreAi);
  revalidatePath("/dashboard");
  return respond(business, { startPipeline: true });
}


// ---------- The interview cards (A and B) ----------

// The cards as profile facts the research and the Strategist already read.
// Only what the person wrote: a "no sé" stays unknown, never a guess.
async function profileFromCards(plan: BusinessPlan, cards: CardAnswers): Promise<BusinessPlan["profile"]> {
  const { lookupPlace } = await import("@/lib/geo");
  const said = (id: string) => (cards[id] && !cards[id].u ? cards[id].v.trim() : "");
  const num = (re: RegExp, text: string) => {
    const m = re.exec(text);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const place = (raw: string) => {
    if (!raw.trim() || isOnlinePlace(raw)) return null;
    return lookupPlace(raw);
  };
  const p = { ...plan.profile };
  if (plan.mode === "new") {
    const d = cards.delivery;
    p.likes = [said("talent"), said("likes")].filter(Boolean).join("; ");
    p.workHistory = cards.experience?.u ? "ninguna" : said("experience");
    p.notWant = cards.notWant?.u ? "nada en especial" : said("notWant");
    p.tools = cards.resources?.u ? "nada de eso" : said("resources");
    p.hoursPerWeek = num(/(\d{1,3})\s*(?:h\b|hrs?|horas|hours)/i, said("time"));
    p.startBudgetUsd = num(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)/, said("resources"));
    p.incomeGoal = said("income");
    p.direction = "open";
    if (d && !d.u) {
      p.workPlace = d.c === "digital" ? "home" : d.c === "fisico" ? "out" : "any";
      if (d.c === "digital") p.serviceMode = "remote";
      const where = place(d.p);
      if (where) Object.assign(p, { city: where.city, state: where.state });
    } else p.workPlace = "any";
  } else {
    const s = cards.service;
    p.mainService = said("service");
    if (s && isOnlinePlace(s.p)) p.serviceMode = "remote";
    else {
      const where = s ? place(s.p) : null;
      if (where) Object.assign(p, { city: where.city, state: where.state });
      if (!p.serviceMode) p.serviceMode = "local";
    }
    p.currentPrice = said("prices");
    p.costs = said("costs");
    p.costMaterialsUsd = num(/\$\s?(\d+)\s*(?:de|en)?\s*materiales?\b/i, said("costs"));
    p.hoursPerWeek = num(/(\d{1,3})\s*(?:h\b|hrs?|horas|hours)\s*(?:a la|por|per|a)\s*(?:semana|week)/i, said("hours"));
    p.costHoursPerJob = num(/(\d{1,2}(?:\.\d)?)\s*(?:h\b|hrs?|horas?|hours?)\s*(?:por|per|each|cada)\s*(?:trabajo|par|cliente|visita|job|pair|client|visit)/i, said("hours"));
    p.typicalCustomer = cards.clients?.u ? "todavía no tiene clientes" : said("clients");
    p.howGetsClients = said("clients");
    p.tools = said("assets");
    const g = cards.goal;
    const goals: Record<string, string> = { clients: "más clientes", price: "cobrar mejor", hours: "trabajar más horas", new: "ofrecer algo nuevo" };
    p.ownerGoal = g && !g.u ? [goals[g.c] ?? "", g.v].filter(Boolean).join(": ") : "";
  }
  return p;
}

// Saves the cards as they go (back and forth never loses one). With submit,
// the code checks that every card is answered (or "no sé") before anything
// is researched: the structure is the gate, not the model.
export async function saveCardsAction(cards: unknown, submit: boolean, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const es = lang === "es";
  const plan = business.plan;
  if (plan.stage !== "interview" || (plan.mode !== "new" && plan.mode !== "existing")) return respond(business);
  const answers = cleanAnswers(plan.mode, cards);
  let next: BusinessPlan = { ...plan, cards: answers };
  if (!submit) {
    await updateBusinessPlan(business.id, next);
    return respond(business);
  }
  const left = pendingCards(plan.mode, answers);
  if (left.length) {
    await updateBusinessPlan(business.id, next);
    return respond(business, { notice: `${es ? "Te falta contestar:" : "Still to answer:"} ${left.map((id) => cardTitle(plan.mode, id, lang)).join(" · ")}` });
  }
  if (!(await allow(`brain:cards:${business.id}`, 20, 60 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  const profile = await profileFromCards(next, answers);
  next = { ...next, profile: { ...profile, researchReady: true }, flowLang: lang };
  if (!(await researchWouldStart(business.userId))) {
    await updateBusinessPlan(business.id, next);
    return respond(business, { notice: researchLimitText(await researchUsage(business.userId), es ? "es" : "en") });
  }
  next = { ...next, stage: plan.mode === "new" ? "ideas_research" : "research", runId: "" };
  await updateBusinessPlan(business.id, next);
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    plan.mode === "new"
      ? es
        ? "Gracias, ya tengo todas tus respuestas. Ahora investigo tu zona y te muestro propuestas de servicio que encajen contigo (1 o 2 minutos). Nada de lo que me dijiste que no quieres va a aparecer."
        : "Thanks, I have all your answers. I'm researching your area now and will show you service proposals that fit you (1-2 minutes). Nothing you said you don't want will show up."
      : es
        ? "Gracias, ya tengo todas tus respuestas. Ahora investigo precios, competencia y clientes de tu zona (1 o 2 minutos) y te armo la propuesta."
        : "Thanks, I have all your answers. I'm researching prices, competition and customers in your area (1-2 minutes) and will build your proposal."
  );
  revalidatePath("/dashboard");
  return respond(business, { startPipeline: true });
}

// The one confirmation (A and B): the owner reviews the whole strategy on one
// card, may write their own price for any package that shows a market
// reference, and confirms. That confirmation is the approval: Store opens.
export async function confirmProposalAction(prices: Record<string, string>, businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const es = lang === "es";
  let plan = business.plan;
  if (plan.stage !== "proposal" || plan.mode === "agent") return respond(business);
  if (!(await allow(`brain:approve:${business.id}`, 60, 10 * 60))) return respond(business);
  // A price typed here is the owner's own: it replaces the reference.
  const typed: string[] = [];
  const packages = plan.packages.map((k, i) => {
    const raw = String(prices?.[String(i)] ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!raw || !/\d/.test(raw)) return k;
    const price = /\$/.test(raw) ? raw : `$${raw}`;
    typed.push(`${k.name}: ${price}`);
    return { ...k, price, ref: false };
  });
  plan = markReferencePrices({ ...plan, packages }, typed.join(" "));
  if (typed.length) await addChatMessage(business.id, CHANNEL, "user", `${es ? "Mis precios" : "My prices"}: ${typed.join(" · ")}`);
  await addChatMessage(business.id, CHANNEL, "user", es ? "Confirmo mi estrategia." : "I confirm my strategy.");
  const { plan: next, refused } = applyApprovals(readyForPage(plan), APPROVAL_BLOCKS, lang);
  await updateBusinessPlan(business.id, next);
  await walkOn(business, next, refused, lang);
  revalidatePath("/dashboard");
  return respond(business);
}
