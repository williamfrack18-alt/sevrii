"use server";

import { revalidatePath } from "next/cache";
import { fillStoreFromPlan } from "@/lib/storeFill";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/billing";
import { chatGate, gateMessage, researchWouldStart, runForUser } from "@/lib/usage";
import { addChatMessage, getBusinessById, listChatMessages, listServices, updateBusinessPlan, type BusinessRow, type ServiceRow } from "@/lib/db";
import type { Lang } from "@/lib/i18n";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { APPROVAL_BLOCKS, MAX_IDEA_ROUNDS, allApproved, requestMoreIdeas, type ApprovalBlock } from "@/lib/plan";
import { PLAN_TEXT } from "@/lib/planI18n";
import { applyApprovals, chooseIdea, planGreeting, runPlanChatTurn } from "@/lib/brain/interviewer";
import { DONE_TOKEN, cardAfterTurn, forModel, nextPartMessage, partName } from "@/lib/brain/walk";
import type { BusinessPlan } from "@/lib/plan";

const CHANNEL = "plan";

export type PlanChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  services: ServiceRow[];
  startPipeline?: boolean;
  notice?: string;
};

async function requireBusiness(): Promise<BusinessRow> {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
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

export async function sendPlanChatAction(message: string): Promise<PlanChatResponse> {
  const business = await requireBusiness();
  const lang = await getLang();
  const t = getDict(lang).dashboard;
  const text = String(message || "").trim();
  if (!text) return respond(business);

  let history = await listChatMessages(business.id, CHANNEL);
  if (history.length === 0) {
    await addChatMessage(business.id, CHANNEL, "ai", planGreeting(lang, business));
    history = await listChatMessages(business.id, CHANNEL);
  }

  let blocked: string | null = null;
  if (text.length > LIMITS.aiMaxChars) blocked = t.aiTooLong;
  else {
    const reason = await chatGate(business.userId);
    if (reason) blocked = gateMessage(reason, t);
  }
  if (blocked) {
    await addChatMessage(business.id, CHANNEL, "ai", blocked);
    return respond(business);
  }

  await addChatMessage(business.id, CHANNEL, "user", text);
  const result = await runForUser(business.userId, () => runPlanChatTurn({
    business,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: forModel(m.content, lang).slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
  }));
  // Admins (testing) see why the assistant failed, right in the chat.
  const me = result.debug ? await getCurrentUser() : null;
  const reply = me && isAdmin(me) ? `${result.reply}\n\n[debug] ${result.debug}` : result.reply;
  // The part the chat moved to (or changed) shows its card under the reply.
  const card = cardAfterTurn(business.plan, result.business.plan, lang);
  await addChatMessage(business.id, CHANNEL, "ai", card ? `${reply}\n\n${card}` : reply);
  revalidatePath("/dashboard");
  return respond(result.business, { startPipeline: result.startPipeline });
}

// B: the person picks one of the 3 ideas from its card.
export async function chooseIdeaAction(index: number): Promise<PlanChatResponse> {
  const business = await requireBusiness();
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
      : lang === "es"
        ? `¡Buena elección! Antes de investigar tu zona, veamos si estás listo para arrancar. ¿Tienes seguro de responsabilidad civil (general liability) o todavía no?`
        : `Great choice! Before I research your area, let's check you're ready to start. Do you have general liability insurance yet?`
  );
  revalidatePath("/dashboard");
  return respond(business);
}

// Approve one part of the proposal from its card in the chat. The chat
// records it and moves on to the next part.
export async function approveBlockAction(block: string, approved: boolean): Promise<PlanChatResponse> {
  const business = await requireBusiness();
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
  await addChatMessage(business.id, CHANNEL, "user", lang === "es" ? `Aprobado: ${partName(block as ApprovalBlock, lang)}` : `Approved: ${partName(block as ApprovalBlock, lang)}`);
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
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    `${
      filled
        ? lang === "es"
          ? "¡Listo, tu estrategia está aprobada! Ya armé tu página en Store con todo lo que aprobamos. Si quieres cambiar algo después, escríbeme aquí."
          : "Done, your strategy is approved! I already built your page in Store with everything we approved. If you want to change something later, write to me here."
        : lang === "es"
          ? "¡Listo, tu estrategia está aprobada! En Store puedes actualizar tu página con todo lo que aprobamos. Si quieres cambiar algo después, escríbeme aquí."
          : "Done, your strategy is approved! In Store you can update your page with everything we approved. If you want to change something later, write to me here."
    }\n\n${DONE_TOKEN}`
  );
}

// Every block is approved but the plan is still open (a final check stopped
// it, or an edit reopened it): try to finish it again.
export async function finishPlanAction(): Promise<PlanChatResponse> {
  const business = await requireBusiness();
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
export async function noOfferAction(): Promise<PlanChatResponse> {
  const business = await requireBusiness();
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
export async function moreIdeasAction(feedback: string): Promise<PlanChatResponse> {
  const business = await requireBusiness();
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
