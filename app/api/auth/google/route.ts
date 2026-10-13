import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { googleReady, newGoogleState, googleAuthUrl, GOOGLE_STATE_COOKIE, GOOGLE_STATE_MAX_AGE } from "@/lib/google";
import { allow, clientIp } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Step 1: send the person to Google's account picker.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from") === "signup" ? "signup" : "login";
  const back = new URL(`/${from}?error=google`, url.origin);
  if (!googleReady()) return NextResponse.redirect(back);
  if (!(await allow(`google:ip:${await clientIp()}`, 30, 15 * 60))) {
    return NextResponse.redirect(new URL(`/${from}?error=busy`, url.origin));
  }
  const s = newGoogleState(from);
  (await cookies()).set(GOOGLE_STATE_COOKIE, JSON.stringify(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: GOOGLE_STATE_MAX_AGE,
    path: "/api/auth/google",
  });
  return NextResponse.redirect(googleAuthUrl(s));
}
