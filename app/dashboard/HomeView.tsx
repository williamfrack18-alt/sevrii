"use client";

import { useState } from "react";
import { useT } from "@/components/LangProvider";
import type { ClientBusiness, ClientCampaign, ClientService, DashboardView } from "./DashboardTabs";
import { ACCENT } from "@/lib/brand";

export default function HomeView({
  business,
  services,
  campaigns,
  onNavigate,
}: {
  business: ClientBusiness;
  services: ClientService[];
  campaigns: ClientCampaign[];
  onNavigate: (view: DashboardView) => void;
}) {
  const t = useT();
  const d = t.dashboard;
  const [copied, setCopied] = useState(false);
  const livePath = `/site/${business.slug}`;

  function copyLink() {
    const url = `${window.location.origin}${livePath}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});
  }

  const stats = [
    { label: d.pageViews, value: business.pageViews },
    { label: d.contacts, value: business.callClicks + business.textClicks + business.whatsappClicks },
    { label: d.services, value: services.length },
    { label: d.campaignDrafts, value: campaigns.length },
  ];

  const pillars: {
    id: DashboardView;
    n: string;
    name: string;
    desc: string;
    metric: string;
    cta: string;
    soon?: boolean;
  }[] = [
    { id: "store", n: "01", name: "Store", desc: d.storeDesc, metric: d.storeMetric(services.length), cta: d.openStore },
    {
      id: "marketing",
      n: "02",
      name: "Marketing",
      desc: d.marketingDesc,
      metric: d.marketingMetric(campaigns.length),
      cta: d.openMarketing,
    },
    { id: "payments", n: "03", name: "Payments", desc: d.paymentsDesc, metric: d.soonMetric, cta: d.seeComing, soon: true },
    { id: "capital", n: "04", name: "Capital", desc: d.capitalDesc, metric: d.soonMetric, cta: d.seeComing, soon: true },
  ];

  // Only real, still-pending things — nothing here is invented.
  const steps: { label: string; go: DashboardView }[] = [];
  if (!business.site.phone && !business.whatsapp) steps.push({ label: d.stepWhatsapp, go: "store" });
  if (!business.published) steps.push({ label: d.stepPublish, go: "store" });
  if (services.length === 0) steps.push({ label: d.stepService, go: "store" });
  if (campaigns.length === 0) steps.push({ label: d.stepCampaign, go: "marketing" });

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1180px]">
      {/* Header */}
      <div className="flex flex-col gap-3 mb-8">
        <span className="text-[14px] font-medium" style={{ color: ACCENT }}>
          {d.homeEyebrow}
        </span>
        <h1 className="font-serif text-[36px] md:text-[48px] leading-[1.05]">{business.name}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-muted">
          <span>
            {business.published ? d.livePage : d.draftPage}{" "}
            <a href={livePath} target="_blank" rel="noopener noreferrer" className="text-ink underline">
              sevrii.com{livePath}
            </a>
          </span>
          <div className="flex gap-2">
            <a href={livePath} target="_blank" rel="noopener noreferrer" className="dash-chip">
              {d.open}
            </a>
            <button type="button" onClick={copyLink} className="dash-chip">
              {copied ? d.copied : d.copyLink}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-12">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className="font-serif text-[34px] leading-none mb-2">{s.value}</div>
            <div className="text-[13px] text-muted">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Pillars */}
      <div className="mb-6">
        <h2 className="font-serif text-[28px] md:text-[34px] leading-[1.1] mb-2">{d.pillarsTitle}</h2>
        <p className="text-muted text-[15px] max-w-[620px]">{d.pillarsSub}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
        {pillars.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onNavigate(p.id)}
            className={`pillar-card text-left ${p.soon ? "is-soon" : ""}`}
          >
            <div className="flex items-center justify-between gap-3 mb-5">
              <span className="text-[14px] font-medium" style={{ color: ACCENT }}>
                {p.n}
              </span>
              <span className={p.soon ? "dash-soon" : "dash-active"}>{p.soon ? d.soon : d.active}</span>
            </div>
            <h3 className="text-[24px] font-[450] mb-2">{p.name}</h3>
            <p className="text-[14px] text-muted leading-relaxed mb-6">{p.desc}</p>
            <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
              <span className="text-[13px] text-mutedLight">{p.metric}</span>
              <span className="text-[14px] font-semibold text-ink whitespace-nowrap">{p.cta} →</span>
            </div>
          </button>
        ))}
      </div>

      {/* Next steps */}
      <div className="card">
        <h2 className="text-[17px] font-semibold mb-4">{d.nextSteps}</h2>
        <div className="flex flex-col">
          {steps.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4 py-3 border-b border-border">
              <span className="text-[14px]">{s.label}</span>
              <button type="button" onClick={() => onNavigate(s.go)} className="dash-chip">
                {d.go}
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 py-3">
            <span className="text-[14px]">{d.stepShare}</span>
            <button type="button" onClick={copyLink} className="dash-chip">
              {copied ? d.copied : d.copyLink}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
