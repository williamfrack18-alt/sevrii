"use client";

import MarketingChat from "./MarketingChat";
import type { ClientBusiness, ClientCampaign } from "./DashboardTabs";

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
  return (
    <div className="flex flex-col min-h-screen">
      <div className="h-[60px] shrink-0 px-6 flex items-center gap-2.5 border-b border-border bg-white">
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink">Marketing</span>
        <span className="text-[14px] text-ink font-semibold">· Campaign drafts</span>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 p-6">
        <div className="card">
          <h3 className="text-[15px] font-semibold mb-1">Drafts for {business.name}</h3>
          <p className="text-[13px] text-mutedLight mb-4">
            Sevri AI builds a complete campaign plan (audience, platforms, budget, and a few ad copy options
            to test) based on what you ask for. These are drafts to use wherever you run ads — Sevri
            doesn&rsquo;t connect to an ad account or publish anything on your behalf yet.
          </p>
          {campaigns.length === 0 ? (
            <p className="text-[13.5px] text-muted">
              No drafts yet — tell the assistant what you want more of (bookings, calls, visits) and it will
              build a full campaign for you.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {campaigns.map((c) => {
                const variations = parseVariations(c.variations);
                return (
                  <div key={c.id} className="border border-border rounded-xl2 p-4">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-[14px] font-semibold text-ink">{c.title}</div>
                      <span className="text-[11px] font-medium text-muted bg-mint px-2 py-[3px] rounded-full">
                        {c.status}
                      </span>
                    </div>
                    <p className="text-[13px] text-muted mb-2">Goal: {c.goal}</p>
                    {c.audience && (
                      <p className="text-[12.5px] text-muted mb-1">
                        <span className="font-semibold text-ink">Audience:</span> {c.audience}
                      </p>
                    )}
                    {c.platforms && (
                      <p className="text-[12.5px] text-muted mb-1">
                        <span className="font-semibold text-ink">Platforms:</span> {c.platforms}
                      </p>
                    )}
                    {c.budgetNote && (
                      <p className="text-[12.5px] text-mutedLight mb-3">
                        <span className="font-semibold text-ink">Budget:</span> {c.budgetNote}
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
