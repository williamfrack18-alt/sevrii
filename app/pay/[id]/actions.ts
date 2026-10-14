"use server";

import { redirect } from "next/navigation";
import { getBusinessById, getPaymentLink } from "@/lib/db";
import { allow, clientIp } from "@/lib/guard";
import { checkoutForLink, refreshPayStatus } from "@/lib/payments";

// A client tapped "Pay": open Stripe Checkout on the business's own account.
export async function payAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") || "").slice(0, 40);
  if (!/^[a-z0-9]{6,40}$/.test(id)) redirect("/");
  const back = `/pay/${id}`;
  if (!(await allow(`pay:${await clientIp()}`, 20, 10 * 60))) redirect(`${back}?error=rate`);

  const link = await getPaymentLink(id);
  const business = link ? await getBusinessById(link.businessId) : undefined;
  if (!link || !link.active || !business || !business.stripeAccountId) redirect(back);

  let url = "";
  try {
    // Make sure the account can still take payments right now.
    if ((await refreshPayStatus(business)) !== "ready") redirect(back);
    url = await checkoutForLink(business, link);
  } catch (err) {
    // redirect() throws on purpose; let it through.
    if ((err as { digest?: string })?.digest?.startsWith("NEXT_REDIRECT")) throw err;
    console.error("[pay] checkout failed", (err as Error)?.message);
    redirect(`${back}?error=1`);
  }
  redirect(url);
}
