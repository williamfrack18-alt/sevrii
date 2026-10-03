import { headers } from "next/headers";
import { hitRateCounter, resetRateCounter } from "./db";

// Best-effort client IP on Vercel. IPv6 addresses are grouped by /64, since
// one device or home usually owns a whole /64.
export async function clientIp(): Promise<string> {
  const h = await headers();
  const raw = (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "unknown").trim();
  if (raw.includes(":")) return raw.split(":").slice(0, 4).join(":") + "::/64";
  return raw;
}

// Returns true when the action may go ahead.
export async function allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    return (await hitRateCounter(key, windowSeconds)) <= limit;
  } catch (err) {
    // If the counter itself fails, don't lock everyone out.
    console.error("[rate-limit] counter failed", err);
    return true;
  }
}

export async function clear(key: string): Promise<void> {
  try {
    await resetRateCounter(key);
  } catch (err) {
    console.error("[rate-limit] reset failed", err);
  }
}

// Limits, in one place.
export const LIMITS = {
  // Login: per email (strict) and per IP (loose — many people in LatAm share
  // a carrier IP through CGNAT).
  loginPerEmail: { limit: 8, window: 15 * 60 },
  loginPerIp: { limit: 60, window: 15 * 60 },
  signupPerIp: { limit: 15, window: 60 * 60 },
  // AI: per business.
  aiPerMinute: { limit: 6, window: 60 },
  aiPerDay: { limit: 60, window: 24 * 60 * 60 },
  // Max characters in one chat message to the AI.
  aiMaxChars: 2000,
};
