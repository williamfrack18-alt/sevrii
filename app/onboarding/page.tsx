import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import OnboardingChat from "./OnboardingChat";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isNew = Boolean(user.business) && (await searchParams)?.new === "1";
  if (user.business && !isNew) redirect("/dashboard");
  const t = getDict(await getLang());

  return (
    <div className="theme-dark relative bg-cream flex flex-col items-center justify-center gap-8 px-8 pt-24 pb-12">
      <div className="absolute top-0 left-0 right-0 h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </div>
      <div className="text-center flex flex-col gap-2">
        <h1 className="font-serif text-[40px] leading-[1.08]">{t.onboarding.title}</h1>
        <p className="text-muted text-[15px]">{t.onboarding.subtitle}</p>
      </div>
      <OnboardingChat newProject={isNew} />
    </div>
  );
}
