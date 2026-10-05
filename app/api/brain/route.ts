import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getLang } from "@/lib/lang";
import { getBusinessById, listChatMessages } from "@/lib/db";
import { advancePipeline, pipelineStatus } from "@/lib/brain/pipeline";

// Research can take a couple of minutes: each POST runs one step.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function snapshot(businessId: string) {
  const b = await getBusinessById(businessId);
  return {
    plan: b?.plan ?? null,
    name: b?.name ?? "",
    slug: b?.slug ?? "",
    jobs: await pipelineStatus(businessId),
    messages: (await listChatMessages(businessId, "plan")).map((m) => ({ id: m.id, role: m.role, content: m.content })),
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.business) return NextResponse.json({ error: "auth" }, { status: 401 });
  return NextResponse.json(await snapshot(user.business.id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  // Same-site only (the session cookie is SameSite=Lax; this is a second check).
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ error: "origin" }, { status: 403 });
  const user = await getCurrentUser();
  if (!user?.business) return NextResponse.json({ error: "auth" }, { status: 401 });
  const retry = new URL(req.url).searchParams.get("retry") === "1";
  const result = await advancePipeline(user.business.id, user.id, await getLang(), retry);
  return NextResponse.json({ ...result, ...(await snapshot(user.business.id)) }, { headers: { "Cache-Control": "no-store" } });
}
