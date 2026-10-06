"use client";

import { useState } from "react";
import StoreChat from "./StoreChat";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { setPublishedAction } from "@/app/storeActions";
import type { PublishGap } from "@/lib/site";
import { MARKET_CATEGORY_EN, type MarketCategory } from "@/lib/marketCategories";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

// Store = one clean chat (like ChatGPT). The live page sits right below it.
export default function StoreView({
  business,
  services,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  canPublish = true,
  onPlans,
}: {
  canPublish?: boolean;
  onPlans?: () => void;
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: { id: string; role: string; content: string }[]) => void;
}) {
  const t = useT();
  const lang = useLang();
  const st = STORE_TEXT[lang].editor;
  const lk = PLANS_TEXT[lang].lock;
  const [previewKey, setPreviewKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "gaps"; gaps: PublishGap[] } | { kind: "ok" } | { kind: "error" } | null>(null);

  async function publish(on: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await setPublishedAction(on);
      if (res.upgrade) onPlans?.();
      else if (res.ok) {
        onUpdated(toClientBusiness(res.business), services);
        setPreviewKey((k) => k + 1);
        if (on) setNotice({ kind: "ok" });
      } else if (res.gaps.length) setNotice({ kind: "gaps", gaps: res.gaps });
      else setNotice({ kind: "error" });
    } catch {
      setNotice({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }
  const liveUrl = `/site/${business.slug}`;

  return (
    <div style={{ background: "#000" }}>
      {/* Chat: fills the screen, composer pinned at the bottom */}
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between">
          <span className="text-[17px] font-semibold text-white">
            Sevrii <span className="text-[#8e8e8e] font-normal">· Store</span>
          </span>
          <div className="flex items-center gap-2">
            {business.published ? (
              <>
                {business.marketCategory && (
                  <a
                    href={lang === "es" ? "/#explorar" : "/en#explorar"}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium"
                    style={{ background: "rgba(255,255,255,.06)", color: "#d4d4d4" }}
                  >
                    {st.inMarket}: {lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}
                  </a>
                )}
                <a href="#store-page" className="text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: TINT, color: ACCENT }}>
                  {st.live}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(false)}
                  className="text-[12px] px-3 py-1 rounded-full font-medium disabled:opacity-50"
                  style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}
                >
                  {st.unpublish}
                </button>
              </>
            ) : canPublish ? (
              <>
                <a href="#store-page" className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
                  {st.draft}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(true)}
                  className="h-8 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
                  style={BRAND_BTN}
                >
                  {busy ? st.publishing : st.publish}
                </button>
              </>
            ) : (
              <>
                <a href="#store-page" className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
                  {st.draft}
                </a>
                <button type="button" onClick={onPlans} className="text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: TINT, color: ACCENT }}>
                  {lk.publishChip} →
                </button>
              </>
            )}
          </div>
        </div>
        {notice && (
          <div className="shrink-0 mx-4 md:mx-6 mb-2 rounded-xl px-4 py-3 text-[13.5px] text-[#ececec] flex items-start justify-between gap-3" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}>
            <div>
              {notice.kind === "gaps" ? (
                <>
                  <div className="font-medium">{st.gapsTitle}</div>
                  <ul className="mt-1 text-[#a1a1aa] list-disc pl-5">
                    {notice.gaps.map((g) => (
                      <li key={g}>{st.gaps[g]}</li>
                    ))}
                  </ul>
                </>
              ) : notice.kind === "ok" ? (
                <span>
                  <span style={{ color: ACCENT }}>✓ </span>
                  {st.publishedOk}
                  {business.marketCategory ? ` ${st.inMarket}: ${lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}.` : ""}
                </span>
              ) : (
                <span>{st.publishFailed}</span>
              )}
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-[#8e8e8e] text-[16px] leading-none" aria-label="close">
              ×
            </button>
          </div>
        )}
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
