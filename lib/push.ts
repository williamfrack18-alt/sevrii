// Push notifications to the owner's phone or computer (Web Push, free).
// The VAPID key pair is derived from a server secret, so there is nothing to
// set up; SEVRII_VAPID_PUBLIC_KEY / SEVRII_VAPID_PRIVATE_KEY override it.
import { createECDH, createHmac } from "node:crypto";
import webpush from "web-push";
import { deletePushSub, listPushSubs } from "./db";

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

let keys: { publicKey: string; privateKey: string } | null = null;

export function vapidKeys(): { publicKey: string; privateKey: string } | null {
  if (keys) return keys;
  const pub = process.env.SEVRII_VAPID_PUBLIC_KEY;
  const priv = process.env.SEVRII_VAPID_PRIVATE_KEY;
  if (pub && priv) return (keys = { publicKey: pub, privateKey: priv });
  const secret = process.env.SEVRII_PUSH_SECRET || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!secret) return null;
  try {
    const seed = createHmac("sha256", "sevrii-vapid-v1").update(secret).digest();
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(seed);
    keys = { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(seed) };
    return keys;
  } catch {
    return null;
  }
}

export function pushPublicKey(): string {
  return vapidKeys()?.publicKey ?? "";
}

export type PushMessage = { title: string; body: string; url: string; tag?: string };

export type PushResult = { label: string; host: string; ok: boolean; status: number; error?: string };

// Sends to every device the owner turned on. Dead subscriptions are removed.
export async function pushToUser(userId: string, msg: PushMessage): Promise<number> {
  return (await pushToUserDetailed(userId, msg)).filter((r) => r.ok).length;
}

// Same, with what each device's push service answered (for the "send a test" button).
export async function pushToUserDetailed(userId: string, msg: PushMessage): Promise<PushResult[]> {
  const k = vapidKeys();
  if (!k) return [];
  const out: PushResult[] = [];
  try {
    const subs = await listPushSubs(userId);
    for (const s of subs) {
      let host = "";
      try {
        host = new URL(s.endpoint).hostname;
      } catch {}
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 240), url: msg.url, tag: msg.tag }),
          { TTL: 60 * 60 * 6, urgency: "high", vapidDetails: { subject: "mailto:hola@sevrii.com", publicKey: k.publicKey, privateKey: k.privateKey } }
        );
        out.push({ label: s.label || "", host, ok: true, status: 201 });
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        const body = String((err as { body?: unknown })?.body ?? (err as Error)?.message ?? "").slice(0, 160);
        out.push({ label: s.label || "", host, ok: false, status: code ?? 0, error: body });
        // 404/410: the subscription is gone. 401/403: it was made with other
        // keys; the browser makes a fresh one next time the owner opens Sevrii.
        if (code === 404 || code === 410 || code === 401 || code === 403) await deletePushSub(s.endpoint);
        else console.error("[push] send failed", code, (err as Error)?.message);
      }
    }
  } catch (err) {
    console.error("[push] failed", (err as Error)?.message);
  }
  return out;
}
