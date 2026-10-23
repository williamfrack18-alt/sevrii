"use server";

import { getCurrentUser } from "@/lib/session";
import { setUserLang } from "@/lib/db";

// The ES/EN switch inside the app: saves the owner's language on the account,
// so the dashboard, the chats and the marketing agent all use it.
export async function setLangAction(lang: string): Promise<void> {
  if (lang !== "es" && lang !== "en") return;
  const user = await getCurrentUser();
  if (!user) return;
  await setUserLang(user.id, lang);
}
