import { NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/billing";
import { getBusinessByStripeAccount } from "@/lib/db";
import { notifyPaymentReceived } from "@/lib/notify";
import { refreshPayStatus } from "@/lib/payments";

export const dynamic = "force-dynamic";

// Stripe tells us here about events on the businesses' own (connected) Stripe
// accounts: a client paid with a Sevrii link → email the owner; the account
// changed (account.updated) → refresh the business's payment status.
// Every request must carry a valid signature made with STRIPE_CONNECT_WEBHOOK_SECRET.
type ConnectEvent = {
  type?: string;
  account?: string;
  data?: { object?: { id?: string; object?: string; payment_status?: string; metadata?: Record<string, string> } };
};

export async function POST(req: Request) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  try {
    const event = JSON.parse(payload) as ConnectEvent;
    const s = event.data?.object;
    const paidEvent = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
    if (paidEvent && event.account && s?.id && s.metadata?.sevriiBusinessId) {
      const business = await getBusinessByStripeAccount(event.account);
      if (business && business.id === s.metadata.sevriiBusinessId) {
        // Not sent: answer 500 so Stripe retries (the notice claim prevents duplicates).
        if (!(await notifyPaymentReceived(business, s.id))) {
          return NextResponse.json({ error: "notice failed" }, { status: 500 });
        }
      }
    } else if (event.type === "account.updated") {
      // The status is always read again from Stripe, never taken from the event.
      const accountId = event.account || (s?.object === "account" ? s.id : undefined);
      const business = accountId ? await getBusinessByStripeAccount(accountId) : undefined;
      if (business) await refreshPayStatus(business);
    }
  } catch (err) {
    console.error("[connect] webhook failed", (err as Error)?.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
