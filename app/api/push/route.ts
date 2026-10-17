import { NextResponse } from "next/server";
import { deletePushSubAction, savePushSubAction } from "@/app/chatActions";

// Called by the service worker when the browser renews a push subscription
// (the owner's session cookie identifies them).
export async function POST(req: Request) {
  let body: { old?: string; sub?: { endpoint: string; keys: { p256dh: string; auth: string } } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.sub) return NextResponse.json({ ok: false }, { status: 400 });
  const ok = await savePushSubAction(body.sub, "renewed");
  if (ok && body.old && body.old !== body.sub.endpoint) await deletePushSubAction(body.old);
  return NextResponse.json({ ok });
}
