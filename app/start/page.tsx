import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { countProjects } from "@/lib/db";
import { limitsFor } from "@/lib/billing";
import PathPicker from "./PathPicker";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import { ACCENT } from "@/lib/brand";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isNew = Boolean(user.business) && (await searchParams)?.new === "1";
  if (user.business && !isNew) redirect("/dashboard");
  if (isNew && (await countProjects(user.id)) >= limitsFor(user).projects) redirect("/dashboard?view=plans&need=projects");
  const t = getDict(await getLang());

  return (
    <div className="theme-dark bg-cream flex flex-col items-center py-14 px-6">
      <div className="w-full max-w-[980px] flex items-center justify-between mb-14">
        <Link href={isNew ? "/dashboard?view=projects" : "/signup"} className="text-[14px] text-muted flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {isNew ? t.start.backToProjects : t.start.back}
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
        {isNew && (
          <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: ACCENT }}>
            {t.start.newProjectEyebrow}
          </span>
        )}
        <h1 className="font-serif text-[40px] leading-[1.08]">{isNew ? t.start.newProjectTitle : t.start.title}</h1>
        <p className="text-muted text-[15.5px] leading-relaxed max-w-md">{isNew ? t.start.newProjectSubtitle : t.start.subtitle}</p>
      </div>

      <PathPicker newProject={isNew} />
    </div>
  );
}
