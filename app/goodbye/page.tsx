import AuthShell from "@/components/AuthShell";
import { getLang } from "@/lib/lang";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";

export const metadata = { title: "Sevrii", robots: { index: false } };

export default async function GoodbyePage() {
  const lang = await getLang();
  const a = ACCOUNT_TEXT[lang];
  return (
    <AuthShell title={a.deletedTitle} subtitle={a.deletedText}>
      <a href={lang === "en" ? "/en" : "/"} className="btn-primary w-full text-center">
        {a.home}
      </a>
    </AuthShell>
  );
}
