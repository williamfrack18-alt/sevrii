import { cookies } from "next/headers";
import { createSessionRow } from "./db";
import { newSessionToken, hashSessionToken, SESSION_COOKIE, LEGACY_SESSION_COOKIE, SESSION_MAX_AGE } from "./auth";

// Signs the person in on this browser: a new random session token in an
// HttpOnly cookie, and only its hash in the database.
export async function startSession(userId: string): Promise<void> {
  const token = newSessionToken();
  await createSessionRow(hashSessionToken(token), userId, SESSION_MAX_AGE);
  const jar = await cookies();
  jar.delete(LEGACY_SESSION_COOKIE);
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}
