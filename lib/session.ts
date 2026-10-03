import { cookies } from "next/headers";
import { getUserById, getBusinessByUserId, getSessionUserId } from "./db";
import { SESSION_COOKIE, hashSessionToken } from "./auth";

export async function getCurrentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const userId = await getSessionUserId(hashSessionToken(token));
  if (!userId) return null;
  const user = await getUserById(userId);
  if (!user) return null;
  const business = (await getBusinessByUserId(user.id)) ?? null;
  return { ...user, business };
}
