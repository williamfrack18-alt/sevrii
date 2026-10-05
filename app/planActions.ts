"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { addChatMessage, getBusinessById, listChatMessages, listServices, updateBusinessPlan, type BusinessRow, type ServiceRow } from "@/lib/db";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { APPROVAL_BLOCKS, type ApprovalBlock } from "@/lib/plan";
import { applyApprovals, chooseIdea, planGreeting, runPlanChatTurn } from "@/lib/brain/interviewer";

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
  else if (!(await allow(`ai:min:u:${business.userId}`, 10, 60))) blocked = t.aiSlowDown;
  else if (!(await allow(`ai:day:u:${business.userId}`, 200, 24 * 60 * 60))) blocked = t.aiDailyLimit;
  if (blocked) {
    await addChatMessage(business.id, CHANNEL, "ai", blocked);
    return respond(business);
  }

  await addChatMessage(business.id, CHANNEL, "user", text);
  const result = await runPlanChatTurn({
    business,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
  });
  await addChatMessage(business.id, CHANNEL, "ai", result.reply);
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
  const needsLicense = idea.license && !/^no\b/i.test(idea.license.trim());
  await addChatMessage(
    business.id,
    CHANNEL,
    "ai",
    lang === "es"
      ? `¡Buena elección! Antes de investigar tu zona, veamos si estás listo para arrancar. ${needsLicense ? `Este servicio pide: ${idea.license}. ¿Ya la tienes?` : "¿Tienes seguro de responsabilidad civil (general liability) o todavía no?"}`
      : `Great choice! Before I research your area, let's check you're ready to start. ${needsLicense ? `This service requires: ${idea.license}. Do you have it?` : "Do you have general liability insurance yet?"}`
  );
  revalidatePath("/dashboard");
  return respond(business);
}

// Approve (or un-approve) one block of the proposal from its card.
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
  if (plan.stage !== "proposal") return respond(business);
  const { plan: next, refused } = applyApprovals(plan, [block as ApprovalBlock], lang);
  await updateBusinessPlan(business.id, next);
  if (next.stage === "approved") {
    await addChatMessage(
      business.id,
      CHANNEL,
      "ai",
      lang === "es"
        ? "¡Tu expediente está aprobado! Con esto ya puedo armar tu página en Store. Si quieres cambiar algo después, escríbeme aquí."
        : "Your expediente is approved! I can now build your page in Store. If you want to change something later, write to me here."
    );
  }
  revalidatePath("/dashboard");
  return respond(business, refused.length ? { notice: refused.join(" ") } : {});
}

// "No offer" from the offer card: drop the suggestion and approve the block.
export async function noOfferAction(): Promise<PlanChatResponse> {
  const business = await requireBusiness();
  const lang = await getLang();
  const plan = business.plan;
  if (plan.stage !== "proposal") return respond(business);
  const { plan: next, refused } = applyApprovals({ ...plan, offer: null, noOffer: true }, ["offer"], lang);
  await updateBusinessPlan(business.id, next);
  revalidatePath("/dashboard");
  return respond(business, refused.length ? { notice: refused.join(" ") } : {});
}
