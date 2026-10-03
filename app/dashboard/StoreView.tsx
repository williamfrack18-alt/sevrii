"use client";

import { useState, useTransition } from "react";
import StoreChat from "./StoreChat";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { missingForSales, publishGaps, type PublishGap } from "@/lib/site";
import { setPublishedAction } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

const TOTAL_STEPS = 11;

export default function StoreView({
  business,
  services,
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
  const [showPreview, setShowPreview] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [publishing, startPublish] = useTransition();
  const [serverGaps, setServerGaps] = useState<PublishGap[] | null>(null);
  const liveUrl = `/site/${business.slug}`;

  const gaps =
    serverGaps ?? publishGaps({ category: business.category, whatsapp: business.whatsapp, site: business.site, serviceCount: services.length });
  const missing = missingForSales({
    category: business.category,
    whatsapp: business.whatsapp,
    site: business.site,
    serviceCount: services.length,
    pricedServices: services.filter((s) => (s.price ?? "").trim()).length,
  });
  const done = Math.max(0, TOTAL_STEPS - missing.length);

  function updated(b: ClientBusiness, s: ClientService[]) {
    onUpdated(b, s);
    setServerGaps(null);
    setPreviewKey((k) => k + 1);
  }

  function togglePublish(publish: boolean) {
    startPublish(async () => {
      const res = await setPublishedAction(publish);
      if (!res.ok) {
        setServerGaps(res.gaps);
        return;
      }
      updated(toClientBusiness(res.business), services);
    });
  }

  const preview = (
    <div className="preview-stage h-full p-4 flex justify-center overflow-y-auto">
      <div className="rounded-[28px] border border-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden bg-white w-[390px] max-w-full h-fit">
        <iframe key={`${business.slug}-${previewKey}`} src={liveUrl} title={t.dashboard.livePageTitle} className="w-full border-0" style={{ height: "760px" }} />
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100dvh-118px)] md:h-screen">
      {/* Top bar */}
      <div className="shrink-0 px-4 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "#3ddc84" }}>
            01 · {t.dashboard.store}
          </span>
          <span className="text-[14px] text-ink font-semibold">{st.chatTitle}</span>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-[3px] rounded-full font-medium"
            style={business.published ? { background: "rgba(61,220,132,.14)", color: "#3ddc84" } : { background: "rgba(255,196,0,.14)", color: "#ffc400" }}
          >
            ● {business.published ? st.live : st.draft}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="lg:hidden h-9 px-4 rounded-full border border-borderStrong text-ink text-[13px] font-semibold" onClick={() => setShowPreview((v) => !v)}>
            {showPreview ? st.hidePage : st.viewPage}
          </button>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="hidden sm:flex h-9 px-4 rounded-full border border-borderStrong text-ink items-center text-[13px] font-semibold">
            {business.published ? t.dashboard.openLive : st.preview} ↗
          </a>
          {business.published ? (
            <button type="button" className="h-9 px-4 rounded-full border border-borderStrong text-ink text-[13px] font-semibold" disabled={publishing} onClick={() => togglePublish(false)}>
              {st.unpublish}
            </button>
          ) : (
            <button
              type="button"
              className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-40"
              style={{ background: "#3ddc84", color: "#000" }}
              disabled={publishing || gaps.length > 0}
              title={gaps.length ? gaps.map((g) => st.gaps[g]).join(" ") : undefined}
              onClick={() => togglePublish(true)}
            >
              {st.publish}
            </button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="shrink-0 px-4 md:px-6 py-2.5 border-b border-border bg-white flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="text-[12.5px] text-ink font-medium">{st.progress(done, TOTAL_STEPS)}</span>
        <div className="h-1.5 w-32 rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${(done / TOTAL_STEPS) * 100}%`, background: "#3ddc84" }} />
        </div>
        {missing.length > 0 && (
          <span className="text-[12px] text-mutedLight truncate">
            {missing
              .slice(0, 4)
              .map((m) => st.missing[m.split(" ")[0]] ?? m)
              .join(" · ")}
          </span>
        )}
      </div>

      {/* Chat + preview */}
      <div className="flex-1 min-h-0 flex">
        <div className={`flex-1 min-w-0 bg-white ${showPreview ? "hidden lg:flex" : "flex"} flex-col`}>
          <StoreChat
            greeting={greeting}
            initialMessages={initialMessages}
            onUpdated={updated}
            onMessages={onMessages}
          />
        </div>
        <div className={`${showPreview ? "flex" : "hidden"} lg:flex w-full lg:w-[440px] shrink-0 border-l border-border flex-col`}>{preview}</div>
      </div>
    </div>
  );
}
