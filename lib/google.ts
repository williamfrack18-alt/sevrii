import { createHash, randomBytes } from "crypto";

// "Continue with Google" (OAuth 2.0 / OpenID Connect, authorization code + PKCE).
// Turned on by setting GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.
// We only ask Google for the person's email (scope "openid email").

export const GOOGLE_STATE_COOKIE = "sevrii_g_state";
export const GOOGLE_STATE_MAX_AGE = 10 * 60; // 10 minutes to finish signing in

export function googleReady(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Built from the domain the person is on (sevrii.com or www.sevrii.com), so the
// return trip lands on the same domain as the state cookie. Both addresses must
// be listed as authorized redirect URIs in Google Cloud.
export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

// What we keep in a short-lived HttpOnly cookie between leaving and coming back.
export type GoogleState = { state: string; verifier: string; from: "login" | "signup" };

export function newGoogleState(from: "login" | "signup"): GoogleState {
  return { state: b64url(randomBytes(24)), verifier: b64url(randomBytes(32)), from };
}

export function googleAuthUrl(s: GoogleState, origin: string): string {
  const challenge = b64url(createHash("sha256").update(s.verifier).digest());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: googleRedirectUri(origin),
    response_type: "code",
    scope: "openid email",
    state: s.state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type GoogleIdentity = { sub: string; email: string };

// Trades the one-time code for the person's verified Google email.
// The ID token comes straight from Google over TLS in exchange for our client
// secret, so per OpenID Connect (Core 3.1.3.7) its claims can be read without
// re-checking the signature; we still check issuer, audience and expiry.
export async function exchangeGoogleCode(code: string, verifier: string, origin: string): Promise<GoogleIdentity | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      redirect_uri: googleRedirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[google] token exchange failed", res.status);
    return null;
  }
  const data = (await res.json()) as { id_token?: string };
  const parts = (data.id_token || "").split(".");
  if (parts.length !== 3) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const iss = String(claims.iss || "");
  const okIssuer = iss === "https://accounts.google.com" || iss === "accounts.google.com";
  const okAudience = claims.aud === process.env.GOOGLE_CLIENT_ID;
  const okTime = typeof claims.exp === "number" && claims.exp * 1000 > Date.now();
  const verified = claims.email_verified === true || claims.email_verified === "true";
  const email = String(claims.email || "").trim().toLowerCase();
  const sub = String(claims.sub || "");
  if (!okIssuer || !okAudience || !okTime || !verified || !email || !sub) {
    console.error("[google] id token rejected", { okIssuer, okAudience, okTime, verified });
    return null;
  }
  return { sub, email };
}
