"use client";

import { useState } from "react";
import { logoutAction } from "@/app/actions";
import StoreView from "./StoreView";
import MarketingView from "./MarketingView";
import BrandMark from "@/components/BrandMark";
import LangToggle from "@/components/LangToggle";
import { useT } from "@/components/LangProvider";

export type ClientBusiness = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  pitch: string;
  whatsapp: string | null;
  accentColor: string;
  pageViews: number;
  whatsappClicks: number;
};

export type ClientService = { id: string; name: string; price: string | null; description: string | null };
export type ClientCampaign = {
  id: string;
  title: string;
  goal: string;
  status: string;
  adCopy: string | null;
  budgetNote: string | null;
  audience: string | null;
  platforms: string | null;
  variations: string | null;
};
export type ClientMsg = { id: string; role: string; content: string };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function DashboardTabs({
  userEmail,
  business,
  services,
  campaigns,
  marketingMessages,
  editorMessages,
}: {
  userEmail: string;
  business: ClientBusiness;
  services: ClientService[];
  campaigns: ClientCampaign[];
  marketingMessages: ClientMsg[];
  editorMessages: ClientMsg[];
}) {
  const t = useT();
  const [view, setView] = useState<"store" | "marketing">("store");
  const [currentBusiness, setCurrentBusiness] = useState<ClientBusiness>(business);
  const [currentServices, setCurrentServices] = useState<ClientService[]>(services);
  const [currentCampaigns, setCurrentCampaigns] = useState<ClientCampaign[]>(campaigns);

  return (
    <div className="theme-dark bg-cream flex">
      {/* Rail nav */}
      <div className="w-[220px] shrink-0 min-h-screen bg-white border-r border-border p-5 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-[22px]">
            <BrandMark />
            <LangToggle />
          </div>
          <div className="flex items-center gap-2.5 p-2.5 border border-border rounded-[11px] mb-5">
            <div
              className="w-[26px] h-[26px] rounded-[7px] text-white flex items-center justify-center text-[11px] font-semibold shrink-0"
              style={{ background: `linear-gradient(135deg, ${currentBusiness.accentColor} 0%, #2B4F3A 100%)` }}
            >
              {initials(currentBusiness.name)}
            </div>
            <div className="grow min-w-0">
              <div className="text-[12px] font-semibold text-ink truncate">{currentBusiness.name}</div>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setView("store")}
              className={`nav-item flex items-center gap-2.5 px-2.5 py-2.5 rounded-[9px] w-full text-left ${
                view === "store" ? "bg-mint" : ""
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={view === "store" ? "#122118" : "#6E7268"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-6 9 6v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" />
                <path d="M9 21V12h6v9" />
              </svg>
              <span className={`text-[13px] ${view === "store" ? "font-semibold text-ink" : "text-muted"}`}>{t.dashboard.store}</span>
            </button>
            <button
              type="button"
              onClick={() => setView("marketing")}
              className={`nav-item flex items-center gap-2.5 px-2.5 py-2.5 rounded-[9px] w-full text-left ${
                view === "marketing" ? "bg-mint" : ""
              }`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={view === "marketing" ? "#122118" : "#6E7268"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17l6-6 4 4 8-8" />
                <path d="M15 7h6v6" />
              </svg>
              <span className={`text-[13px] ${view === "marketing" ? "font-semibold text-ink" : "text-muted"}`}>
                {t.dashboard.marketing}
              </span>
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2.5 border-t border-border pt-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-[26px] h-[26px] rounded-full bg-border text-muted flex items-center justify-center text-[10px] font-semibold shrink-0">
              {initials(userEmail)}
            </div>
            <div className="grow text-[12px] text-ink truncate min-w-0">{userEmail}</div>
          </div>
          <form action={logoutAction}>
            <button type="submit" className="text-[12px] font-medium text-muted hover:text-ink">
              {t.dashboard.logout}
            </button>
          </form>
        </div>
      </div>

      {/* Main content */}
      <div className="grow min-w-0">
        {view === "store" ? (
          <StoreView
            business={currentBusiness}
            services={currentServices}
            initialMessages={editorMessages}
            onUpdated={(b, s) => {
              setCurrentBusiness(b);
              setCurrentServices(s);
            }}
          />
        ) : (
          <MarketingView
            business={currentBusiness}
            campaigns={currentCampaigns}
            initialMessages={marketingMessages}
            onCampaignsUpdated={setCurrentCampaigns}
          />
        )}
      </div>
    </div>
  );
}
