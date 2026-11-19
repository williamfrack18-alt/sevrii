import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createCustomerSession, getCustomerBySession, upsertCustomer, type CustomerRow } from "./db";

// A customer's quick account (made when paying a business on Sevrii): just a
// name and an email, kept in its own cookie, apart from owners' sessions.
const COOKIE = "sevrii_cust";
const DAYS = 365;

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function currentCustomer(): Promise<CustomerRow | null> {
  try {
    const t = (await cookies()).get(COOKIE)?.value;
    if (!t || t.length > 200) return null;
    return await getCustomerBySession(hashToken(t));
  } catch {
    return null;
  }
}

export async function signInCustomer(email: string, name: string): Promise<CustomerRow> {
  const c = await upsertCustomer(email, name);
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + DAYS * 24 * 3600 * 1000);
  await createCustomerSession(c.id, hashToken(token), expires);
  (await cookies()).set(COOKIE, token, { path: "/", httpOnly: true, secure: true, sameSite: "lax", expires });
  return c;
}

export async function signOutCustomer(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// "Ana@Mail.com " → "ana@mail.com"; anything that isn't an email → "".
export function cleanEmail(raw: unknown): string {
  const e = String(raw ?? "").trim().toLowerCase().slice(0, 160);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : "";
}
