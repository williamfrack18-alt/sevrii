"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE } from "@/lib/i18n";
import { useLang } from "./LangProvider";
import { setLangAction } from "@/app/langActions";

// Small ES / EN switch. Saves the choice in the same cookie + localStorage key
// the sevrii.com landing uses, and on the account when signed in.
export default function LangToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const next = lang === "es" ? "en" : "es";

  return (
    <button
      type="button"
      // Both languages show; the active one is filled, so the pill never reads
      // as "the current language is the other one".
      aria-label={lang === "es" ? `Idioma: Español (activo). Cambiar a English` : `Language: English (active). Switch to Español`}
      title={lang === "es" ? "Idioma actual: Español · cambiar a English" : "Current language: English · switch to Español"}
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
      <span className={`lt-opt ${lang === "es" ? "on" : ""}`} aria-hidden="true">ES</span>
      <span className={`lt-opt ${lang === "en" ? "on" : ""}`} aria-hidden="true">EN</span>
    </button>
  );
}
