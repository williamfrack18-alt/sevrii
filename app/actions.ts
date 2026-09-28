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
  createCampaign,
  listChatMessages,
} from "@/lib/db";
import { hashPassword, verifyPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { getCurrentUser } from "@/lib/session";
import {
  generatePitch,
  matchCategory,
  slugify,
  suggestServices,
  nextOnboardingPrompt,
  draftCampaign,
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

export async function signupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Please fill in every field." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email doesn't look right." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (await getUserByEmail(email)) {
    return { error: "An account with that email already exists." };
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
    return { error: "Incorrect email or password." };
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

  const category = matchCategory(answers.categoryRaw);
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

  const services = suggestServices(category);
  for (let i = 0; i < services.length; i++) {
    const s = services[i];
    await addService(business.id, s.name, s.price, undefined, i);
  }

  // Persist the onboarding conversation for continuity with the chat UI.
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_name"));
  await addChatMessage(business.id, "onboarding", "user", answers.name);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_category"));
  await addChatMessage(business.id, "onboarding", "user", answers.categoryRaw);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_city"));
  await addChatMessage(business.id, "onboarding", "user", answers.city);
  await addChatMessage(business.id, "onboarding", "ai", nextOnboardingPrompt("ask_description"));
  await addChatMessage(business.id, "onboarding", "user", answers.description);
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    `Got it — building your page now. Your page is live at /site/${business.slug}.`
  );

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
  if (!trimmed) return listChatMessages(business.id, "marketing");

  await addChatMessage(business.id, "marketing", "user", trimmed);

  const draft = draftCampaign({
    businessName: business.name,
    category: business.category,
    goal: trimmed,
  });
  await createCampaign({
    businessId: business.id,
    title: draft.title,
    goal: draft.goal,
    adCopy: draft.adCopyDraft,
    budgetNote: draft.suggestedBudget,
  });

  const aiReply = `Here's a draft campaign for "${trimmed}":\n\n"${draft.adCopyDraft}"\n\nSuggested budget: ${draft.suggestedBudget}. This is a draft — connect your Meta Ads account from Settings to actually launch it. I saved it under your campaigns.`;
  await addChatMessage(business.id, "marketing", "ai", aiReply);

  revalidatePath("/dashboard");
  return listChatMessages(business.id, "marketing");
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
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_location"));
  await addChatMessage(business.id, "onboarding", "user", discovery.location);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_background"));
  await addChatMessage(business.id, "onboarding", "user", discovery.background);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_license"));
  await addChatMessage(business.id, "onboarding", "user", discovery.license);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("ask_capacity"));
  await addChatMessage(business.id, "onboarding", "user", discovery.capacity);
  await addChatMessage(business.id, "onboarding", "ai", nextDiscoveryPrompt("done"));
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    `Good choice — ${idea.title.toLowerCase()} fits what you told me. Let's build your page. First, what would you like to call your business?`
  );
  await addChatMessage(business.id, "onboarding", "user", details.businessName);
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    "Do you want to charge by project or by the hour, and what kind of price range should people expect?"
  );
  await addChatMessage(business.id, "onboarding", "user", details.pricing);
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    "How far are you willing to travel for jobs, and how should people reach you?"
  );
  await addChatMessage(business.id, "onboarding", "user", details.travelContact);
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    "Do you have photos of past work, or should we start with placeholder examples?"
  );
  await addChatMessage(business.id, "onboarding", "user", details.photos);
  await addChatMessage(
    business.id,
    "onboarding",
    "ai",
    `Got it — building your page now. Your page is live at /site/${business.slug}.`
  );

  redirect("/dashboard");
}
