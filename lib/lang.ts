import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLang, type Lang } from "./i18n";
import { SESSION_COOKIE, hashSessionToken } from "./auth";
import { getSessionLang } from "./db";

// Server-side: the language for the current request. A signed-in owner always
// gets the language saved on their account (set with the ES/EN switch inside
// the app), so browsing the English or Spanish landing never flips their
// dashboard. Everyone else: cookie first, then the browser's Accept-Language.
// See lib/i18n.ts for the rules.
export async function getLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  const token = c.get(SESSION_COOKIE)?.value;
  if (token && token.length <= 200) {
    try {
      const saved = await getSessionLang(hashSessionToken(token));
      if (saved === "es" || saved === "en") return saved;
    } catch {
      // Fall back to the cookie below.
    }
  }
  return pickLang(c.get(LANG_COOKIE)?.value, h.get("accept-language"));
}

// The language from the browser alone (cookie / Accept-Language), ignoring
// the account: used to save a first language for owners who have none yet.
export async function getBrowserLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()]);
  return pickLang(c.get(LANG_COOKIE)?.value, h.get("accept-language"));
}
