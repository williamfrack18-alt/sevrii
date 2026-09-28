import { cookies } from "next/headers";
import { getUserById, getBusinessByUserId } from "./db";
import { SESSION_COOKIE, verifySessionToken } from "./auth";

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user) return null;
  const business = (await getBusinessByUserId(user.id)) ?? null;
  return { ...user, business };
}
