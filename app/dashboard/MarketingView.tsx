"use client";

import MarketingChat from "./MarketingChat";
import type { ClientBusiness, ClientCampaign } from "./DashboardTabs";
import { useT } from "@/components/LangProvider";

type Variation = { headline: string; body: string };

function parseVariations(raw: string | null): Variation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is Variation => v && typeof v.headline === "string" && typeof v.body === "string"
    );
  } catch {
    return [];
  }
}

export default function MarketingView({
  business,
  campaigns,
  initialMessages,
  onCampaignsUpdated,
}: {
  business: ClientBusiness;
  campaigns: ClientCampaign[];
  initialMessages: { id: string; role: string; content: string }[];
  onCampaignsUpdated: (campaigns: ClientCampaign[]) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col min-h-screen">
      <div className="h-[60px] shrink-0 px-6 flex items-center gap-2.5 border-b border-border bg-white">
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink">{t.dashboard.marketing}</span>
        <span className="text-[14px] text-ink font-semibold">{t.dashboard.marketingHeader}</span>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 p-6">
        <div className="card">
          <h3 className="text-[15px] font-semibold mb-1">{t.dashboard.draftsFor(business.name)}</h3>
          <p className="text-[13px] text-mutedLight mb-4">{t.dashboard.draftsNote}</p>
          {campaigns.length === 0 ? (
            <p className="text-[13.5px] text-muted">{t.dashboard.noDrafts}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {campaigns.map((c) => {
                const variations = parseVariations(c.variations);
                return (
                  <div key={c.id} className="border border-border rounded-xl2 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-[14px] font-semibold text-ink">{c.title}</div>
                      <span className="text-[11px] font-medium text-muted bg-mint px-2 py-[3px] rounded-full">
                        {t.dashboard.status[c.status?.toLowerCase()] ?? c.status}
                      </span>
                    </div>
                    <p className="text-[13px] text-muted mb-2">{t.dashboard.goal}: {c.goal}</p>
                    {c.audience && (
                      <p className="text-[12.5px] text-muted mb-1">
                        <span className="font-semibold text-ink">{t.dashboard.audience}:</span> {c.audience}
                      </p>
                    )}
                    {c.platforms && (
                      <p className="text-[12.5px] text-muted mb-1">
                        <span className="font-semibold text-ink">{t.dashboard.platforms}:</span> {c.platforms}
                      </p>
                    )}
                    {c.budgetNote && (
                      <p className="text-[12.5px] text-mutedLight mb-3">
                        <span className="font-semibold text-ink">{t.dashboard.budget}:</span> {c.budgetNote}
                      </p>
                    )}
                    {variations.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {variations.map((v, i) => (
                          <div key={i} className="bg-mint rounded-[10px] px-3 py-2.5">
                            <p className="text-[13px] font-semibold text-ink mb-1">{v.headline}</p>
                            <p className="text-[12.5px] text-muted whitespace-pre-line">{v.body}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      c.adCopy && (
                        <p className="text-[13.5px] text-ink whitespace-pre-line">&ldquo;{c.adCopy}&rdquo;</p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <MarketingChat initialMessages={initialMessages} onCampaignsUpdated={onCampaignsUpdated} />
      </div>
    </div>
  );
}
