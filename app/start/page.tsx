import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import PathPicker from "./PathPicker";

export default async function StartPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center py-14 px-6">
      <div className="w-full max-w-[980px] flex items-center justify-between mb-14">
        <Link href="/signup" className="text-[14px] text-muted flex items-center gap-1.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to sign up
        </Link>
        <span className="font-serif text-xl font-semibold">Sevri</span>
      </div>

      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-[34px] h-[6px] rounded-full bg-ink" />
        <div className="w-[34px] h-[6px] rounded-full bg-ink" />
        <div className="w-[34px] h-[6px] rounded-full bg-borderStrong" />
        <div className="w-[34px] h-[6px] rounded-full bg-borderStrong" />
      </div>

      <div className="max-w-[700px] flex flex-col items-center gap-3 text-center mb-11">
        <h1 className="font-serif text-3xl font-semibold">How do you want to start?</h1>
        <p className="text-muted text-[15.5px] leading-relaxed max-w-md">
          Pick the option that best describes your situation. This helps us personalize the next
          AI-powered steps.
        </p>
      </div>

      <PathPicker />
    </div>
  );
}
