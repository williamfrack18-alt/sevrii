import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { getLang } from "@/lib/lang";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";
import { isPasswordResetValid } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth";
import ResetForm from "./ResetForm";

export const metadata = { title: "Sevrii", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const a = ACCOUNT_TEXT[await getLang()];
  const token = String((await searchParams)?.token || "").slice(0, 100);
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token) && (await isPasswordResetValid(hashSessionToken(token)));

  if (!valid) {
    return (
      <AuthShell title={a.resetTitle}>
        <p className="text-[15px] leading-relaxed rounded-2xl border border-border p-4">{a.resetInvalid}</p>
        <Link href="/forgot" className="btn-primary w-full text-center">
          {a.askAgain}
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={a.resetTitle} subtitle={a.resetSubtitle}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
