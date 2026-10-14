import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { getLang } from "@/lib/lang";
import { sendWelcomeEmail } from "@/lib/notify";
import { exchangeGoogleCode, googleReady, GOOGLE_STATE_COOKIE, type GoogleState } from "@/lib/google";
import { createUser, getUserByEmail, getUserByGoogleSub, setUserGoogleSub } from "@/lib/db";
import { startSession } from "@/lib/startSession";

export const dynamic = "force-dynamic";

// Step 2: Google sends the person back here with a one-time code.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(GOOGLE_STATE_COOKIE)?.value;
  jar.delete({ name: GOOGLE_STATE_COOKIE, path: "/api/auth/google" });

  let saved: GoogleState | null = null;
  try {
    saved = raw ? (JSON.parse(raw) as GoogleState) : null;
  } catch {
    saved = null;
  }
  const from = saved?.from === "signup" ? "signup" : "login";
  const fail = (why = "google") => NextResponse.redirect(new URL(`/${from}?error=${why}`, url.origin));

  // The person closed the Google window or said no.
  if (url.searchParams.get("error")) return fail("google_cancel");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!googleReady() || !saved || !code || !state || state !== saved.state || code.length > 2048) return fail();

  const who = await exchangeGoogleCode(code, saved.verifier, url.origin);
  if (!who) return fail();

  try {
    let user = await getUserByGoogleSub(who.sub);
    let isNew = false;
    if (!user) {
      user = await getUserByEmail(who.email);
      if (!user) {
        // No password: this account signs in with Google (password login stays closed).
        user = await createUser(who.email, "", "");
        isNew = true;
      }
      await setUserGoogleSub(user.id, who.sub);
    }
    await startSession(user.id);
    if (isNew) {
      const email = user.email;
      const lang = await getLang();
      after(() => sendWelcomeEmail(email, lang));
    }
    return NextResponse.redirect(new URL(isNew ? "/start" : "/dashboard", url.origin));
  } catch (err) {
    console.error("[google] sign-in failed", (err as Error)?.message);
    return fail();
  }
}
