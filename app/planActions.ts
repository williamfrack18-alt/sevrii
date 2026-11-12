"use server";

import { revalidatePath } from "next/cache";
import { fillStoreFromPlan } from "@/lib/storeFill";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { budgetUsed, chatGate, gateLimit, gateMessage, month, researchLimitText, researchUsage, researchWouldStart, runForUser } from "@/lib/usage";
import { cleanAnswers, pendingCards, cardTitle, type CardAnswers } from "@/lib/cards";
import { dropUnbackedRefs, markReferencePrices, noLanguageClaims, readyForPage, withCurrency } from "@/lib/brain/checks";
import { cardsToProfile } from "@/lib/brain/legacy";
import type { LimitInfo } from "@/lib/upgrade";
import { addChatMessage, getBusinessById, listChatMessages, listServices, updateBusinessPlan, type BusinessRow, type ServiceRow } from "@/lib/db";
import type { Lang } from "@/lib/i18n";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { APPROVAL_BLOCKS, MAX_IDEA_ROUNDS, allApproved, isRestrictedService, missingProfile, requestMoreIdeas, type ApprovalBlock } from "@/lib/plan";
import { PLAN_TEXT } from "@/lib/planI18n";
import { applyApprovals, chooseIdea, planGreeting, resumeStuckResearch, runPlanChatTurn } from "@/lib/brain/interviewer";
import { DONE_TOKEN, cardAfterTurn, forModel, nextPartMessage, nextSteps, pageState } from "@/lib/brain/walk";
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

// Everything the owner wrote in this chat (prices they gave there count as
// theirs, the same as in the chat's own edits).
async function ownerChat(businessId: string): Promise<string> {
  return (await listChatMessages(businessId, CHANNEL))
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
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
  let business = await requireBusiness(businessId);
  // A project that was halfway through the old interview cards: what it
  // already answered is kept (the chat never asks it again).
  {
    const pl = business.plan;
    const p = pl.profile;
    if (pl.stage === "interview" && (pl.mode === "new" || pl.mode === "existing") && Object.keys(pl.cards).length && !p.mainService && !p.workHistory && !p.likes) {
      const profile = await profileFromCards(pl, pl.cards);
      await updateBusinessPlan(business.id, { ...pl, profile: { ...profile, researchReady: false } });
      business = (await getBusinessById(business.id)) ?? business;
    }
  }
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
        ? `¡Buena elección! Ahora investigo precios, competencia y clientes de «${idea.title}» en tu zona (unos minutos). Verás el avance aquí mismo.`
        : `Great choice! I'm now researching prices, competition and customers for "${idea.title}" in your area (a few minutes). You'll see the progress right here.`
    );
    revalidatePath("/dashboard");
    return respond(business, { startPipeline: true });
  }
  await updateBusinessPlan(business.id, next);
  // Nothing left to ask, but the plan's limit won't let the research start:
  // say so (it used to say "una sola cosa" and ask nothing). The screen
  // resumes by itself once the limit allows it.
  if (plan.mode !== "agent" && missingProfile(next).length === 0) {
    const limit = researchLimitText(await researchUsage(business.userId), es ? "es" : "en");
    await addChatMessage(business.id, CHANNEL, "ai", `${es ? "¡Buena elección! Ya tengo todo para investigar este servicio." : "Great choice! I have everything to research this service."} ${limit}`);
    revalidatePath("/dashboard");
    return respond(business);
  }
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
    city: ["¿En qué ciudad lo ofrecerías (y en qué país)?", "In what city would you offer it (and in what country)?"],
    zip: ["¿Cuál es tu código postal (ZIP)?", "What's your ZIP code?"],
    radiusMiles: ["¿Hasta qué distancia te moverías para atender a un cliente (en km o en millas)?", "How far would you travel to serve a customer (in km or miles)?"],
    remoteScope: ["¿Atenderías clientes de todo tu país (te lo recomiendo), solo de tu estado o región, o también de otros países?", "Would you serve customers in your whole country (my recommendation), only your state or region, or other countries too?"],
    country: ["¿En qué país vives? Cambia la moneda, las leyes y el mercado.", "What country do you live in? It changes the currency, the laws and the market."],
    toolsReady: ["¿Ya tienes lo que necesitas para hacerlo, o te falta algo?", "Do you already have what you need to do it, or is something missing?"],
    costHoursPerJob: ["¿Cuántas horas crees que te tomaría cada trabajo? Si nunca lo has hecho, te doy un número típico.", "How many hours would each job take you? If you've never done it, I'll give you a typical number."],
    costMaterialsUsd: ["¿Cuánto gastarías en materiales o herramientas por trabajo? Puede ser cero.", "How much would you spend on materials or tools per job? It can be zero."],
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
  // A service Sevrii doesn't publish: nothing to "fix" in the text, so no
  // "tell me how to change it" (that only invited renaming it). Say it
  // plainly and give the way forward: other ideas (B, C) or another project (A).
  if (refused.length && isRestrictedService(next)) {
    const ideas = next.mode === "new" || next.mode === "agent";
    await addChatMessage(
      business.id,
      CHANNEL,
      "ai",
      es
        ? `Por ahora Sevrii no publica servicios de notario, trámites de inmigración, préstamos ni reparación de crédito. La ley los regula mucho y piden licencias especiales, así que no es algo que se arregle cambiando palabras.\n\n${ideas ? "Te busco otras ideas de servicio con lo que ya me contaste." : "Si ofreces otro servicio, crea un proyecto nuevo con él y lo armamos juntos."}[[restricted]]`
        : `For now Sevrii doesn't publish notary, immigration paperwork, loan or credit repair services. They're heavily regulated and need special licenses, so it isn't something that changing words can fix.\n\n${ideas ? "I'll look for other service ideas with what you already told me." : "If you offer another service, create a new project with it and we'll build it together."}[[restricted]]`
    );
    return;
  }
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
  // The approval is already saved: if the page can't be built right now, the
  // owner still gets the next steps (and builds it from Store), never a dead end.
  const { filled } = await fillStoreFromPlan(business.id, lang, { onlyIfEmpty: true }).catch((err) => {
    console.error("[brain] could not build the page after approval", business.id, err);
    return { filled: false };
  });
  // What the page really has now: built in this approval (or a moment earlier
  // by the chat, from this same plan), still showing an earlier version (a
  // reopened strategy never rewrites a page the owner already has), or none.
  const fresh = await getBusinessById(business.id);
  const hasPage = (await listServices(business.id)).length > 0 || Boolean(fresh?.site.headline);
  await addChatMessage(business.id, CHANNEL, "ai", `${nextSteps(lang, pageState(filled, hasPage, fresh))}\n\n${DONE_TOKEN}`);
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
  // From the ideas, or from a strategy Sevrii can't publish (restricted service).
  const restrictedOut = (plan.stage === "proposal" || plan.stage === "ready_check") && (plan.mode === "new" || plan.mode === "agent") && isRestrictedService(plan);
  if (plan.stage !== "choose" && !restrictedOut) return respond(business);
  if (plan.ideaRounds >= MAX_IDEA_ROUNDS) return respond(business, { notice: t.moreNoLeft });
  if (!(await allow(`brain:more:${business.id}`, 30, 60 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  // Checked before anything changes: over the budget, the 3 ideas stay.
  if (!(await researchWouldStart(business.userId, { budgetOnly: true }))) return respond(business, { notice: getDict(lang).dashboard.aiMonthlyLimit });
  const note = String(feedback || "").trim().replace(/\s+/g, " ").slice(0, 300);
  const more = requestMoreIdeas(plan, note);
  // Leaving a blocked strategy: nothing of it stays approved or half-built.
  await updateBusinessPlan(business.id, restrictedOut ? { ...more, service: "", approvals: {}, guard: { block: [], warn: [] } } : more);
  await addChatMessage(business.id, CHANNEL, "user", restrictedOut ? (lang === "es" ? "Muéstrame otras ideas de servicio." : "Show me other service ideas.") : t.moreUser(note));
  await addChatMessage(business.id, CHANNEL, "ai", t.moreAi);
  revalidatePath("/dashboard");
  return respond(business, { startPipeline: true });
}


// ---------- The interview cards (A and B) ----------

// The cards as profile facts (lib/brain/legacy.ts), with the US city list
// for places that show no sign of another country.
async function profileFromCards(plan: BusinessPlan, cards: CardAnswers): Promise<BusinessPlan["profile"]> {
  const { lookupPlace } = await import("@/lib/geo");
  return cardsToProfile(plan, cards, lookupPlace);
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
    // Already sent once (a research limit stopped it): the saved profile
    // follows the edited cards, so the research that resumes by itself
    // never uses the old answers.
    if (plan.profile.researchReady) next = { ...next, profile: { ...(await profileFromCards(next, answers)), researchReady: pendingCards(plan.mode, answers).length === 0 } };
    await updateBusinessPlan(business.id, next);
    return respond(business);
  }
  const left = pendingCards(plan.mode, answers);
  if (left.length) {
    await updateBusinessPlan(business.id, next);
    return respond(business, { notice: `${es ? "Te falta contestar:" : "Still to answer:"} ${left.map((id) => cardTitle(plan.mode, id, lang)).join(" · ")}` });
  }
  if (!(await allow(`brain:cards:${business.id}`, 20, 60 * 60))) {
    // The answers are kept even when the send has to wait.
    await updateBusinessPlan(business.id, next);
    return respond(business, { notice: getDict(lang).auth.errTooMany });
  }
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
        ? "Gracias, ya tengo todas tus respuestas. Ahora investigo tu zona y te muestro propuestas de servicio que encajen contigo (unos minutos). Nada de lo que me dijiste que no quieres va a aparecer."
        : "Thanks, I have all your answers. I'm researching your area now and will show you service proposals that fit you (a few minutes). Nothing you said you don't want will show up."
      : es
        ? "Gracias, ya tengo todas tus respuestas. Ahora investigo precios, competencia y clientes de tu zona (unos minutos) y te armo la propuesta."
        : "Thanks, I have all your answers. I'm researching prices, competition and customers in your area (a few minutes) and will build your proposal."
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
  if (!(await allow(`brain:approve:${business.id}`, 60, 10 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  // A price typed here is the owner's own: it replaces the reference.
  const said = await ownerChat(business.id);
  const typed: string[] = [];
  const packages = plan.packages.map((k, i) => {
    const raw = String(prices?.[String(i)] ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!raw || !/\d/.test(raw)) return k;
    // In their currency: "45000" next to "$40.000 COP" is "$45000", next to "40 €" it's "45 €".
    const price = withCurrency(raw, k.price, plan.profile.country);
    typed.push(`${k.name}: ${price}`);
    return { ...k, price, ref: false };
  });
  // A price the owner gave earlier in the chat stays theirs (only the typed
  // ones were read here before, so those turned back into references).
  // (The chat counts only amounts said as their price: a competitor's price
  // or a cost they mentioned there never turns a reference into "tu precio".)
  plan = markReferencePrices({ ...plan, packages }, said, typed.join(" "));
  if (typed.length) await addChatMessage(business.id, CHANNEL, "user", `${es ? "Mis precios" : "My prices"}: ${typed.join(" · ")}`);
  await addChatMessage(business.id, CHANNEL, "user", es ? "Confirmo mi estrategia." : "I confirm my strategy.");
  const { plan: next, refused } = applyApprovals(readyForPage(plan), APPROVAL_BLOCKS, lang);
  await updateBusinessPlan(business.id, next);
  await walkOn(business, next, refused, lang);
  revalidatePath("/dashboard");
  return respond(business);
}

// A (existing service): "↻ Ver otra presentación". A new promise and new
// reasons to choose them; never another service, and the packages stay as
// they are: they are the owner's own jobs with the owner's own prices.
export async function otherPackagesAction(businessId?: string): Promise<PlanChatResponse> {
  const business = await requireBusiness(businessId);
  const lang = await getLang();
  const es = lang === "es";
  const plan = business.plan;
  if (plan.stage !== "proposal" || plan.mode !== "existing") return respond(business);
  if (!(await allow(`brain:otherpk:${business.id}`, 10, 60 * 60))) return respond(business, { notice: getDict(lang).auth.errTooMany });
  if (!(await researchWouldStart(business.userId, { budgetOnly: true }))) return respond(business, { notice: getDict(lang).dashboard.aiMonthlyLimit });
  const { proposePlan } = await import("@/lib/brain/strategist");
  const { withoutAvoided, noFakeCosts, withoutDiscounts } = await import("@/lib/brain/checks");
  const own = plan.packages.filter((k) => !k.ref);
  const notes = [
    `Keep the service exactly as it is: "${plan.service}". Do not change it or its menu.`,
    plan.packages.length ? `Keep these packages exactly, same names and prices: ${plan.packages.map((k) => `${k.name} ${k.price}`.trim()).join("; ")}.` : "",
    `The owner wants a DIFFERENT presentation (promise and reasons to choose them) than this one, which they already saw: "${plan.promise}" | ${plan.differentiators.join(" | ")}. Don't repeat it.`,
  ].filter(Boolean);
  let fresh: Awaited<ReturnType<typeof proposePlan>>;
  try {
    fresh = await runForUser(business.userId, () => proposePlan(plan, lang, notes), "brain_research", true);
  } catch {
    return respond(business, { notice: es ? "No pude traer otra versión ahora. Inténtalo de nuevo en un momento." : "I couldn't get another version right now. Try again in a moment." });
  }
  // Nothing new came back: keep what they have.
  if (!fresh.promise || fresh.promise === plan.promise) return respond(business, { notice: es ? "No pude traer otra versión ahora. Inténtalo de nuevo en un momento." : "I couldn't get another version right now. Try again in a moment." });
  let next: BusinessPlan = {
    ...plan,
    promise: fresh.promise,
    differentiators: fresh.differentiators?.length ? fresh.differentiators : plan.differentiators,
    approvals: {},
  };
  // The owner's prices (card or chat) stay theirs; the new ones are references.
  next = withoutAvoided(noFakeCosts(noLanguageClaims(dropUnbackedRefs(markReferencePrices(next, await ownerChat(business.id))))));
  if (!next.profile.offerWanted) next = withoutDiscounts(next);
  await updateBusinessPlan(business.id, next);
  await addChatMessage(business.id, CHANNEL, "user", es ? "Ver otra presentación" : "See another presentation");
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    `${es ? `Te traje otra forma de presentarte. Tu servicio${own.length ? " y tus precios" : ""} siguen igual.` : `Here's another way to present yourself. Your service${own.length ? " and your prices" : ""} stay the same.`}\n\n[[summary]]`
  );
  revalidatePath("/dashboard");
  return respond(business);
}
