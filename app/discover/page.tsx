import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import DiscoveryFlow from "./DiscoveryFlow";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const isNew = Boolean(user.business) && (await searchParams)?.new === "1";
  if (user.business && !isNew) redirect("/dashboard");

  return (
    <div className="theme-dark">
      <header className="h-[78px] px-6 sm:px-10 flex items-center justify-between">
        <BrandMark />
        <LangToggle />
      </header>
      <DiscoveryFlow newProject={isNew} />
    </div>
  );
}
