"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { sendWelcomeEmail } from "@/lib/notify";
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
  deleteBusinessForUser,
  getBusinessByUserId,
  type BusinessRow,
} from "@/lib/db";
import { del } from "@vercel/blob";
import {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  hashSessionToken,
  SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
} from "@/lib/auth";
import { deleteSessionRow } from "@/lib/db";
import { startSession } from "@/lib/startSession";
import { allow, clear, clientIp, LIMITS } from "@/lib/guard";
import { EMPTY_PLAN } from "@/lib/plan";
import { limitsFor } from "@/lib/billing";
import { EMPTY_SITE, type SiteData } from "@/lib/site";
import { getCurrentUser, setActiveProject, PROJECT_COOKIE } from "@/lib/session";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";


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
  const lang = await getLang();
  after(() => sendWelcomeEmail(user.email, lang));
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
  // Only how to reach the same person. Hours, years, licenses, reviews, logo
  // and place belong to each service (a new one may be elsewhere or online).
  return {
    phone: s.phone,
    textEnabled: s.textEnabled,
  };
}

// Start a project from the two buttons on /start. The Brain does the rest:
// no fixed questions here any more.
export async function startProjectAction(mode: "existing" | "new" | "agent", newProject?: boolean) {
  const { userId, previous } = await checkNewProject(newProject);
  const lang = await getLang();
  const m = mode === "new" ? "new" : mode === "agent" ? "agent" : "existing";
  let slug = "";
  for (let i = 0; i < 5 && (!slug || (await isSlugTaken(slug))); i++) slug = `proyecto-${randomBytes(4).toString("hex")}`;
  const prev = previous?.plan.profile;
  const business = await createBusiness({
    userId,
    slug,
    name: lang === "es" ? "Proyecto nuevo" : "New project",
    category: "",
    description: "",
    city: null,
    pitch: "",
    whatsapp: previous?.whatsapp ?? null,
    site: { ...EMPTY_SITE, ...carriedSite(previous), lang },
    plan: {
      ...EMPTY_PLAN,
      mode: m,
      stage: "interview",
      // Same person: the languages they speak carry over. Where they work is
      // asked again (a new service may be in another city, or online).
      profile: {
        ...EMPTY_PLAN.profile,
        // An agent's languages are the ones it talks to customers in: asked again.
        languages: m === "agent" ? "" : prev?.languages ?? "",
        // An agent always works online, in the page chat.
        ...(m === "agent" ? { serviceMode: "remote" as const } : {}),
      },
    },
  });
  await setActiveProject(business.id);
  (await cookies()).delete("sevrii_path");
  redirect("/dashboard?view=plan");
}

// Each browser tab works on the project it shows. When a tab comes back to the
// front (another tab may have opened or switched to another project), its
// project becomes the active one again, so its chats never write into another
// project's thread.
export async function keepProjectAction(projectId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user || typeof projectId !== "string" || projectId.length > 64) return false;
  if (user.business?.id === projectId) return true;
  if (!(await getBusinessForUser(user.id, projectId))) return false;
  await setActiveProject(projectId);
  return true;
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

// Delete one project for good (its strategy, page, campaigns and payment links).
export async function deleteProjectAction(projectId: string): Promise<{ error?: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (typeof projectId !== "string" || projectId.length > 64) return { error: "invalid" };
  if (!(await allow(`project:delete:${user.id}`, 20, 60 * 60))) return { error: getDict(await getLang()).auth.errTooMany };
  const photos = await deleteBusinessForUser(user.id, projectId);
  if (photos === null) return { error: "invalid" };
  if (photos.length && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(photos);
    } catch (err) {
      console.error("[project] could not delete photos", (err as Error)?.message);
    }
  }
  const next = await getBusinessByUserId(user.id);
  if (next) await setActiveProject(next.id);
  else (await cookies()).delete(PROJECT_COOKIE);
  revalidatePath("/dashboard");
  redirect(next ? "/dashboard?view=projects" : "/start");
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
