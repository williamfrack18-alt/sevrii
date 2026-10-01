import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import DiscoveryFlow from "./DiscoveryFlow";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";

export default async function DiscoverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  return (
    <div className="theme-dark">
      <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </header>
      <DiscoveryFlow />
    </div>
  );
}
