"use server";

import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import {
  addConvMessage,
  addAiMessageIfStillAi,
  claimAiReply,
  setHandoffOnce,
  patchBusinessSite,
  createConversation,
  getBusinessBySlug,
  getConversationByToken,
  getConversationForBusiness,
  getUserById,
  listConvMessages,
  listConversations,
  countUnreadConversations,
  listServices,
  updateConversation,
  savePushSub,
  deletePushSub,
  listPushSubs,
  type BusinessRow,
  type ConvMessageRow,
  type ConversationRow,
} from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { runForUser, visitorAiAccount, visitorAiGate } from "@/lib/usage";
import { normalizePhone } from "@/lib/site";
import { runVisitorAi } from "@/lib/visitorChat";
import { defang, emailVisitorReply, notifyChatOwner } from "@/lib/notify";
import { pushPublicKey, pushToUser } from "@/lib/push";

const MAX_CHARS = 600;
const MAX_AI_REPLIES_PER_CONV = 30;
const MAX_AI_REPLIES_PER_BIZ_DAY = 300;
const MAX_AI_REPLIES_PER_IP_DAY = 40;

export type ChatMsg = { seq: number; role: "visitor" | "ai" | "owner"; content: string; at: string };
export type VisitorChatResult =
  | { ok: true; token: string; messages: ChatMsg[]; waiting: boolean }
  | { ok: false; error: "closed" | "rate" | "long" | "empty" };

function hashToken(t: string): string {
  return createHash("sha256").update(`sevrii-chat:${t}`).digest("hex");
}
function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}
const pub = (m: ConvMessageRow): ChatMsg => ({ seq: m.seq, role: m.role, content: m.content, at: m.createdAt });

// Same rule as the page itself: only live pages chat (the owner can test a draft).
async function openBusiness(slug: string): Promise<BusinessRow | null> {
  const b = await getBusinessBySlug(clean(slug, 80));
  if (!b || !b.site.chat) return null;
  const owner = await getUserById(b.userId);
  if (b.published && owner && limitsFor(owner).canPublish) return b;
  const viewer = await getCurrentUser().catch(() => null);
  return viewer?.id === b.userId ? b : null;
}

function fallback(b: BusinessRow, hasContact: boolean): string {
  const es = b.site.lang !== "en";
  if (hasContact) return es ? `¡Gracias! ${b.name} te responde muy pronto.` : `Thanks! ${b.name} will get back to you very soon.`;
  return es
    ? `¡Gracias por escribir! ${b.name} te responde muy pronto. ¿Me dejas tu nombre y tu teléfono (o correo) para que te contacten?`
    : `Thanks for your message! ${b.name} will reply very soon. Can you leave your name and phone (or email) so they can reach you?`;
}
const isFallback = (b: BusinessRow, text: string) => text === fallback(b, true) || text === fallback(b, false);

// When the assistant isn't answering, still catch a phone or email the
// customer types, so the owner can reach them.
const EMAIL_IN_TEXT = /[^\s@<>()]{1,64}@[^\s@<>()]{1,200}\.[a-z]{2,24}/i;
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
function sniffContact(text: string): { name?: string; phone?: string; email?: string } {
  const out: { name?: string; phone?: string; email?: string } = {};
  const e = EMAIL_IN_TEXT.exec(text)?.[0]?.toLowerCase().replace(/[.,;:]+$/, "");
  if (e && e.length <= 254) out.email = e;
  const p = PHONE_IN_TEXT.exec(text)?.[0];
  const n = p ? normalizePhone(p) : "";
  if (n) out.phone = n;
  return out;
}

// Tells the owner someone wrote: push to their phone/computer and email.
// New chat, contact left, wants to book: right away (each at most once per
// chat, by the caller). Other messages: push at most every 3 minutes per chat;
// email only when the assistant isn't answering (every 20 min). Every alert is
// also capped per business, so a script can't flood the owner's phone or inbox.
type Why = "new" | "contact" | "handoff" | "message";
async function notifyOwner(b: BusinessRow, conv: ConversationRow, why: Why, detail: string, aiAnswering: boolean) {
  const important = why !== "message";
  const push =
    (important || (await allow(`push:conv:${conv.id}`, 1, 3 * 60))) && (await allow(`push:biz:${b.id}`, 40, 60 * 60));
  const mail =
    b.site.notifyEmail &&
    (important ? await allow(`mail:conv:imp:${conv.id}`, 4, 24 * 60 * 60) : !aiAnswering && (await allow(`mail:conv:${conv.id}`, 1, 20 * 60))) &&
    (await allow(`mail:biz:${b.id}`, 15, 60 * 60));
  if (!push && !mail) return;
  if (mail) await updateConversation(conv.id, { notified: true });
  const es = b.site.lang !== "en";
  const who = conv.name ? defang(conv.name).slice(0, 40) : es ? "Un cliente" : "A customer";
  const title =
    why === "handoff"
      ? es ? `${who} quiere agendar` : `${who} wants to book`
      : why === "contact"
        ? es ? `${who} dejó sus datos` : `${who} left their contact`
        : why === "new"
          ? es ? `Nuevo chat en ${b.name}` : `New chat on ${b.name}`
          : es ? `${who} te escribió` : `${who} wrote you`;
  const body = defang(detail).slice(0, 180);
  after(async () => {
    if (push) await pushToUser(b.userId, { title, body, url: `/dashboard?view=chats&c=${conv.id}`, tag: `chat-${conv.id}` });
    if (mail) await notifyChatOwner(b, conv, why === "new" ? "message" : why, detail);
  });
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
  const isNew = !conv;
  if (!conv) {
    if (!(await allow(`vchat:new:${ip}`, 6, 60 * 60))) return { ok: false, error: "rate" };
    token = randomBytes(24).toString("hex");
    conv = await createConversation(b.id, hashToken(token));
  }

  const visitorMsg = await addConvMessage(conv.id, "visitor", text);
  const history = await listConvMessages(conv.id, 0, 40);
  const hadContact = Boolean(conv.phone || conv.email);

  // The assistant answers while it's on and within limits. Its cost comes out
  // of the visitors' own pot (never the owner's AI), capped per chat, per
  // business per day and per visitor per business per day.
  let ai: Awaited<ReturnType<typeof runVisitorAi>> = null;
  if (conv.aiEnabled) {
    const canAi =
      (await allow(`vchat:ai:${b.id}`, MAX_AI_REPLIES_PER_BIZ_DAY, 24 * 60 * 60)) &&
      (await allow(`vchat:ai:ip:${b.id}:${ip}`, MAX_AI_REPLIES_PER_IP_DAY, 24 * 60 * 60)) &&
      (await visitorAiGate(b.userId)) &&
      (await claimAiReply(conv.id, MAX_AI_REPLIES_PER_CONV));
    if (canAi) {
      const services = await listServices(b.id);
      const c = conv;
      ai = await runForUser(visitorAiAccount(b.userId), () => runVisitorAi(b, services, c, history)).catch(() => null);
    }
  }

  const found = ai ? ai.contact : sniffContact(text);
  if (found && (found.name || found.phone || found.email)) {
    const patch = { name: found.name || undefined, phone: found.phone || undefined, email: found.email || undefined };
    await updateConversation(conv.id, patch);
    conv = { ...conv, name: patch.name ?? conv.name, phone: patch.phone ?? conv.phone, email: patch.email ?? conv.email };
  }

  let waiting = !conv.aiEnabled;
  let aiAnswered = false;
  let wantsOwner = "";
  if (conv.aiEnabled) {
    if (ai?.reply) {
      // Dropped if the owner jumped in while it was being written.
      aiAnswered = Boolean(await addAiMessageIfStillAi(conv.id, ai.reply, visitorMsg.seq));
      if (!aiAnswered) waiting = true;
      if (ai.handoff) wantsOwner = ai.handoff;
    } else {
      // The assistant can't answer right now (a limit or an error). It stays on
      // for the next messages; this one goes to the owner, with a short holding
      // reply (not repeated on every message).
      const repeated = history.slice(-8).some((m) => m.role === "ai" && isFallback(b, m.content));
      if (!repeated) await addAiMessageIfStillAi(conv.id, fallback(b, Boolean(conv.phone || conv.email)), visitorMsg.seq);
      waiting = true;
      wantsOwner = text;
    }
  }

  if (wantsOwner && (await setHandoffOnce(conv.id))) await notifyOwner(b, conv, "handoff", wantsOwner, aiAnswered);
  else if (!hadContact && (conv.phone || conv.email)) await notifyOwner(b, conv, "contact", text, aiAnswered);
  else await notifyOwner(b, conv, isNew ? "new" : "message", text, aiAnswered);

  const latest = await listConvMessages(conv.id, 0, 60);
  return { ok: true, token, messages: latest.map(pub), waiting };
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

async function pageIsLive(b: BusinessRow): Promise<boolean> {
  if (!b.published) return false;
  const owner = await getUserById(b.userId);
  return Boolean(owner && limitsFor(owner).canPublish);
}

export async function unreadChatsAction(): Promise<number> {
  const b = await ownerBusiness();
  if (!b) return 0;
  return countUnreadConversations(b.id);
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

// markRead: only when the owner is really looking (tab visible), so messages
// that arrive while the dashboard sits in a background tab stay unread.
export async function openInboxConversationAction(id: string, afterSeq = 0, markRead = true): Promise<{ ok: boolean; messages: ChatMsg[] }> {
  const b = await ownerBusiness();
  if (!b) return { ok: false, messages: [] };
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  if (!conv) return { ok: false, messages: [] };
  if (markRead && conv.ownerUnread) await updateConversation(conv.id, { read: true });
  return { ok: true, messages: (await listConvMessages(conv.id, Math.max(0, afterSeq), 200)).map(pub) };
}

export async function ownerReplyAction(id: string, text: string): Promise<{ ok: boolean; messages: ChatMsg[] }> {
  const b = await ownerBusiness();
  if (!b) return { ok: false, messages: [] };
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  const body = clean(text, 2000);
  if (!conv || !body) return { ok: false, messages: [] };
  if (!(await allow(`ochat:${b.id}`, 120, 10 * 60))) return { ok: false, messages: [] };
  // The owner takes over first, so an answer the assistant is still writing is dropped.
  await updateConversation(conv.id, { aiEnabled: false, handoff: false });
  await addConvMessage(conv.id, "owner", body);
  // If the customer isn't looking at the chat right now, the answer goes to the
  // email they left. That address isn't verified, so it's kept tight: live
  // (paid) pages only, one email per chat every 10 minutes, at most 3 a day
  // per chat and 30 a day per business, and links are removed.
  if (conv.email && Date.now() - Date.parse(conv.visitorSeenAt) > 90 * 1000 && (await pageIsLive(b))) {
    const okToMail =
      (await allow(`vmail:conv10:${conv.id}`, 1, 10 * 60)) &&
      (await allow(`vmail:conv:${conv.id}`, 3, 24 * 60 * 60)) &&
      (await allow(`vmail:biz:${b.id}`, 30, 24 * 60 * 60));
    if (okToMail) after(() => emailVisitorReply(b, conv, body));
  }
  return { ok: true, messages: (await listConvMessages(conv.id, 0, 200)).map(pub) };
}

export async function setConversationAiAction(id: string, on: boolean): Promise<boolean> {
  const b = await ownerBusiness();
  if (!b) return false;
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  if (!conv) return false;
  // Handing the chat back to the assistant also means it's no longer waiting for the owner.
  await updateConversation(conv.id, on ? { aiEnabled: true, handoff: false } : { aiEnabled: false });
  return true;
}

// The owner took care of it (by phone, email, in person…): no longer pending.
export async function resolveConversationAction(id: string): Promise<boolean> {
  const b = await ownerBusiness();
  if (!b) return false;
  const conv = await getConversationForBusiness(b.id, clean(id, 64));
  if (!conv) return false;
  await updateConversation(conv.id, { handoff: false, read: true });
  return true;
}

// ---------- Owner notification settings ----------

export type NotifySettings = { email: boolean; ownerEmail: string; pushKey: string; devices: number };

export async function getNotifySettingsAction(): Promise<NotifySettings | null> {
  const user = await getCurrentUser();
  if (!user?.business) return null;
  return {
    email: user.business.site.notifyEmail,
    ownerEmail: user.email,
    pushKey: pushPublicKey(),
    devices: (await listPushSubs(user.id)).length,
  };
}

// How customers see the owner when the owner answers in the chat.
export async function setOwnerNameAction(name: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user?.business) return null;
  const v = clean(name, 40).replace(/\s+/g, " ");
  if (v.length < 2) return null;
  await patchBusinessSite(user.business.id, { ownerName: v });
  return v;
}

export async function getOwnerProfileAction(): Promise<{ name: string; photo: string } | null> {
  const user = await getCurrentUser();
  if (!user?.business) return null;
  return { name: user.business.site.ownerName, photo: user.business.site.coverUrl };
}

export async function setNotifyEmailAction(on: boolean): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user?.business) return false;
  await patchBusinessSite(user.business.id, { notifyEmail: Boolean(on) });
  return true;
}

// Only the browsers' real push services (so the server never sends requests
// to an address someone typed).
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.mozilla\.com$/, /\.mozaws\.net$/, /\.notify\.windows\.com$/, /^web\.push\.apple\.com$/, /\.push\.apple\.com$/];
function isPushEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export async function savePushSubAction(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, label: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const endpoint = clean(sub?.endpoint, 1000);
  if (!isPushEndpoint(endpoint)) return false;
  const p256dh = clean(sub?.keys?.p256dh, 200);
  const auth = clean(sub?.keys?.auth, 100);
  if (!p256dh || !auth) return false;
  if (!(await allow(`pushsub:${user.id}`, 20, 60 * 60))) return false;
  await savePushSub({ endpoint, userId: user.id, p256dh, auth, label: clean(label, 60) });
  return true;
}

export async function deletePushSubAction(endpoint: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  await deletePushSub(clean(endpoint, 1000), user.id);
  return true;
}

export async function testPushAction(): Promise<number> {
  const user = await getCurrentUser();
  if (!user?.business) return 0;
  if (!(await allow(`pushtest:${user.id}`, 6, 10 * 60))) return 0;
  const es = user.business.site.lang !== "en";
  return pushToUser(user.id, {
    title: es ? "✅ Notificaciones activadas" : "✅ Notifications are on",
    body: es ? `Así te avisaremos cuando alguien escriba en ${user.business.name}.` : `This is how we'll tell you when someone writes to ${user.business.name}.`,
    url: "/dashboard?view=chats",
    tag: "test",
  });
}
