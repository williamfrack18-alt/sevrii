import { NextResponse } from "next/server";
import { handleStripeEvent, verifyStripeSignature } from "@/lib/billing";

export const dynamic = "force-dynamic";

// Stripe tells us here when a subscription starts, changes or ends.
// Every request must carry a valid signature made with STRIPE_WEBHOOK_SECRET.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  try {
    await handleStripeEvent(JSON.parse(payload));
  } catch (err) {
    console.error("[billing] webhook failed", (err as Error)?.message);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
