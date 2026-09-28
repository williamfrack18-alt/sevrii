import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import OnboardingChat from "./OnboardingChat";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center justify-center gap-8 p-8">
      <div className="text-center flex flex-col gap-2">
        <h1 className="font-serif text-3xl font-semibold">Let&rsquo;s build your page</h1>
        <p className="text-muted text-[15px]">A few quick questions and Sevri AI takes it from there.</p>
      </div>
      <OnboardingChat />
    </div>
  );
}
