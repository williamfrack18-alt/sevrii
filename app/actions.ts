"use server";

import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createUser,
  getUserByEmail,
  createBusiness,
  isSlugTaken,
  incrementContactClick,
  getBusinessBySlug,
  createPageReport,
  countProjects,
  getBusinessForUser,
  type BusinessRow,
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
import { EMPTY_PLAN } from "@/lib/plan";
import { limitsFor } from "@/lib/billing";
import { EMPTY_SITE, type SiteData } from "@/lib/site";
import { getCurrentUser, setActiveProject, PROJECT_COOKIE } from "@/lib/session";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";

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
  (await cookies()).delete(PROJECT_COOKIE);
  redirect("/");
}

// ---------- Projects ----------
// One account can run several projects (one per service it sells). Each new
// project goes through the same start flow as the first one.
const MAX_PROJECTS = 10;

type NewProjectCheck = { userId: string; previous: BusinessRow | null };

async function checkNewProject(newProject: boolean | undefined): Promise<NewProjectCheck> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business && !newProject) redirect("/dashboard");
  // Each plan allows a number of projects (Free and Starter: 1, Pro: 3, Team: 10). Counted every time.
  const allowed = Math.min(MAX_PROJECTS, limitsFor(user).projects);
  if ((await countProjects(user.id)) >= allowed) redirect("/dashboard?view=plans&need=projects");
  if (user.business && !(await allow(`project:new:${user.id}`, 8, 24 * 60 * 60))) redirect("/dashboard?view=projects");
  return { userId: user.id, previous: user.business };
}

// Contact and trust details are the same business across projects: reuse them
// so the owner doesn't type them again.
function carriedSite(prev: BusinessRow | null): Partial<SiteData> {
  if (!prev) return {};
  const s = prev.site;
  return {
    phone: s.phone,
    textEnabled: s.textEnabled,
    hours: s.hours,
    // License numbers are per trade: never carried to another service.
    spanish: s.spanish,
    yearsInBusiness: s.yearsInBusiness,
    googleReviewsUrl: s.googleReviewsUrl,
    logoUrl: s.logoUrl,
  };
}

// Start a project from the two buttons on /start. The Brain does the rest:
// no fixed questions here any more.
export async function startProjectAction(mode: "existing" | "new", newProject?: boolean) {
  const { userId, previous } = await checkNewProject(newProject);
  const lang = await getLang();
  const m = mode === "new" ? "new" : "existing";
  let slug = "";
  for (let i = 0; i < 5 && (!slug || (await isSlugTaken(slug))); i++) slug = `proyecto-${randomBytes(4).toString("hex")}`;
  const prev = previous?.plan.profile;
  const business = await createBusiness({
    userId,
    slug,
    name: lang === "es" ? "Proyecto nuevo" : "New project",
    category: "",
    description: "",
    city: prev?.city || null,
    pitch: "",
    whatsapp: previous?.whatsapp ?? null,
    site: { ...EMPTY_SITE, ...carriedSite(previous), lang },
    plan: {
      ...EMPTY_PLAN,
      mode: m,
      stage: "interview",
      // Same person: where they work and the languages they speak carry over.
      profile: { ...EMPTY_PLAN.profile, city: prev?.city ?? "", state: prev?.state ?? "", languages: prev?.languages ?? "" },
    },
  });
  await setActiveProject(business.id);
  redirect("/dashboard?view=plan");
}

export async function switchProjectAction(projectId: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (typeof projectId === "string" && projectId.length <= 64 && (await getBusinessForUser(user.id, projectId))) {
    await setActiveProject(projectId);
  }
  revalidatePath("/dashboard");
  redirect("/dashboard?view=plan");
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
