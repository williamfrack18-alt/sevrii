import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import DiscoveryFlow from "./DiscoveryFlow";

export default async function DiscoverPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.business) redirect("/dashboard");

  return (
    <div className="theme-dark">
      <DiscoveryFlow />
    </div>
  );
}
