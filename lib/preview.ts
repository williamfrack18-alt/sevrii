import { createHmac, timingSafeEqual } from "node:crypto";

// A draft page can be shown to people the owner chooses with a signed link
// (/site/<slug>?vista=<key>), before publishing. The key only opens that one
// page; it changes if the secret changes. Search engines never index it.
function secret(): string {
  return process.env.SEVRII_TOKEN_KEY || process.env.AUTH_SECRET || process.env.DATABASE_URL || "sevrii";
}

export function previewKey(businessId: string): string {
  return createHmac("sha256", secret()).update(`preview:${businessId}`).digest("hex").slice(0, 24);
}

export function previewOk(businessId: string, key: string | undefined | null): boolean {
  if (!key || typeof key !== "string" || key.length !== 24) return false;
  const want = Buffer.from(previewKey(businessId));
  const got = Buffer.from(key);
  return want.length === got.length && timingSafeEqual(want, got);
}
