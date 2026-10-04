"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { addChatMessage, getBusinessById, listChatMessages, listServices, type BusinessRow, type ServiceRow } from "@/lib/db";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { planGreeting, runPlanChatTurn } from "@/lib/planBrain";

const CHANNEL = "plan";

export type PlanChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  services: ServiceRow[];
};

export async function sendPlanChatAction(message: string): Promise<PlanChatResponse> {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const business = user.business;
  const lang = await getLang();
  const t = getDict(lang).dashboard;
  const text = String(message || "").trim();

  const respond = async (b: BusinessRow) => ({
    messages: (await listChatMessages(business.id, CHANNEL)).map((m) => ({ id: m.id, role: m.role, content: m.content })),
    business: b,
    services: await listServices(business.id),
  });
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
    reload: async () => (await getBusinessById(business.id))!,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
    // Web searches cost money: at most 40 Brain turns with search per account per day.
    allowWebSearch: await allow(`ai:web:u:${business.userId}`, 40, 24 * 60 * 60),
  });
  await addChatMessage(business.id, CHANNEL, "ai", result.reply);
  revalidatePath("/dashboard");
  revalidatePath(`/site/${business.slug}`);
  return respond(result.business);
}
