import Link from "next/link";
import { redirect } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { getCurrentUser } from "@/lib/session";
import { getUserById } from "@/lib/db";
import { getLang } from "@/lib/lang";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { effectivePlan } from "@/lib/billing";
import { AccountActions } from "./AccountActions";

export const metadata = { title: "Sevrii", robots: { index: false } };

export default async function AccountPage() {
  const current = await getCurrentUser();
  if (!current) redirect("/login");
  const user = (await getUserById(current.id)) ?? current;
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  const planName = PLANS_TEXT[lang].plans[effectivePlan(user)].name;

  return (
    <div className="theme-dark min-h-dvh">
      <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </header>
      <main className="px-6 pb-24">
        <div className="mx-auto w-full max-w-[560px]">
          <Link href="/dashboard" className="text-[13.5px] text-muted hover:text-ink">
            ← {a.back}
          </Link>
          <h1 className="font-serif text-[38px] leading-[1.08] mt-6 mb-8">{a.accountTitle}</h1>

          <div className="card p-5 mb-6">
            <div className="flex items-center justify-between gap-4 py-2">
              <span className="text-[13.5px] text-muted">{a.accountEmail}</span>
              <span className="text-[15px] truncate">{user.email}</span>
            </div>
            <div className="flex items-center justify-between gap-4 py-2 border-t border-border">
              <span className="text-[13.5px] text-muted">{a.accountPlan}</span>
              <span className="flex items-center gap-3">
                <span className="text-[15px]">{planName}</span>
                <Link href="/dashboard?view=plans" className="text-[13px] underline underline-offset-4 text-muted hover:text-ink">
                  {a.seePlans}
                </Link>
              </span>
            </div>
          </div>

          <AccountActions hasPassword={Boolean(user.passwordHash)} />
        </div>
      </main>
    </div>
  );
}
