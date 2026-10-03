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
    <div className="bg-white">
      {/* Chat: fills the screen, input pinned at the bottom */}
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
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
      <section id="store-page" className="border-t border-border px-3 md:px-8 py-8">
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[15px] font-semibold text-ink">{st.yourPage}</h2>
              <span
                className="text-[11px] px-2.5 py-[3px] rounded-full font-medium"
                style={business.published ? { background: "rgba(61,220,132,.14)", color: "#3ddc84" } : { background: "rgba(255,196,0,.14)", color: "#ffc400" }}
              >
                {business.published ? st.live : st.draft}
              </span>
            </div>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted hover:text-ink">
              {t.dashboard.openLive} ↗
            </a>
          </div>
          <div className="rounded-2xl border border-border overflow-hidden bg-white">
            <iframe key={`${business.slug}-${previewKey}`} src={liveUrl} title={t.dashboard.livePageTitle} className="w-full border-0 block" style={{ height: "1100px" }} />
          </div>
        </div>
      </section>
    </div>
  );
}
