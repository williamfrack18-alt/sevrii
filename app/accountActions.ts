"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { del } from "@vercel/blob";
import {
  consumePasswordReset,
  createPasswordReset,
  deleteSessionsForUser,
  deleteUserEverything,
  getUserByEmail,
  getUserById,
  setUserPassword,
} from "@/lib/db";
import { hashPassword, hashSessionToken, verifyPassword, SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth";
import { startSession } from "@/lib/startSession";
import { allow, clientIp } from "@/lib/guard";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";
import { emailReady, sendEmail, simpleEmail } from "@/lib/email";
import { siteUrl, cancelSubscriptionNow, listLiveSubscriptions } from "@/lib/billing";
import { getCurrentUser, PROJECT_COOKIE } from "@/lib/session";

const RESET_MINUTES = 60;

async function sendResetEmail(userId: string, email: string): Promise<boolean> {
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  const token = randomBytes(32).toString("base64url");
  await createPasswordReset(userId, hashSessionToken(token), RESET_MINUTES);
  const url = `${siteUrl()}/reset?token=${token}`;
  const { html, text } = simpleEmail({ title: a.emailTitle, intro: a.emailIntro, button: a.emailButton, url, outro: a.emailOutro });
  return sendEmail(email, a.emailSubject, html, text);
}

export type ForgotState = { sent?: boolean; error?: string } | null;

// Always answers the same way, so nobody can learn which emails have an account.
export async function forgotPasswordAction(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  const t = getDict(lang);
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 200);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: t.auth.errEmail };
  if (!emailReady()) return { error: a.forgotNotReady };
  const ipOk = await allow(`reset:ip:${await clientIp()}`, 10, 60 * 60);
  const emailOk = await allow(`reset:email:${email}`, 3, 60 * 60);
  if (!ipOk) return { error: t.auth.errTooMany };
  if (emailOk) {
    const user = await getUserByEmail(email);
    if (user) await sendResetEmail(user.id, user.email);
  }
  return { sent: true };
}

export type ResetState = { error?: string } | null;

export async function resetPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  const t = getDict(lang);
  const token = String(formData.get("token") || "").slice(0, 100);
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 8) return { error: t.auth.errPassword };
  if (password.length > 128) return { error: t.auth.errPasswordLong };
  if (password !== confirm) return { error: a.errMatch };
  if (!(await allow(`reset:use:${await clientIp()}`, 20, 60 * 60))) return { error: t.auth.errTooMany };
  const userId = await consumePasswordReset(hashSessionToken(token));
  if (!userId) return { error: a.resetInvalid };
  const { hash, salt } = hashPassword(password);
  await setUserPassword(userId, hash, salt);
  // Log out every other device: whoever had the old password is out.
  await deleteSessionsForUser(userId);
  await startSession(userId);
  redirect("/dashboard");
}

// From the account page: email a reset link to the logged-in user.
export async function sendMyResetLinkAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const a = ACCOUNT_TEXT[await getLang()];
  if (!emailReady()) return { ok: false, error: a.forgotNotReady };
  if (!(await allow(`reset:email:${user.email}`, 3, 60 * 60))) return { ok: false, error: getDict(await getLang()).auth.errTooMany };
  const ok = await sendResetEmail(user.id, user.email);
  return ok ? { ok: true } : { ok: false, error: a.errGeneric };
}

export type DeleteState = { error?: string } | null;

export async function deleteAccountAction(_prev: DeleteState, formData: FormData): Promise<DeleteState> {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  const confirmWord = String(formData.get("confirm") || "").trim().toUpperCase();
  if (confirmWord !== a.deleteWord && confirmWord !== "BORRAR" && confirmWord !== "DELETE") return { error: a.errConfirm };
  if (!(await allow(`delete:${current.id}`, 8, 60 * 60))) return { error: getDict(lang).auth.errTooMany };

  const user = await getUserById(current.id);
  if (!user) redirect("/login");
  // Accounts with a password must confirm it. Google-only accounts have none.
  if (user.passwordHash) {
    const password = String(formData.get("password") || "").slice(0, 128);
    if (!verifyPassword(password, user.passwordHash, user.salt)) return { error: a.errPassword };
  }

  // Stop billing first (every running subscription of this customer, not only
  // the one on file); if that fails, keep the account so we never charge a deleted user.
  if (user.stripeSubscriptionId || user.stripeCustomerId) {
    try {
      const ids = new Set<string>(user.stripeSubscriptionId ? [user.stripeSubscriptionId] : []);
      if (user.stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
        const live = await listLiveSubscriptions(user.stripeCustomerId).catch((err: Error) => {
          if (/No such customer/i.test(err?.message || "")) return []; // a customer from other keys
          throw err;
        });
        for (const s of live) ids.add(s.id);
      }
      for (const id of ids) await cancelSubscriptionNow(id);
    } catch (err) {
      console.error("[account] cancel failed", (err as Error)?.message);
      return { error: a.errBilling };
    }
  }

  let photos: string[] = [];
  try {
    photos = await deleteUserEverything(user.id);
  } catch (err) {
    console.error("[account] delete failed", (err as Error)?.message);
    return { error: a.errGeneric };
  }
  // Uploaded photos (Vercel Blob). Best effort: the account is already gone.
  const blobs = photos.filter((u) => /\.blob\.vercel-storage\.com\//.test(u));
  if (blobs.length && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(blobs);
    } catch (err) {
      console.error("[account] photo cleanup failed", (err as Error)?.message);
    }
  }

  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(LEGACY_SESSION_COOKIE);
  jar.delete(PROJECT_COOKIE);
  redirect("/goodbye");
}
