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
  incrementWhatsappClicks,
} from "@/lib/db";
import { hashPassword, verifyPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
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

const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function setSessionCookie(userId: string) {
  const token = createSessionToken({ userId });
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export type FormState = { error?: string } | null;

function pageLiveMessage(lang: "es" | "en", slug: string) {
  return lang === "es"
    ? `Listo, ya estoy armando tu página. Tu página está publicada en /site/${slug}.`
    : `Got it — building your page now. Your page is live at /site/${slug}.`;
}

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const t = getDict(getLang());

  if (!email || !password) {
    return { error: t.auth.errFill };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: t.auth.errEmail };
  }
  if (password.length < 8) {
    return { error: t.auth.errPassword };
  }
  if (await getUserByEmail(email)) {
    return { error: t.auth.errExists };
  }

  const { hash, salt } = hashPassword(password);
  const user = await createUser(email, hash, salt);
  setSessionCookie(user.id);
  redirect("/start");
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
    return { error: getDict(getLang()).auth.errWrong };
  }
  setSessionCookie(user.id);
  redirect("/dashboard");
}

export async function logoutAction() {
  cookies().delete(SESSION_COOKIE);
  redirect("/");
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

  const lang = getLang();
  const category = matchCategory(answers.categoryRaw, lang);
  let baseSlug = slugify(answers.name) || "business";
  let slug = baseSlug;
  let n = 1;
  while (await isSlugTaken(slug)) {
    n += 1;
    slug = `${baseSlug}-${n}`;
  }

  const pitch = generatePitch({
    name: answers.name,
    category,
    description: answers.description,
    city: answers.city,
    lang,
  });

  const business = await createBusiness({
    userId: user!.id,
    slug,
    name: answers.name,
    category,
    description: answers.description,
    city: answers.city,
    pitch,
  });

  const services = suggestServices(category, lang);
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    await addService(business.id, s.name, s.price, undefined, i);
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
  const whatsapp = String(formData.get("whatsapp") || "").trim();
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

  await addChatMessage(business.id, "marketing", "user", trimmed);

  // Give the model the last few turns of this same conversation for context,
  // but not the message we just stored (that's passed separately below).
  const priorMessages = await listChatMessages(business.id, "marketing");
  const history = priorMessages
    .slice(0, -1)
    .slice(-10)
    .map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.content,
    }));

  const services = await listServices(business.id);
  const result = await runMarketingAgentTurn(business, services, history, trimmed, getLang());

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
  const lang = getLang();
  const t = getDict(lang);

  let baseSlug = slugify(details.businessName) || "business";
  let slug = baseSlug;
  let n = 1;
  while (await isSlugTaken(slug)) {
    n += 1;
    slug = `${baseSlug}-${n}`;
  }

  const pitch = generateDiscoveryPitch({
    name: details.businessName,
    idea,
    location: discovery.location,
    pricing: details.pricing,
    lang,
  });

  const business = await createBusiness({
    userId: user.id,
    slug,
    name: details.businessName,
    category: idea.title,
    description: idea.desc,
    city: discovery.location,
    pitch,
    whatsapp: input.whatsapp?.trim() || null,
  });

  await addService(business.id, idea.title, details.pricing.slice(0, 120), idea.desc, 0);

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
      content: m.content,
    }));

  const services = await listServices(business.id);
  const result = await runPageEditorTurn(business, services, history, trimmed, getLang());

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

export async function trackWhatsappClickAction(businessId: string) {
  try {
    await incrementWhatsappClicks(businessId);
  } catch {
    // Never let a tracking failure affect the visitor's WhatsApp link.
  }
}
