import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { getLang } from "@/lib/lang";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";
import ForgotForm from "./ForgotForm";

export const metadata = { title: "Sevrii", robots: { index: false } };

export default async function ForgotPage() {
  const a = ACCOUNT_TEXT[await getLang()];
  return (
    <AuthShell title={a.forgotTitle} subtitle={a.forgotSubtitle}>
      <ForgotForm />
      <Link href="/login" className="text-[14px] text-muted underline underline-offset-4">
        {a.backToLogin}
      </Link>
    </AuthShell>
  );
}
