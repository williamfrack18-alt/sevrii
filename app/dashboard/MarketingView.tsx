"use client";

import MarketingChat from "./MarketingChat";
import type { ClientBusiness, ClientCampaign } from "./DashboardTabs";

export default function MarketingView({
  business,
  campaigns,
  initialMessages,
}: {
  business: ClientBusiness;
  campaigns: ClientCampaign[];
  initialMessages: { id: string; role: string; content: string }[];
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
            Sevri AI drafts ad copy and a budget note based on what you ask for. These are drafts to use
            wherever you run ads — Sevri doesn&rsquo;t connect to an ad account or publish anything on your
            behalf.
          </p>
          {campaigns.length === 0 ? (
            <p className="text-[13.5px] text-muted">
              No drafts yet — tell the assistant what you want more of (bookings, calls, visits) and it will
              draft one.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {campaigns.map((c) => (
                <div key={c.id} className="border border-border rounded-xl2 p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div className="text-[14px] font-semibold text-ink">{c.title}</div>
                    <span className="text-[11px] font-medium text-muted bg-mint px-2 py-[3px] rounded-full">
                      {c.status}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted mb-2">Goal: {c.goal}</p>
                  {c.adCopy && (
                    <p className="text-[13.5px] text-ink whitespace-pre-line mb-2">&ldquo;{c.adCopy}&rdquo;</p>
                  )}
                  {c.budgetNote && (
                    <p className="text-[12.5px] text-mutedLight">Suggested budget: {c.budgetNote}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <MarketingChat initialMessages={initialMessages} />
      </div>
    </div>
  );
}
