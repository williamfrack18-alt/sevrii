import { randomBytes, scryptSync, timingSafeEqual, createHash } from "crypto";

const KEY_LEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string | null, salt: string | null): boolean {
  if (!hash || !salt) {
    // Still spend the same work so a missing hash isn't distinguishable by timing.
    scryptSync(password, "0".repeat(32), KEY_LEN);
    return false;
  }
  const candidate = scryptSync(password, salt, KEY_LEN);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

// Same cost as a real check, for logins with an unknown email — so response
// time doesn't reveal which emails have an account.
export function burnPasswordCheck(password: string): void {
  scryptSync(password, "0".repeat(32), KEY_LEN);
}

// Sessions are random opaque tokens. The cookie holds the token; the
// database stores only its SHA-256 (see lib/db.ts sessions), so a database
// leak doesn't hand out live sessions and no signing secret is involved.
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// New cookie name: sessions signed with the old HMAC scheme are retired, so
// everyone logs in once after this change.
export const SESSION_COOKIE = "sevrii_sid";
export const LEGACY_SESSION_COOKIE = "sevri_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
