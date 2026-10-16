"use server";

import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import {
  addConvMessage,
  createConversation,
  getBusinessBySlug,
  getConversationByToken,
  getConversationForBusiness,
  getUserById,
  listConvMessages,
  listConversations,
  listServices,
  updateConversation,
  type BusinessRow,
  type ConvMessageRow,
  type ConversationRow,
} from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { researchGate, runForUser } from "@/lib/usage";
import { runVisitorAi } from "@/lib/visitorChat";
import { emailVisitorReply, notifyChatOwner } from "@/lib/notify";

const MAX_CHARS = 600;
const MAX_AI_REPLIES_PER_CONV = 30;
const MAX_AI_REPLIES_PER_BIZ_DAY = 300;

export type ChatMsg = { seq: number; role: "visitor" | "ai" | "owner"; content: string };
export type VisitorChatResult =
  | { ok: true; token: string; messages: ChatMsg[]; waiting: boolean }
  | { ok: false; error: "closed" | "rate" | "long" | "empty" };

function hashToken(t: string): string {
  return createHash("sha256").update(`sevrii-chat:${t}`).digest("hex");
}
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
const pub = (m: ConvMessageRow): ChatMsg => ({ seq: m.seq, role: m.role, content: m.content });

// Same rule as the page itself: only live pages chat (the owner can test a draft).
async function openBusiness(slug: string): Promise<BusinessRow | null> {
  const b = await getBusinessBySlug(clean(slug, 80));
  if (!b || !b.site.chat) return null;
  const owner = await getUserById(b.userId);
  if (b.published && owner && limitsFor(owner).canPublish) return b;
  const viewer = await getCurrentUser().catch(() => null);
  return viewer?.id === b.userId ? b : null;
}

function fallback(b: BusinessRow, conv: ConversationRow): string {
  const es = b.site.lang !== "en";
  if (conv.phone || conv.email) return es ? `¡Gracias! ${b.name} te responde muy pronto.` : `Thanks! ${b.name} will get back to you very soon.`;
  return es
    ? `¡Gracias por escribir! ${b.name} te responde muy pronto. ¿Me dejas tu nombre y tu teléfono (o correo) para que te contacten?`
    : `Thanks for your message! ${b.name} will reply very soon. Can you leave your name and phone (or email) so they can reach you?`;
}

// Emails the owner at most once every 20 minutes per conversation, plus every handoff.
async function maybeNotify(b: BusinessRow, conv: ConversationRow, why: "contact" | "handoff" | "message", detail: string) {
  const recent = conv.notifiedAt && Date.now() - Date.parse(conv.notifiedAt) < 20 * 60 * 1000;
  if (recent && why !== "handoff") return;
  await updateConversation(conv.id, { notified: true });
  after(() => notifyChatOwner(b, conv, why, detail));
}

export async function visitorChatSendAction(input: { slug: string; token?: string; text: string }): Promise<VisitorChatResult> {
  const b = await openBusiness(input.slug);
  if (!b) return { ok: false, error: "closed" };
  const text = clean(input.text, MAX_CHARS + 1);
  if (!text) return { ok: false, error: "empty" };
  if (text.length > MAX_CHARS) return { ok: false, error: "long" };

  const ip = await clientIp();
  if (!(await allow(`vchat:msg:${ip}`, 25, 10 * 60)) || !(await allow(`vchat:biz:${b.id}`, 600, 24 * 60 * 60))) return { ok: false, error: "rate" };

  let token = clean(input.token, 100);
  let conv = token ? await getConversationByToken(b.id, hashToken(token)) : null;
  if (!conv) {
    if (!(await allow(`vchat:new:${ip}`, 6, 60 * 60))) return { ok: false, error: "rate" };
    token = randomBytes(24).toString("hex");
    conv = await createConversation(b.id, hashToken(token));
  }

  await addConvMessage(conv.id, "visitor", text);
  let history = await listConvMessages(conv.id, 0, 40);

  let reply = "";
  let waiting = !conv.aiEnabled;
  if (conv.aiEnabled) {
    const capped =
      conv.aiReplies >= MAX_AI_REPLIES_PER_CONV ||
      !(await allow(`vchat:ai:${b.id}`, MAX_AI_REPLIES_PER_BIZ_DAY, 24 * 60 * 60)) ||
      // Visitors only spend the owner's monthly AI budget (not the owner's own chat limits).
      Boolean(await researchGate(b.userId, undefined, { budgetOnly: true }));
    const services = await listServices(b.id);
    const ai = capped ? null : await runForUser(b.userId, () => runVisitorAi(b, services, conv!, history)).catch(() => null);
    if (ai?.contact) {
      const c = ai.contact;
      await updateConversation(conv.id, { name: c.name, phone: c.phone, email: c.email });
      conv = { ...conv, name: c.name ?? conv.name, phone: c.phone ?? conv.phone, email: c.email ?? conv.email };
    }
    reply = ai?.reply || fallback(b, conv);
    await addConvMessage(conv.id, "ai", reply);
    if (!ai) {
      // The AI can't answer right now: the owner takes this one.
      await updateConversation(conv.id, { aiEnabled: false, handoff: true });
      waiting = true;
      await maybeNotify(b, conv, "message", text);
    } else if (ai.handoff) {
      await updateConversation(conv.id, { handoff: true });
      await maybeNotify(b, { ...conv }, "handoff", ai.handoff);
    } else if (ai.contact && (ai.contact.phone || ai.contact.email)) {
      await maybeNotify(b, conv, "contact", text);
    }
  } else {
    await maybeNotify(b, conv, "message", text);
  }

  history = await listConvMessages(conv.id, 0, 60);
  return { ok: true, token, messages: history.map(pub), waiting };
}

// The open chat window asks for new messages (the owner's replies) every few seconds.
export async function visitorChatPollAction(input: { slug: string; token: string; after: number }): Promise<{ ok: boolean; messages: ChatMsg[] }> {
  const b = await openBusiness(input.slug);
  const token = clean(input.token, 100);
  if (!b || !token) return { ok: false, messages: [] };
  if (!(await allow(`vchat:poll:${await clientIp()}`, 120, 5 * 60))) return { ok: false, messages: [] };
  const conv = await getConversationByToken(b.id, hashToken(token));
  if (!conv) return { ok: false, messages: [] };
  await updateConversation(conv.id, { seen: true });
  const after = Number.isFinite(input.after) ? Math.max(0, Math.floor(input.after)) : 0;
  return { ok: true, messages: (await listConvMessages(conv.id, after, 80)).map(pub) };
}

// ---------- Owner side (dashboard inbox) ----------

async function ownerBusiness(): Promise<BusinessRow | null> {
  const user = await getCurrentUser();
  return user?.business ?? null;
}

export type InboxConversation = Pick<ConversationRow, "id" | "name" | "phone" | "email" | "aiEnabled" | "handoff" | "ownerUnread" | "lastMessage" | "lastMessageAt">;

export async function listInboxAction(): Promise<InboxConversation[]> {
  const b = await ownerBusiness();
  if (!b) return [];
  return (await listConversations(b.id, 50)).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    aiEnabled: c.aiEnabled,
    handoff: c.handoff,
    ownerUnread: c.ownerUnread,
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt,
  }));
}

export async function openInboxConversationAction(id: string, afterSeq = 0): Promise<{ ok: boolean; messages: ChatMsg[] }> {
  const b = await ownerBusiness();
  if (!b) return { ok: false, messages: [] };
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  if (!conv) return { ok: false, messages: [] };
  if (conv.ownerUnread) await updateConversation(conv.id, { read: true });
  return { ok: true, messages: (await listConvMessages(conv.id, Math.max(0, afterSeq), 200)).map(pub) };
}

export async function ownerReplyAction(id: string, text: string): Promise<{ ok: boolean; messages: ChatMsg[] }> {
  const b = await ownerBusiness();
  if (!b) return { ok: false, messages: [] };
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  const body = clean(text, 2000);
  if (!conv || !body) return { ok: false, messages: [] };
  if (!(await allow(`ochat:${b.id}`, 120, 10 * 60))) return { ok: false, messages: [] };
  await addConvMessage(conv.id, "owner", body);
  // The owner took over: the AI stops answering in this conversation.
  await updateConversation(conv.id, { aiEnabled: false, handoff: false });
  // If the customer isn't looking at the chat right now, the answer goes to their email.
  if (conv.email && Date.now() - Date.parse(conv.visitorSeenAt) > 90 * 1000) after(() => emailVisitorReply(b, conv, body));
  return { ok: true, messages: (await listConvMessages(conv.id, 0, 200)).map(pub) };
}

export async function setConversationAiAction(id: string, on: boolean): Promise<boolean> {
  const b = await ownerBusiness();
  if (!b) return false;
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  if (!conv) return false;
  await updateConversation(conv.id, { aiEnabled: Boolean(on) });
  return true;
}
