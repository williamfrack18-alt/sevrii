"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { limitsForUserId } from "@/lib/billing";
import { addChatMessage, getBusinessById, listCampaigns, listChatMessages, type BusinessRow, type CampaignRow } from "@/lib/db";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { marketingGreeting, runMarketingChatTurn } from "@/lib/marketingBrain";

const CHANNEL = "brain";

export type MarketingChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  campaigns: CampaignRow[];
};

export async function sendMarketingChatAction(message: string): Promise<MarketingChatResponse> {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const business = user.business;
  const lang = await getLang();
  const t = getDict(lang).dashboard;
  const text = String(message || "").trim();

  const respond = async (b: BusinessRow) => ({
    messages: (await listChatMessages(business.id, CHANNEL)).map((m) => ({ id: m.id, role: m.role, content: m.content })),
    business: b,
    campaigns: await listCampaigns(business.id),
  });
  if (!text) return respond(business);

  let history = await listChatMessages(business.id, CHANNEL);
  if (history.length === 0) {
    await addChatMessage(business.id, CHANNEL, "ai", marketingGreeting(lang, business));
    history = await listChatMessages(business.id, CHANNEL);
  }

  const limits = await limitsForUserId(business.userId);
  if (!limits.marketing) {
    // Free plan: Marketing is part of Starter. Nothing is sent to the AI.
    return respond(business);
  }
  let blocked: string | null = null;
  if (text.length > LIMITS.aiMaxChars) blocked = t.aiTooLong;
  else if (!(await allow(`ai:min:u:${business.userId}`, 10, 60))) blocked = t.aiSlowDown;
  else if (!(await allow(`ai:day:u:${business.userId}`, limits.aiPerDay, 24 * 60 * 60))) blocked = t.aiDailyLimit;
  if (blocked) {
    await addChatMessage(business.id, CHANNEL, "ai", blocked);
    return respond(business);
  }

  await addChatMessage(business.id, CHANNEL, "user", text);
  const result = await runMarketingChatTurn({
    business,
    reload: async () => (await getBusinessById(business.id))!,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
  });
  await addChatMessage(business.id, CHANNEL, "ai", result.reply);
  revalidatePath("/dashboard");
  return respond(result.business);
}
