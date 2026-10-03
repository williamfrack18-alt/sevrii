"use client";

import { useState, useTransition } from "react";
import EditorChat from "./EditorChat";
import StoreEditor from "./StoreEditor";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { publishGaps, type PublishGap } from "@/lib/site";
import { setPublishedAction } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

export default function StoreView({
  business,
  services,
  initialMessages,
  onUpdated,
}: {
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
}) {
  const t = useT();
  const st = STORE_TEXT[useLang()].editor;
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const [previewKey, setPreviewKey] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const [publishing, startPublish] = useTransition();
  const [serverGaps, setServerGaps] = useState<PublishGap[] | null>(null);
  const liveUrl = `/site/${business.slug}`;

  const gaps =
    serverGaps ??
    publishGaps({ category: business.category, whatsapp: business.whatsapp, site: business.site, serviceCount: services.length });

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

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="min-h-[60px] shrink-0 px-5 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "#3ddc84" }}>
            01 · {t.dashboard.store}
          </span>
          <span className="text-[14px] text-ink font-semibold">{t.dashboard.pageBuilder}</span>
          <span
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-[3px] rounded-full font-medium ml-1"
            style={business.published ? { background: "rgba(61,220,132,.14)", color: "#3ddc84" } : { background: "rgba(255,196,0,.14)", color: "#ffc400" }}
          >
            ● {business.published ? st.live : st.draft}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="seg flex items-center gap-0.5 rounded-full p-[3px]">
            <button type="button" onClick={() => setPreviewMode("desktop")} aria-label={t.dashboard.desktopPreview} className={`seg-btn w-9 h-7 rounded-full flex items-center justify-center ${previewMode === "desktop" ? "on" : ""}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </button>
            <button type="button" onClick={() => setPreviewMode("mobile")} aria-label={t.dashboard.phonePreview} className={`seg-btn w-9 h-7 rounded-full flex items-center justify-center ${previewMode === "mobile" ? "on" : ""}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <path d="M11 18h2" />
              </svg>
            </button>
          </div>
          <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="h-9 px-4 rounded-full border border-borderStrong text-ink flex items-center gap-1.5 text-[13px] font-semibold">
            {business.published ? t.dashboard.openLive : st.preview} ↗
          </a>
          {business.published ? (
            <button type="button" className="h-9 px-4 rounded-full border border-borderStrong text-ink text-[13px] font-semibold" disabled={publishing} onClick={() => togglePublish(false)}>
              {st.unpublish}
            </button>
          ) : (
            <button
              type="button"
              className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-50"
              style={{ background: "#3ddc84", color: "#000" }}
              disabled={publishing || gaps.length > 0}
              onClick={() => togglePublish(true)}
            >
              {st.publish}
            </button>
          )}
        </div>
      </div>

      {/* Draft checklist */}
      {!business.published && (
        <div className="px-5 md:px-6 py-4 border-b border-border bg-white">
          <p className="text-[13.5px] text-ink">{st.draftHint}</p>
          {gaps.length > 0 && (
            <div className="mt-2">
              <p className="text-[13px] font-semibold text-ink">{st.gapsTitle}</p>
              <ul className="mt-1 text-[13px] text-muted list-disc pl-5">
                {gaps.map((g) => (
                  <li key={g}>{st.gaps[g]}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Preview + AI chat */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-[560px]">
        <div className="preview-stage grow p-4 md:p-6 overflow-y-auto flex justify-center">
          <div
            className="rounded-2xl border border-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden transition-[width] duration-200 bg-[#ffffff]"
            style={{ width: previewMode === "desktop" ? "100%" : "390px", maxWidth: "100%", height: "fit-content" }}
          >
            <iframe key={`${business.slug}-${previewKey}`} src={liveUrl} title={t.dashboard.livePageTitle} className="w-full border-0" style={{ height: "760px" }} />
          </div>
        </div>
        <div className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-white p-4 min-h-[420px]">
          <EditorChat
            business={business}
            services={services}
            initialMessages={initialMessages}
            onUpdated={(b, s) => {
              updated(b, s);
              // The AI changed the page: reload the form so it shows the new values.
              setEditorKey((k) => k + 1);
            }}
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="border-t border-border bg-white px-5 md:px-6 py-5 flex flex-wrap gap-8">
        <Metric label={t.dashboard.pageViews} value={business.pageViews} />
        <Metric label={st.clicks.call} value={business.callClicks} />
        <Metric label={st.clicks.text} value={business.textClicks} />
        <Metric label={st.clicks.whatsapp} value={business.whatsappClicks} />
      </div>

      {/* Manual editor */}
      <div className="px-5 md:px-6 pb-10 pt-5 max-w-[980px]">
        <StoreEditor key={`${business.id}-${editorKey}`} business={business} services={services} onUpdated={updated} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[22px] font-semibold text-ink font-serif">{value}</div>
      <div className="text-[12px] text-muted">{label}</div>
    </div>
  );
}
