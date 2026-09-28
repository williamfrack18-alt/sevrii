"use client";

import { useState } from "react";
import Link from "next/link";
import { updateWhatsappAction } from "@/app/actions";
import SubmitButton from "@/components/SubmitButton";
import MarketingChat from "./MarketingChat";

type ServiceRow = { id: string; name: string; price: string | null; description: string | null };
type CampaignRow = { id: string; title: string; goal: string; status: string; adCopy: string | null; budgetNote: string | null };
type ChatRow = { id: string; role: string; content: string };
type BusinessData = {
  id: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  pitch: string;
  whatsapp: string | null;
  accentColor: string;
};

export default function DashboardTabs({
  business,
  services,
  campaigns,
  marketingMessages,
}: {
  business: BusinessData;
  services: ServiceRow[];
  campaigns: CampaignRow[];
  marketingMessages: ChatRow[];
}) {
  const [tab, setTab] = useState<"website" | "marketing">("website");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setTab("website")}
          className={`px-4 h-11 text-[14px] font-semibold border-b-2 -mb-px ${
            tab === "website" ? "border-ink text-ink" : "border-transparent text-muted"
          }`}
        >
          Website
        </button>
        <button
          onClick={() => setTab("marketing")}
          className={`px-4 h-11 text-[14px] font-semibold border-b-2 -mb-px ${
            tab === "marketing" ? "border-ink text-ink" : "border-transparent text-muted"
          }`}
        >
          Marketing
        </button>
      </div>

      {tab === "website" ? (
        <div className="grid md:grid-cols-[1.1fr_0.9fr] gap-6">
          <div className="card flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-muted">
                  {business.category}
                  {business.city ? ` · ${business.city}` : ""}
                </div>
                <h2 className="font-serif text-2xl font-semibold mt-1">{business.name}</h2>
              </div>
              <Link href={`/site/${business.slug}`} target="_blank" className="btn-ghost">
                View live page
              </Link>
            </div>
            <p className="text-muted text-[14.5px] leading-relaxed">{business.pitch}</p>
            <div>
              <div className="text-[13px] font-semibold mb-2">Services</div>
              <div className="flex flex-col gap-2">
                {services.map((s) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-border pb-2">
                    <span className="text-[13.5px]">{s.name}</span>
                    {s.price && <span className="text-[12.5px] text-muted">{s.price}</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card flex flex-col gap-4">
            <div className="text-[13px] font-semibold">WhatsApp contact number</div>
            <p className="text-[13px] text-muted">
              Every Sevri page leads to WhatsApp. Add your number so the &ldquo;Message on
              WhatsApp&rdquo; button on your live page works.
            </p>
            <form action={updateWhatsappAction} className="flex flex-col gap-3">
              <input
                name="whatsapp"
                defaultValue={business.whatsapp ?? ""}
                placeholder="e.g. +1 555 010 1234"
                className="input"
              />
              <SubmitButton>Save number</SubmitButton>
            </form>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[1.3fr_0.7fr] gap-6">
          <MarketingChat initialMessages={marketingMessages} />
          <div className="card flex flex-col gap-4">
            <div className="text-[13px] font-semibold">Your campaigns</div>
            {campaigns.length === 0 ? (
              <p className="text-[13px] text-muted">
                No campaigns yet — tell Sevri AI what you want more of, on the left.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {campaigns.map((c) => (
                  <div key={c.id} className="border border-border rounded-xl2 p-3.5 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold">{c.title}</span>
                      <span className="text-[11px] uppercase font-semibold text-mutedLight">{c.status}</span>
                    </div>
                    {c.adCopy && <p className="text-[12.5px] text-muted">{c.adCopy}</p>}
                    {c.budgetNote && <p className="text-[11.5px] text-mutedLight">{c.budgetNote}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
