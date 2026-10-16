import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getCurrentUser } from "@/lib/session";
import { allow } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Videos are too big to pass through our server, so the browser uploads them
// straight to Vercel Blob. This route only hands out a short-lived upload
// token, and only for the signed-in owner's own project folder.
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

export async function POST(req: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  let body: HandleUploadBody;
  try {
    body = (await req.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const user = await getCurrentUser();
        if (!user?.business) throw new Error("auth");
        if (!(await allow(`upload:video:${user.business.id}`, 10, 60 * 60))) throw new Error("rate");
        if (!pathname.startsWith(`stores/${user.business.id}/video-`)) throw new Error("path");
        return {
          allowedContentTypes: VIDEO_TYPES,
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: true,
        };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error)?.message || "failed";
    return NextResponse.json({ error: msg }, { status: msg === "auth" ? 401 : 400 });
  }
}
