"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createUser,
  getUserByEmail,
  createBusiness,
  isSlugTaken,
  addService,
  addChatMessage,
  updateBusinessWhatsapp,
  listCampaigns,
  listChatMessages,
  listServices,
  incrementContactClick,
  getBusinessBySlug,
  createPageReport,
} from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  newSessionToken,
  hashSessionToken,
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";
import { createSessionRow, deleteSessionRow } from "@/lib/db";
import { allow, clear, clientIp, LIMITS } from "@/lib/guard";
import { generateSiteDraft } from "@/lib/siteAI";
import { EMPTY_SITE, normalizePhone } from "@/lib/site";
import { getCurrentUser } from "@/lib/session";
import { runPageEditorTurn } from "@/lib/aiEditor";
import { runMarketingAgentTurn } from "@/lib/marketingAgent";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import {
  generatePitch,
  matchCategory,
  slugify,
  suggestServices,
  nextOnboardingPrompt,
  nextDiscoveryPrompt,
  generateDiscoveryPitch,
  type DiscoveryAnswers,
  type Idea,
} from "@/lib/ai";

async function startSession(userId: string) {
  const token = newSessionToken();
  await createSessionRow(hashSessionToken(token), userId, SESSION_MAX_AGE);
  (await cookies()).delete(LEGACY_SESSION_COOKIE);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export type FormState = { error?: string } | null;

function pageLiveMessage(lang: "es" | "en", _slug: string) {
  return lang === "es"
    ? "Listo, tu página quedó como borrador. Revisa los textos y precios, agrega tu teléfono y publícala desde la pestaña Store."
    : "Done — your page is saved as a draft. Review the text and prices, add your phone, and publish it from the Store tab.";
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const t = getDict(await getLang());

  if (!email || !password) {
    return { error: t.auth.errFill };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: t.auth.errEmail };
  }
  if (password.length < 8) {
    return { error: t.auth.errPassword };
  }
  if (password.length > 128) {
    return { error: t.auth.errPasswordLong };
  }
  if (!(await allow(`signup:ip:${(await clientIp())}`, LIMITS.signupPerIp.limit, LIMITS.signupPerIp.window))) {
    return { error: t.auth.errTooMany };
  }
  if (await getUserByEmail(email)) {
    return { error: t.auth.errExists };
  }

  const { hash, salt } = hashPassword(password);
  const user = await createUser(email, hash, salt);
  await startSession(user.id);
  redirect("/start");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "").slice(0, 128);
  const t = getDict(await getLang());

  const emailKey = `login:email:${email}`;
  const ipOk = await allow(`login:ip:${(await clientIp())}`, LIMITS.loginPerIp.limit, LIMITS.loginPerIp.window);
  const emailOk = await allow(emailKey, LIMITS.loginPerEmail.limit, LIMITS.loginPerEmail.window);
  if (!ipOk || !emailOk) {
    return { error: t.auth.errTooMany };
  }

  const user = await getUserByEmail(email);
  if (!user) {
    burnPasswordCheck(password);
    return { error: t.auth.errWrong };
  }
  if (!verifyPassword(password, user.passwordHash, user.salt)) {
    return { error: t.auth.errWrong };
  }
  await clear(emailKey);
  await startSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) {
    try {
      await deleteSessionRow(hashSessionToken(token));
    } catch (err) {
      console.error("[auth] could not delete session", err);
    }
  }
  (await cookies()).delete(SESSION_COOKIE);
  (await cookies()).delete(LEGACY_SESSION_COOKIE);
  redirect("/");
}

// Shared gate for both AI chats: length, per-minute and per-day limits.
async function aiGate(businessId: string, text: string): Promise<string | null> {
  const t = getDict(await getLang()).dashboard;
  if (text.length > LIMITS.aiMaxChars) return t.aiTooLong;
  if (!(await allow(`ai:min:${businessId}`, LIMITS.aiPerMinute.limit, LIMITS.aiPerMinute.window))) return t.aiSlowDown;
  if (!(await allow(`ai:day:${businessId}`, LIMITS.aiPerDay.limit, LIMITS.aiPerDay.window))) return t.aiDailyLimit;
  return null;
}

export type OnboardingAnswers = {
  name: string;
  categoryRaw: string;
  city: string;
  description: string;
};

export async function completeOnboardingAction(answers: OnboardingAnswers) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  const lang = await getLang();
  const category = matchCategory(answers.categoryRaw, lang);
  let baseSlug = slugify(answers.name) || "business";
  let slug = baseSlug;
  let n = 1;
  while (await isSlugTaken(slug)) {
    n += 1;
    slug = `${baseSlug}-${n}`;
  }

  const name = String(answers.name || "").trim().slice(0, 80) || "Mi negocio";
  const city = String(answers.city || "").trim().slice(0, 80);
  const description = String(answers.description || "").trim().slice(0, 1500);
  const categoryRaw = String(answers.categoryRaw || "").trim().slice(0, 60);
  // Show the owner's own words for the category when ours is just "Other".
  const shownCategory = /^(other|otro)$/i.test(category) && categoryRaw ? categoryRaw : category;

  const draft = await generateSiteDraft({ name, category: shownCategory, city, description, lang });
  const pitch =
    draft?.pitch ||
    generatePitch({ name, category: shownCategory, description, city, lang });

  const business = await createBusiness({
    userId: user!.id,
    slug,
    name,
    category: shownCategory,
    description,
    city,
    pitch,
    site: { ...EMPTY_SITE, lang, headline: draft?.headline ?? "", highlights: draft?.highlights ?? [], serviceArea: city },
  });

  if (draft) {
    for (let i = 0; i < draft.services.length; i++) {
      await addService(business.id, draft.services[i].name, undefined, draft.services[i].description || undefined, i);
    }
  } else {
    const services = suggestServices(category, lang);
    for (let i = 0; i < services.length; i++) {
      await addService(business.id, services[i].name, undefined, undefined, i);
    }
  }

  // Persist the onboarding conversation for continuity with the chat UI.
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_name", lang));
  await addChatMessage(business.id, "onboarding", "user", answers.name);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_category", lang));
  await addChatMessage(business.id, "onboarding", "user", answers.categoryRaw);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_city", lang));
  await addChatMessage(business.id, "onboarding", "user", answers.city);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_description", lang));
  await addChatMessage(business.id, "onboarding", "user", answers.description);
  await addChatMessage(business.id, "onboarding", "ai", pageLiveMessage(lang, business.slug));

  redirect("/dashboard");
}

export async function updateWhatsappAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const whatsapp = normalizePhone(String(formData.get("whatsapp") || "").trim()) ?? "";
  await updateBusinessWhatsapp(user.business.id, whatsapp);
  revalidatePath("/dashboard");
  revalidatePath(`/site/${user.business.slug}`);
}

export async function sendMarketingMessageAction(message: string) {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const business = user.business;
  const trimmed = message.trim();

  if (!trimmed) {
    return {
      messages: await listChatMessages(business.id, "marketing"),
      campaigns: await listCampaigns(business.id),
    };
  }

  const blocked = await aiGate(business.id, trimmed);
  if (blocked) {
    await addChatMessage(business.id, "marketing", "ai", blocked);
    return {
      messages: await listChatMessages(business.id, "marketing"),
      campaigns: await listCampaigns(business.id),
    };
  }

  await addChatMessage(business.id, "marketing", "user", trimmed);

  // Give the model the last few turns of this same conversation for context,
  // but not the message we just stored (that's passed separately below).
  const priorMessages = await listChatMessages(business.id, "marketing");
  const history = priorMessages
    .slice(0, -1)
    .slice(-10)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    }));

  const services = await listServices(business.id);
  const result = await runMarketingAgentTurn(business, services, history, trimmed, await getLang());

  await addChatMessage(business.id, "marketing", "ai", result.reply);

  revalidatePath("/dashboard");
  return {
    messages: await listChatMessages(business.id, "marketing"),
    campaigns: await listCampaigns(business.id),
  };
}

// ---------- Discovery path ("I want to offer one, but I'm not sure what") ----------

export type DiscoveryDetailAnswers = {
  businessName: string;
  pricing: string;
  travelContact: string;
  photos: string;
};

export async function completeDiscoveryAction(input: {
  discovery: DiscoveryAnswers;
  idea: Idea;
  details: DiscoveryDetailAnswers;
  whatsapp?: string;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  const { discovery, idea, details } = input;
  const lang = await getLang();
  const t = getDict(lang);

  let baseSlug = slugify(details.businessName) || "business";
  let slug = baseSlug;
  let n = 1;
  while (await isSlugTaken(slug)) {
    n += 1;
    slug = `${baseSlug}-${n}`;
  }

  const name = String(details.businessName || "").trim().slice(0, 80) || idea.title;
  const city = String(discovery.location || "").trim().slice(0, 80);
  const draft = await generateSiteDraft({
    name,
    category: idea.title,
    city,
    description: `${idea.title}. ${idea.desc} ${String(discovery.background || "").slice(0, 600)}`,
    lang,
  });
  const pitch =
    draft?.pitch ||
    generateDiscoveryPitch({ name, idea, location: city, pricing: details.pricing, lang });
  const wa = normalizePhone(input.whatsapp);

  const business = await createBusiness({
    userId: user.id,
    slug,
    name,
    category: idea.title,
    description: idea.desc,
    city,
    pitch,
    whatsapp: wa,
    site: { ...EMPTY_SITE, lang, headline: draft?.headline ?? "", highlights: draft?.highlights ?? [], serviceArea: city },
  });

  if (draft) {
    for (let i = 0; i < draft.services.length; i++) {
      await addService(business.id, draft.services[i].name, undefined, draft.services[i].description || undefined, i);
    }
  } else {
    await addService(business.id, idea.title, String(details.pricing || "").slice(0, 40) || undefined, idea.desc, 0);
  }

  // Persist the full two-part conversation for continuity with the chat UI.
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_location", lang));
  await addChatMessage(business.id, "onboarding", "user", discovery.location);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_background", lang));
  await addChatMessage(business.id, "onboarding", "user", discovery.background);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_license", lang));
  await addChatMessage(business.id, "onboarding", "user", discovery.license);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_capacity", lang));
  await addChatMessage(business.id, "onboarding", "user", discovery.capacity);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("done", lang));
  const prompts = t.discover.detailPrompts;
  await addChatMessage(business.id, "onboarding", "ai", `${t.discover.goodChoice(idea.title)} ${prompts[0]}`);
  await addChatMessage(business.id, "onboarding", "user", details.businessName);
  await addChatMessage(business.id, "onboarding", "ai", prompts[1]);
  await addChatMessage(business.id, "onboarding", "user", details.pricing);
  await addChatMessage(business.id, "onboarding", "ai", prompts[2]);
  await addChatMessage(business.id, "onboarding", "user", details.travelContact);
  await addChatMessage(business.id, "onboarding", "ai", prompts[3]);
  await addChatMessage(business.id, "onboarding", "user", details.photos);
  await addChatMessage(business.id, "onboarding", "ai", pageLiveMessage(lang, business.slug));

  redirect("/dashboard");
}

// ---------- AI page editor (Store tab chat) ----------

export async function sendPageEditCommand(message: string) {
  const user = await getCurrentUser();
  if (!user || !user.business) redirect("/login");
  const business = user.business;
  const trimmed = message.trim();

  if (!trimmed) {
    return {
      messages: await listChatMessages(business.id, "editor"),
      business,
      services: await listServices(business.id),
    };
  }

  const blocked = await aiGate(business.id, trimmed);
  if (blocked) {
    await addChatMessage(business.id, "editor", "ai", blocked);
    return {
      messages: await listChatMessages(business.id, "editor"),
      business,
      services: await listServices(business.id),
    };
  }

  await addChatMessage(business.id, "editor", "user", trimmed);

  // Give the model the last few turns of this same conversation for context,
  // but not the message we just stored (that's passed separately as the
  // current instruction).
  const priorMessages = await listChatMessages(business.id, "editor");
  const history = priorMessages
    .slice(0, -1)
    .slice(-10)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content.slice(0, LIMITS.aiMaxChars),
    }));

  const services = await listServices(business.id);
  const result = await runPageEditorTurn(business, services, history, trimmed, await getLang());

  await addChatMessage(business.id, "editor", "ai", result.reply);

  revalidatePath("/dashboard");
  revalidatePath(`/site/${business.slug}`);

  return {
    messages: await listChatMessages(business.id, "editor"),
    business: result.business,
    services: result.services,
  };
}

// ---------- Public page analytics (best-effort, no auth — called by visitors) ----------

export async function trackContactClickAction(businessId: string, channel: "call" | "text" | "whatsapp") {
  try {
    if (typeof businessId !== "string" || businessId.length > 64) return;
    if (channel !== "call" && channel !== "text" && channel !== "whatsapp") return;
    // Count at most 3 clicks per visitor (IP) per business and channel per hour.
    if (!(await allow(`click:${channel}:${await clientIp()}:${businessId}`, 3, 60 * 60))) return;
    await incrementContactClick(businessId, channel);
  } catch {
    // Never let a tracking failure affect the visitor's link.
  }
}

// Kept for pages still loaded in a visitor's browser from before the update.
export async function trackWhatsappClickAction(businessId: string) {
  return trackContactClickAction(businessId, "whatsapp");
}

// ---------- "Report this page" (public, no auth) ----------
const REPORT_REASONS = ["fraud", "fake", "impersonation", "illegal", "other"] as const;

export async function reportPageAction(
  slug: string,
  reason: string,
  details: string
): Promise<{ ok: boolean; error?: "rate" | "invalid" }> {
  if (!(REPORT_REASONS as readonly string[]).includes(reason)) return { ok: false, error: "invalid" };
  if (!(await allow(`report:${await clientIp()}`, 5, 60 * 60))) return { ok: false, error: "rate" };
  const business = await getBusinessBySlug(String(slug || "").slice(0, 120));
  if (!business) return { ok: false, error: "invalid" };
  await createPageReport(business.id, reason, String(details || "").trim().slice(0, 2000) || null);
  console.warn("[report] page reported", business.slug, reason);
  return { ok: true };
}
