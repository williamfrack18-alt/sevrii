import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import PathPicker from "./PathPicker";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";

export default async function StartPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");
  const t = getDict(await getLang());

  return (
    <div className="theme-dark bg-cream flex flex-col items-center py-14 px-6">
      <div className="w-full max-w-[980px] flex items-center justify-between mb-14">
        <Link href="/signup" className="text-[14px] text-muted flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t.start.back}
        </Link>
        <div className="flex items-center gap-4">
          <LangToggle />
          <BrandMark />
        </div>
      </div>

      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-[34px] h-[6px] rounded-full bg-ink" />
        <div className="w-[34px] h-[6px] rounded-full bg-ink" />
        <div className="w-[34px] h-[6px] rounded-full bg-borderStrong" />
        <div className="w-[34px] h-[6px] rounded-full bg-borderStrong" />
      </div>

      <div className="max-w-[700px] flex flex-col items-center gap-3 text-center mb-11">
        <h1 className="font-serif text-[40px] leading-[1.08]">{t.start.title}</h1>
        <p className="text-muted text-[15.5px] leading-relaxed max-w-md">{t.start.subtitle}</p>
      </div>

      <PathPicker />
    </div>
  );
}
