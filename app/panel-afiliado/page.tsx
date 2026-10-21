import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import AffiliatesView from "@/app/dashboard/AffiliatesView";
import { toClientBusiness } from "@/app/dashboard/types";

// The affiliate panel for people without a project of their own (and a
// shortcut for everyone else). Owners also find it in the dashboard.
export default async function AffiliatePanelPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const es = (await getLang()) === "es";
  return (
    <div className="theme-dark min-h-screen" style={{ background: "#000" }}>
      <div className="max-w-[1080px] mx-auto px-4 md:px-10 pt-6 flex items-center justify-between gap-4">
        <BrandMark />
        <div className="flex items-center gap-4">
          <LangToggle />
          <Link href={user.business ? "/dashboard" : "/start"} className="text-[13.5px] text-[#a1a1a1] hover:text-white">
            {user.business ? (es ? "Ir a mi panel" : "Go to my dashboard") : es ? "Crear mi negocio" : "Create my business"} →
          </Link>
        </div>
      </div>
      <AffiliatesView business={user.business ? toClientBusiness(user.business) : null} />
    </div>
  );
}
