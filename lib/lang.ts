import { cookies, headers } from "next/headers";
import { LANG_COOKIE, pickLang, type Lang } from "./i18n";

// Server-side: the language for the current request (cookie first, then the
// browser's Accept-Language). See lib/i18n.ts for the rules.
export function getLang(): Lang {
  return pickLang(cookies().get(LANG_COOKIE)?.value, headers().get("accept-language"));
}
