"use client";

import { useState } from "react";
import { MK_TEXT } from "@/lib/marketingI18n";

type Size = "square" | "story";

export function adImageUrl(campaignId: string, size: Size, photo: number): string {
  return `/api/ad-image?campaign=${encodeURIComponent(campaignId)}&size=${size}&photo=${photo}`;
}

// Ready-made ad images (square for the feed, story for Stories/Reels) made
// from the owner's photos, each with a download link.
export default function AdImages({ campaignId, photoCount, lang }: { campaignId: string; photoCount: number; lang: "es" | "en" }) {
  const t = MK_TEXT[lang].adImages;
  const count = Math.max(0, Math.floor(photoCount || 0));
  // No photos: one set on the brand gradient.
  const photos = count > 0 ? Array.from({ length: Math.min(3, count) }, (_, i) => i) : [0];

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
      <span className="text-[12.5px] font-medium text-white">{t.title}</span>
      {count === 0 && <span className="text-[11.5px] text-[#8e8e8e] leading-snug -mt-1">{t.noPhoto}</span>}
      <div className="flex flex-col gap-4">
        {photos.map((p) => (
          <div key={p} className="flex flex-col gap-2">
            {count > 1 && <span className="text-[11.5px] text-[#a1a1a1]">{t.photo(p + 1)}</span>}
            <div className="flex items-end gap-3 flex-wrap">
              <Preview campaignId={campaignId} size="square" photo={p} lang={lang} />
              <Preview campaignId={campaignId} size="story" photo={p} lang={lang} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Preview({ campaignId, size, photo, lang }: { campaignId: string; size: Size; photo: number; lang: "es" | "en" }) {
  const t = MK_TEXT[lang].adImages;
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const src = adImageUrl(campaignId, size, photo);
  const square = size === "square";
  const w = square ? 132 : 84;
  const h = square ? 132 : 150;
  return (
    <div className="flex flex-col gap-1.5" style={{ width: w }}>
      <div
        className="relative rounded-xl overflow-hidden flex items-center justify-center"
        style={{ width: w, height: h, background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}
      >
        {state !== "ok" && (
          <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[10.5px] text-[#8e8e8e]">
            {state === "error" ? t.failed : t.loading}
          </span>
        )}
        {state !== "error" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={square ? t.square : t.story}
            loading="lazy"
            onLoad={() => setState("ok")}
            onError={() => setState("error")}
            className="relative w-full h-full object-cover"
            style={{ opacity: state === "ok" ? 1 : 0, transition: "opacity .2s" }}
          />
        )}
      </div>
      <span className="text-[10.5px] text-[#8e8e8e] leading-tight">{square ? t.square : t.story}</span>
      <a
        href={src}
        download={`sevrii-ad-${size}-${photo + 1}.png`}
        aria-disabled={state === "error"}
        className="text-[11.5px] h-7 rounded-lg flex items-center justify-center font-medium text-[#d4d4d4] hover:text-white"
        style={{ background: "rgba(255,255,255,0.08)", pointerEvents: state === "error" ? "none" : undefined, opacity: state === "error" ? 0.5 : 1 }}
      >
        {t.download}
      </a>
    </div>
  );
}
