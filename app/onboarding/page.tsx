import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import OnboardingChat from "./OnboardingChat";
import BrandMark from "@/components/BrandMark";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  return (
    <div className="theme-dark relative bg-cream flex flex-col items-center justify-center gap-8 px-8 pt-24 pb-12">
      <div className="absolute top-0 left-0 h-[78px] px-6 sm:px-10 flex items-center">
        <BrandMark />
      </div>
      <div className="text-center flex flex-col gap-2">
        <h1 className="font-serif text-[40px] leading-[1.08]">Let&rsquo;s build your page</h1>
        <p className="text-muted text-[15px]">A few quick questions and Sevrii AI takes it from there.</p>
      </div>
      <OnboardingChat />
    </div>
  );
}
