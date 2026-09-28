import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-insecure-secret";
const KEY_LEN = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, KEY_LEN);
  const stored = Buffer.from(hash, "hex");
  if (candidate.length !== stored.length) return false;
  return timingSafeEqual(candidate, stored);
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

export function createSessionToken(payload: { userId: string }): string {
  const body = base64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = base64url(createHmac("sha256", SESSION_SECRET).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): { userId: string } | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expectedSig = base64url(createHmac("sha256", SESSION_SECRET).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.userId) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "sevri_session";
