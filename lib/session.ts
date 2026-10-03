import { cookies } from "next/headers";
import { getUserById, getBusinessByUserId, getBusinessForUser, getSessionUserId } from "./db";
import { SESSION_COOKIE, hashSessionToken } from "./auth";

// The project (business) the owner is working on. Each account can have
// several; the choice lives in this cookie and is always checked against the
// account, so it can't point at someone else's project.
export const PROJECT_COOKIE = "sevrii_project";

export async function getCurrentUser() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const userId = await getSessionUserId(hashSessionToken(token));
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  const chosen = jar.get(PROJECT_COOKIE)?.value;
  const business =
    (chosen && chosen.length <= 64 ? await getBusinessForUser(user.id, chosen) : undefined) ??
    (await getBusinessByUserId(user.id)) ??
    null;
  return { ...user, business };
}

export async function setActiveProject(businessId: string) {
  (await cookies()).set(PROJECT_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
