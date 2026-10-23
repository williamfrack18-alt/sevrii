"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE } from "@/lib/i18n";
import { useLang, useT } from "./LangProvider";
import { setLangAction } from "@/app/langActions";

// Small ES / EN switch. Saves the choice in the same cookie + localStorage key
// the sevrii.com landing uses, and on the account when signed in.
export default function LangToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  const t = useT();
  const router = useRouter();
  const next = lang === "es" ? "en" : "es";

  return (
    <button
      type="button"
      aria-label={`${t.toggle.label}: ${t.toggle.otherName}`}
      title={t.toggle.otherName}
      className={`lang-toggle ${className}`}
      onClick={async () => {
        document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        try {
          localStorage.setItem(LANG_COOKIE, next);
        } catch {}
        // Signed in: the account keeps it (the dashboard follows the account).
        await setLangAction(next).catch(() => {});
        router.refresh();
      }}
    >
      {t.toggle.other}
    </button>
  );
}
