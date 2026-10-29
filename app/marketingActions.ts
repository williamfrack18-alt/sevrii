"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { limitsForUserId } from "@/lib/billing";
import { addChatMessage, getBusinessById, getMarketingAction, listCampaigns, listChatMessages, listMarketingVideos, pendingMarketingAction, type BusinessRow, type CampaignRow } from "@/lib/db";
import { actionToken, continueLaunch, publicVideo, refreshVideoStats, runMarketingAction, type PublicVideo } from "@/lib/marketingVideos";
import { advanceVideoJob, resumeVideoJob, reviveIfClosed } from "@/lib/marketingVideoJob";
import { allow, LIMITS } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { marketingGreeting, runMarketingChatTurn } from "@/lib/marketingBrain";
import { chatGate, gateMessage, runForUser } from "@/lib/usage";

const CHANNEL = "brain";

export type MarketingChatResponse = {
  messages: { id: string; role: string; content: string }[];
  business: BusinessRow;
  campaigns: CampaignRow[];
};

// A plain yes to the proposal on screen ("dale", "sí, hazlo", "ok"): only yes
// words, no "no / pero / espera". Anything else goes to the strategist.
const YES_WORDS = new Set(["si", "sí", "dale", "ok", "okay", "okey", "hazlo", "hagale", "hágale", "házlo", "listo", "de", "acuerdo", "adelante", "vamos", "va", "apruebo", "aprobado", "claro", "perfecto", "por", "favor", "porfa", "yes", "yep", "yeah", "sure", "go", "ahead", "do", "it", "approve", "approved", "please"]);
function plainYes(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-záéíóúñü\s]/g, " ").split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && words.every((w) => YES_WORDS.has(w)) && !words.every((w) => ["de", "por", "favor", "please", "it", "do", "go"].includes(w));
}

export async function sendMarketingChatAction(message: string, focusVideoId?: string): Promise<MarketingChatResponse> {
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
  else {
    const reason = await chatGate(business.userId, limits);
    if (reason) blocked = gateMessage(reason, t);
  }
  if (blocked) {
    await addChatMessage(business.id, CHANNEL, "ai", blocked);
    return respond(business);
  }

  await addChatMessage(business.id, CHANNEL, "user", text);
  // "Dale" to the one proposal waiting: run exactly that action (no AI call).
  if (plainYes(text)) {
    const pending = await pendingMarketingAction(business.id);
    if (pending) {
      const done = await runMarketingAction(business, pending, lang);
      await addChatMessage(business.id, CHANNEL, "ai", done);
      revalidatePath("/dashboard");
      return respond((await getBusinessById(business.id)) ?? business);
    }
  }
  const result = await runForUser(business.userId, () => runMarketingChatTurn({
    business,
    reload: async () => (await getBusinessById(business.id))!,
    history: history.slice(-16).map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    })),
    message: text,
    lang,
    focusVideoId: focusVideoId ? String(focusVideoId).slice(0, 64) : undefined,
  }));
  // A proposal made in this turn gets its OK button under the reply.
  const proposed = result.proposedActionId ? await getMarketingAction(business.id, result.proposedActionId) : null;
  await addChatMessage(business.id, CHANNEL, "ai", proposed?.status === "pending" ? `${result.reply}\n\n${actionToken(proposed.id)}` : result.reply);
  revalidatePath("/dashboard");
  return respond(result.business);
}

// ---------- AI videos (one OK = one action) ----------

async function marketingOwner() {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const limits = await limitsForUserId(user.business.userId);
  return { business: user.business, allowed: Boolean(limits.marketing) };
}

export type MarketingVideosResponse = {
  videos: PublicVideo[];
  pending: { id: string; summary: string } | null;
  messages: { id: string; role: string; content: string }[];
};

async function videosResponse(b: BusinessRow): Promise<MarketingVideosResponse> {
  const [videos, pending, messages] = await Promise.all([listMarketingVideos(b.id), pendingMarketingAction(b.id), listChatMessages(b.id, CHANNEL)]);
  return {
    videos: videos.map(publicVideo),
    pending: pending ? { id: pending.id, summary: pending.summary } : null,
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

// The OK button under a proposal: runs that action once (a second tap does nothing).
export async function approveMarketingActionAction(id: string): Promise<MarketingVideosResponse> {
  const { business, allowed } = await marketingOwner();
  if (!allowed || !(await allow(`mk-ok:${business.id}`, 20, 60))) return videosResponse(business);
  const action = await getMarketingAction(business.id, String(id || ""));
  const lang = await getLang();
  if (action && action.status === "pending") {
    await addChatMessage(business.id, CHANNEL, "user", lang === "es" ? "Sí, hazlo." : "Yes, do it.");
    await addChatMessage(business.id, CHANNEL, "ai", await runMarketingAction(business, action, lang));
    revalidatePath("/dashboard");
  }
  return videosResponse(business);
}

// The gallery: numbers read from Meta (every ~10 min) and launches Meta finished processing.
export async function listMarketingVideosAction(refresh = false): Promise<MarketingVideosResponse> {
  const { business, allowed } = await marketingOwner();
  if (!allowed) return videosResponse(business);
  const lang = await getLang();
  const videos = await listMarketingVideos(business.id);
  // A live view whose cloud browser already closed: open a new one (the owner is asked again).
  for (const v of videos.filter((x) => x.status === "making" && x.job.state === "waiting")) await reviveIfClosed(business, v).catch(() => v);
  for (const v of videos.filter((x) => x.status === "launching")) {
    const msg = await continueLaunch(business, v.id, lang).catch(() => "");
    if (msg) await addChatMessage(business.id, CHANNEL, "ai", `${msg}\n\n[[mkvideo:${v.id}]]`);
  }
  await refreshVideoStats(business, refresh).catch((err) => console.error("[marketing] video stats", (err as Error)?.message));
  return videosResponse(business);
}

// A few steps of the cloud browser on the video being made (the gallery keeps calling).
export async function advanceMarketingVideoAction(id: string): Promise<MarketingVideosResponse & { more: boolean }> {
  const { business, allowed } = await marketingOwner();
  if (!allowed || !(await allow(`mk-video:${business.id}`, 30, 600))) return { ...(await videosResponse(business)), more: false };
  const r = await runForUser(business.userId, () => advanceVideoJob(business, String(id || "")));
  return { ...(await videosResponse(business)), more: r.more };
}

// The owner finished in the live view ("Listo"), or wants to stop this video.
export async function videoReplyAction(id: string, reply: "done" | "stop"): Promise<MarketingVideosResponse> {
  const { business, allowed } = await marketingOwner();
  if (allowed) await resumeVideoJob(business, String(id || ""), reply === "stop");
  return videosResponse(business);
}
