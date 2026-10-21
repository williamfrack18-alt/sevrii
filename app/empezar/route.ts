import type { NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isStartPath, startWith } from "@/lib/startPath";

export const dynamic = "force-dynamic";

// /empezar?path=existing|new|agent — see lib/startPath.ts.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  const user = await getCurrentUser().catch(() => null);
  return startWith(isStartPath(p) ? p : null, user);
}
