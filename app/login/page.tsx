import Link from "next/link";
import LoginForm from "./LoginForm";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";

export default function LoginPage() {
  const t = getDict(getLang());
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
          <LoginForm />
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
