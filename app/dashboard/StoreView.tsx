"use client";

import { useState } from "react";
import { updateWhatsappAction } from "@/app/actions";
import SubmitButton from "@/components/SubmitButton";
import EditorChat from "./EditorChat";
import { useT } from "@/components/LangProvider";
import type { ClientBusiness, ClientService } from "./DashboardTabs";

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
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const liveUrl = `/site/${business.slug}`;

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="min-h-[60px] shrink-0 px-5 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-white">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12px] font-semibold tracking-wide uppercase" style={{ color: "#3ddc84" }}>01 · {t.dashboard.store}</span>
          <span className="text-[14px] text-ink font-semibold">{t.dashboard.pageBuilder}</span>
          <span className="live-badge inline-flex items-center gap-1.5 text-[11px] px-2.5 py-[3px] rounded-full font-medium ml-1">
            <svg width="6" height="6" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="4" fill="#1F9D55" />
            </svg>
            {t.dashboard.liveBadge}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="seg flex items-center gap-0.5 rounded-full p-[3px]">
            <button
              type="button"
              onClick={() => setPreviewMode("desktop")}
              aria-label={t.dashboard.desktopPreview}
              className={`seg-btn w-9 h-7 rounded-full flex items-center justify-center ${previewMode === "desktop" ? "on" : ""}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("mobile")}
              aria-label={t.dashboard.phonePreview}
              className={`seg-btn w-9 h-7 rounded-full flex items-center justify-center ${previewMode === "mobile" ? "on" : ""}`}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="7" y="2" width="10" height="20" rx="2" />
                <path d="M11 18h2" />
              </svg>
            </button>
          </div>
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="h-9 px-4 rounded-full border border-borderStrong text-ink flex items-center gap-1.5 text-[13px] font-semibold"
          >
            {t.dashboard.openLive}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
            </svg>
          </a>
        </div>
      </div>

      {/* Preview + AI chat */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-[560px]">
        <div className="preview-stage grow p-4 md:p-6 overflow-y-auto flex justify-center">
          <div
            className="rounded-2xl border border-border shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden transition-[width] duration-200 bg-[#ffffff]"
            style={{ width: previewMode === "desktop" ? "100%" : "390px", maxWidth: "100%", height: "fit-content" }}
          >
            <iframe
              key={business.slug}
              src={liveUrl}
              title={t.dashboard.livePageTitle}
              className="w-full border-0"
              style={{ height: "720px" }}
            />
          </div>
        </div>
        <div className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-white p-4 min-h-[420px]">
          <EditorChat business={business} services={services} initialMessages={initialMessages} onUpdated={onUpdated} />
        </div>
      </div>

      {/* Metrics footer */}
      <div className="border-t border-border bg-white px-5 md:px-6 py-5 flex flex-wrap gap-8">
        <Metric label={t.dashboard.pageViews} value={business.pageViews} />
        <Metric label={t.dashboard.whatsappClicks} value={business.whatsappClicks} />
        <Metric label={t.dashboard.servicesListed} value={services.length} />
      </div>

      {/* Manual controls */}
      <div className="px-5 md:px-6 pb-8 pt-5 grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="card">
          <h3 className="text-[15px] font-semibold mb-3">{t.dashboard.services}</h3>
          {services.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t.dashboard.noServices}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {services.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 border-b border-border last:border-0 pb-2.5 last:pb-0">
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink">{s.name}</div>
                    {s.description && <div className="text-[12.5px] text-muted mt-0.5">{s.description}</div>}
                  </div>
                  {s.price && <div className="text-[13px] text-muted shrink-0">{s.price}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="text-[15px] font-semibold mb-3">{t.dashboard.whatsappNumber}</h3>
          <form action={updateWhatsappAction} className="flex flex-col gap-3">
            <input
              name="whatsapp"
              defaultValue={business.whatsapp ?? ""}
              placeholder={t.dashboard.whatsappPlaceholder}
              className="input"
            />
            <SubmitButton>{t.dashboard.saveNumber}</SubmitButton>
          </form>
        </div>
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
