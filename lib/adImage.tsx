import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isOurBlob, readableTextOn } from "./site";

// Ad images (server only): the owner's photo full-bleed with a dark gradient,
// the headline, the price or offer, the business name and a "Message us" pill.

export const AD_SIZES = { square: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } } as const;
export type AdSize = keyof typeof AD_SIZES;

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export function clipText(s: string, max: number): string {
  const v = s.replace(/\s+/g, " ").trim();
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s·,.;:-]+$/, "")}…`;
}

// A darker shade of the accent, for the gradient when there's no photo.
function darken(h: string, f: number): string {
  const n = parseInt(h.slice(1), 16);
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x * f)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

// The photo, read here (only from our own Blob store) and embedded, so a bad
// or unsupported file falls back to the brand gradient instead of failing.
export async function adPhotoData(url: string): Promise<string | null> {
  if (!url || !isOurBlob(url)) return null;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_PHOTO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) return null;
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    if (!isJpeg && !isPng) return null;
    return `data:${isJpeg ? "image/jpeg" : "image/png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

let fontCache: Promise<ArrayBuffer | null> | null = null;
export function adFont(): Promise<ArrayBuffer | null> {
  fontCache ??= readFile(path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf"))
    .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
    .catch(() => null);
  return fontCache;
}

export async function renderAdImage(o: {
  size: AdSize;
  businessName: string;
  headline: string;
  priceLine: string;
  accent: string;
  lang: "es" | "en";
  photo: string | null; // data: URL
  font: ArrayBuffer | null;
}): Promise<ArrayBuffer> {
  const { width, height } = AD_SIZES[o.size];
  const story = o.size === "story";
  const accent = /^#[0-9a-f]{6}$/i.test(o.accent) ? o.accent : "#22704b";
  const pillText = readableTextOn(accent);
  const headline = clipText(o.headline, 60);
  const priceLine = clipText(o.priceLine, 70);
  const name = clipText(o.businessName, 40);
  const pad = story ? 96 : 80;
  const headSize = headline.length > 40 ? (story ? 96 : 80) : story ? 120 : 100;
  const full = { position: "absolute", top: 0, left: 0, width, height, display: "flex" } as const;

  const image = (
    <div style={{ width, height, display: "flex", position: "relative", fontFamily: o.font ? "GeistBold" : undefined, color: "#fff", background: "#0b0b0b" }}>
      {o.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={o.photo} alt="" width={width} height={height} style={{ ...full, objectFit: "cover" }} />
      ) : (
        <div style={{ ...full, backgroundImage: `linear-gradient(150deg, ${accent} 0%, ${darken(accent, 0.55)} 55%, ${darken(accent, 0.25)} 100%)` }} />
      )}
      <div
        style={{
          ...full,
          backgroundImage: o.photo
            ? "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.05) 28%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.9) 100%)"
            : "linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)",
        }}
      />
      <div style={{ ...full, flexDirection: "column", justifyContent: "space-between", textShadow: "0 2px 14px rgba(0,0,0,0.35)", padding: pad, paddingTop: story ? 160 : pad, paddingBottom: story ? 260 : pad }}>
        <div style={{ display: "flex", fontSize: story ? 44 : 38, fontWeight: 700, letterSpacing: -0.5 }}>{name}</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: headSize, fontWeight: 700, lineHeight: 1.04, letterSpacing: -2 }}>{headline}</div>
          {priceLine ? (
            <div style={{ display: "flex", marginTop: story ? 36 : 28, fontSize: story ? 52 : 44, fontWeight: 700, lineHeight: 1.2, color: "rgba(255,255,255,0.92)" }}>
              {priceLine}
            </div>
          ) : null}
          <div style={{ display: "flex", marginTop: story ? 56 : 44 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: story ? 116 : 100,
                paddingLeft: story ? 60 : 50,
                paddingRight: story ? 60 : 50,
                borderRadius: 999,
                background: accent,
                color: pillText,
                fontSize: story ? 48 : 42,
                fontWeight: 700,
                border: "3px solid rgba(255,255,255,0.35)",
              }}
            >
              {o.lang === "es" ? "Escríbenos" : "Message us"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Rendered fully here, so a rendering error is thrown to the caller
  // instead of ending as a broken image stream.
  const rendered = new ImageResponse(image, {
    width,
    height,
    fonts: o.font ? [{ name: "GeistBold", data: o.font, weight: 700, style: "normal" }] : undefined,
  });
  const png = await rendered.arrayBuffer();
  if (!png.byteLength) throw new Error("empty image");
  return png;
}
