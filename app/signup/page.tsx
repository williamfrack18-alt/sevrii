import Link from "next/link";
import SignupForm from "./SignupForm";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { ACCENT } from "@/lib/brand";
import GoogleButton, { OrDivider } from "@/components/GoogleButton";
import RotatingHeadline from "@/components/RotatingHeadline";
import { googleReady } from "@/lib/google";
import { cookies } from "next/headers";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = getDict(await getLang());
  const sp = (await searchParams) ?? {};
  const err = sp.error === "google_cancel" ? t.auth.errGoogleCancel : sp.error ? t.auth.errGoogle : null;
  const google = googleReady();
  // Came from a button that already chose a path ("Crear mi agente"): say where they'll land.
  const path = (await cookies()).get("sevrii_path")?.value ?? "";
  const subtitle = t.auth.signupSubtitleFor[path] ?? t.auth.signupSubtitle;
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
        <RotatingHeadline items={t.auth.signupSlides} />
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
              <p className="text-muted text-[16px]">{subtitle}</p>
            </div>
            {err && <p className="text-[13px] text-red-600">{err}</p>}
            {google && (
              <div className="flex flex-col gap-5">
                <GoogleButton from="signup" label={t.auth.google} />
                <OrDivider label={t.auth.or} />
              </div>
            )}
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
