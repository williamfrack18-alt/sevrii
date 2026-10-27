import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAgentCase, updateAgentCase } from "@/lib/db";
import { liveKey } from "@/lib/agentOps/browser";
import { sandboxEnterCard, sandboxRead, type SandboxState } from "@/lib/agentOps/sandbox";
import { allow, clientIp } from "@/lib/guard";

// The practice office's live view (test mode): what the agent has open, shown
// to the customer inside the chat. On the payment step the customer types the
// test card here themselves; it's checked and thrown away, never stored.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(id: string, k: string): boolean {
  const want = Buffer.from(liveKey(id));
  const got = Buffer.from(k || "");
  return got.length === want.length && timingSafeEqual(got, want);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(id: string, k: string, sb: SandboxState, msg = ""): string {
  const v = sandboxRead(sb);
  const fields = v.fields
    .map((f) =>
      f.sensitive
        ? sb.cardEntered
          ? `<p class="ok">✓ ${esc(f.label)}: ingresada</p>`
          : `<form method="post"><input type="hidden" name="c" value="${esc(id)}"><input type="hidden" name="k" value="${esc(k)}"><label>${esc(f.label)}<input name="card" inputmode="numeric" autocomplete="off" placeholder="4242 4242 4242 4242" required></label><button>Guardar tarjeta</button></form>`
        : `<p><span>${esc(f.label)}</span><b>${esc(f.value || "—")}</b></p>`
    )
    .join("");
  const buttons = v.buttons.map((b) => `<span class="btn">${esc(b.label)}</span>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(v.title)}</title>
<style>body{font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;margin:0;background:#f4f4f0;color:#111}.bar{background:#7a5b00;color:#fff;padding:8px 14px;font-size:12.5px}.wrap{padding:16px}h1{font-size:18px;margin:0 0 8px}p{margin:6px 0;display:flex;gap:10px;justify-content:space-between;border-bottom:1px solid #e5e5e0;padding:6px 0}p span{color:#666}.ok{color:#15803d}label{display:block;font-weight:600;margin:10px 0}input{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border:1px solid #ccc;border-radius:10px;font-size:16px}button{margin-top:10px;padding:10px 16px;border:0;border-radius:999px;background:#111;color:#fff;font-weight:600}.btn{display:inline-block;margin:10px 8px 0 0;padding:8px 14px;border-radius:999px;background:#e9e9e4;font-size:13px}.msg{color:#b91c1c}.txt{color:#444;font-size:13.5px}</style></head>
<body><div class="bar">Oficina de práctica · modo de prueba · nada es real</div><div class="wrap"><h1>${esc(v.title)}</h1><div class="txt">${esc(v.text)}</div>${msg ? `<p class="msg">${esc(msg)}</p>` : ""}${fields}<div>${buttons}</div></div></body></html>`;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("c") || "";
  const k = u.searchParams.get("k") || "";
  if (!ok(id, k)) return new NextResponse("Not found", { status: 404 });
  const c = await getAgentCase(id);
  const sb = c?.browser.sandbox as SandboxState | undefined;
  if (!c || !sb) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(page(id, k, sb), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" } });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const id = String(form.get("c") || "");
  const k = String(form.get("k") || "");
  if (!ok(id, k)) return new NextResponse("Not found", { status: 404 });
  if (!(await allow(`case:live:${await clientIp()}`, 20, 10 * 60))) return new NextResponse("Too many tries", { status: 429 });
  const c = await getAgentCase(id);
  const sb = c?.browser.sandbox as SandboxState | undefined;
  if (!c || !sb) return new NextResponse("Not found", { status: 404 });
  const good = sandboxEnterCard(sb, String(form.get("card") || ""));
  if (good) await updateAgentCase(id, { browser: { ...c.browser, sandbox: sb } });
  return new NextResponse(page(id, k, sb, good ? "" : "Modo de prueba: usa la tarjeta 4242 4242 4242 4242."), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "SAMEORIGIN" },
  });
}
