import Link from "next/link";
import LoginForm from "./LoginForm";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import GoogleButton, { OrDivider } from "@/components/GoogleButton";
import { googleReady } from "@/lib/google";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const lang = await getLang();
  const t = getDict(lang);
  const sp = (await searchParams) ?? {};
  const err = sp.error === "google_cancel" ? t.auth.errGoogleCancel : sp.error === "busy" ? t.auth.errTooMany : sp.error ? t.auth.errGoogle : null;
  const google = googleReady();
  return (
    <div className="theme-dark flex flex-col">
      <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </header>
      <main className="flex-1 flex items-center justify-center px-6 pb-20">
        <div className="w-full max-w-[420px] flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-serif text-[40px] leading-[1.08]">{t.auth.loginTitle}</h1>
            <p className="text-muted text-[16px]">{t.auth.loginSubtitle}</p>
          </div>
          {err && <p className="text-[13px] text-red-600">{err}</p>}
          {google && (
            <div className="flex flex-col gap-5">
              <GoogleButton from="login" label={t.auth.google} />
              <OrDivider label={t.auth.or} />
            </div>
          )}
          <LoginForm />
          <Link href="/forgot" className="text-[13.5px] text-muted underline underline-offset-4 -mt-4">
            {ACCOUNT_TEXT[lang].forgotLink}
          </Link>
          <p className="text-[14px] text-muted">
            {t.auth.newHere}{" "}
            <Link href="/signup" className="text-ink font-semibold underline">
              {t.auth.createAccountLink}
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
