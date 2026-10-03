"use client";

import { useState } from "react";
import StoreChat from "./StoreChat";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import type { ClientBusiness, ClientService } from "./types";

// Store = one clean chat (like ChatGPT). The live page sits right below it.
export default function StoreView({
  business,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
}: {
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: { id: string; role: string; content: string }[]) => void;
}) {
  const t = useT();
  const st = STORE_TEXT[useLang()].editor;
  const [previewKey, setPreviewKey] = useState(0);
  const liveUrl = `/site/${business.slug}`;

  return (
    <div style={{ background: "#000" }}>
      {/* Chat: fills the screen, composer pinned at the bottom */}
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between">
          <span className="text-[17px] font-semibold text-white">
            Sevrii <span className="text-[#8e8e8e] font-normal">· Store</span>
          </span>
          <a
            href="#store-page"
            className="text-[12px] px-3 py-1 rounded-full font-medium"
            style={business.published ? { background: "rgba(61,220,132,.14)", color: "#3ddc84" } : { background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}
          >
            {business.published ? st.live : st.draft}
          </a>
        </div>
        <StoreChat
          greeting={greeting}
          initialMessages={initialMessages}
          onMessages={onMessages}
          onUpdated={(b, s) => {
            onUpdated(b, s);
            setPreviewKey((k) => k + 1);
          }}
        />
      </section>

      {/* The page, below the chat */}
      <section id="store-page" className="px-3 md:px-8 pt-6 pb-10" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-[15px] font-semibold text-white">{st.yourPage}</h2>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted hover:text-ink">
              {t.dashboard.openLive} ↗
            </a>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
            <iframe key={`${business.slug}-${previewKey}`} src={liveUrl} title={t.dashboard.livePageTitle} className="w-full border-0 block" style={{ height: "1100px" }} />
          </div>
        </div>
      </section>
    </div>
  );
}
