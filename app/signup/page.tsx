import Link from "next/link";
import SignupForm from "./SignupForm";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { ACCENT } from "@/lib/brand";

export default async function SignupPage() {
  const t = getDict(await getLang());
  return (
    <div className="theme-dark flex">
      <div
        className="hidden md:flex w-[44%] p-14 flex-col justify-between"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 20% 80%, rgba(46,122,85,0.48), transparent 70%), linear-gradient(160deg,#0f4d34 0%,#0a3322 45%,#061c13 100%)",
        }}
      >
        <BrandMark />
        <div className="flex flex-col gap-6">
          <h1 className="font-serif text-[48px] leading-[1.06]">{t.auth.signupPanelTitle}</h1>
          <p className="text-[17px] leading-relaxed max-w-sm" style={{ color: "rgba(255,255,255,.75)" }}>
            {t.auth.signupPanelText}
          </p>
        </div>
        <div className="text-[13px]" style={{ color: "rgba(255,255,255,.55)" }}>
          © Sevrii 2026
        </div>
      </div>
      <div className="flex-1 flex flex-col">
        <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between md:justify-end">
          <div className="md:hidden">
            <BrandMark />
          </div>
          <LangToggle />
        </header>
        <main className="flex-1 flex items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[420px] flex flex-col gap-8">
            <div className="flex flex-col gap-3">
              <span className="text-[14px] font-medium" style={{ color: ACCENT }}>
                {t.auth.signupEyebrow}
              </span>
              <h2 className="font-serif text-[40px] leading-[1.08]">{t.auth.signupTitle}</h2>
              <p className="text-muted text-[16px]">{t.auth.signupSubtitle}</p>
            </div>
            <SignupForm />
            <p className="text-[14px] text-muted">
              {t.auth.haveAccount}{" "}
              <Link href="/login" className="text-ink font-semibold underline">
                {t.auth.loginLink}
              </Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
