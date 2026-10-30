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
import { logoutAction } from "@/app/actions";
import { cookies } from "next/headers";
import { isStartPath } from "@/lib/startPath";

export default async function StartPage({ searchParams }: { searchParams: Promise<{ new?: string; path?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = (await searchParams) ?? {};
  // Came from "Quiero ser afiliado" and has no business: straight to the affiliate panel.
  if (!user.business && (await cookies()).get("sevrii_path")?.value === "affiliate") redirect("/panel-afiliado");
  const isNew = Boolean(user.business) && sp.new === "1";
  // Came from a button that already says what they want ("Crear mi agente",
  // "Crear mi tienda"): that path starts picked (they can still change it).
  const remembered = sp.path || (await cookies()).get("sevrii_path")?.value;
  const initial = isStartPath(remembered) ? remembered : null;
  if (user.business && !isNew) redirect("/dashboard");
  if (isNew && (await countProjects(user.id)) >= limitsFor(user).projects) redirect("/dashboard?view=plans&need=projects");
  const lang = await getLang();
  const t = getDict(lang);
  // Where they are in the whole road, said in words (not only bars).
  const STEPS = lang === "es" ? ["Tu cuenta", "Qué vas a crear", "El Cerebro te entrevista", "Tu página y tus anuncios"] : ["Your account", "What you'll create", "The Brain interviews you", "Your page and your ads"];

  return (
    <div className="theme-dark bg-cream flex flex-col items-center py-14 px-6">
      <div className="w-full max-w-[980px] flex items-center justify-between mb-14">
        {isNew ? (
          <Link href="/dashboard?view=projects" className="text-[14px] text-muted flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            {t.start.backToProjects}
          </Link>
        ) : (
          // Signed in with no project yet: there's nothing to go back to.
          <form action={logoutAction}>
            <button type="submit" className="text-[14px] text-muted hover:text-ink">
              {t.start.back}
            </button>
          </form>
        )}
        <div className="flex items-center gap-4">
          <LangToggle />
          <BrandMark />
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 mb-10">
        <div className="flex items-center gap-2.5" aria-hidden="true">
          {STEPS.map((_, i) => (
            <div key={i} className={`w-[34px] h-[6px] rounded-full ${i <= 1 ? "bg-ink" : "bg-borderStrong"}`} />
          ))}
        </div>
        <p className="text-[13px] text-muted text-center">
          <span className="text-ink font-medium">{lang === "es" ? "Paso 2 de 4" : "Step 2 of 4"}</span> · {STEPS[1]}
          <span className="block text-mutedLight mt-0.5">{lang === "es" ? `Después: ${STEPS[2]} → ${STEPS[3]}` : `Next: ${STEPS[2]} → ${STEPS[3]}`}</span>
        </p>
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

      <PathPicker newProject={isNew} initial={initial} />
      <Link href="/panel-afiliado" className="mt-8 text-[13.5px] text-muted hover:text-ink underline underline-offset-4">
        {t.start.affiliateLink}
      </Link>
    </div>
  );
}
