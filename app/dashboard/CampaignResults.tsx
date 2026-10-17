"use client";

import { useState } from "react";
import { MK_TEXT } from "@/lib/marketingI18n";
import type { CampaignStats } from "@/lib/db";

// A campaign card's results block: its tracking link (to paste in the ad) and
// what it brought: visits, chats and contacts, with this week's numbers.
export default function CampaignResults({
  campaignId,
  link,
  stats,
  week,
  lang,
}: {
  campaignId: string;
  link: string;
  stats?: CampaignStats;
  week?: CampaignStats;
  lang: "es" | "en";
}) {
  const t = MK_TEXT[lang].results;
  const [copied, setCopied] = useState(false);
  const all = stats ?? { views: 0, chats: 0, contacts: 0 };
  const wk = week ?? { views: 0, chats: 0, contacts: 0 };
  const nums: { k: keyof CampaignStats; label: string }[] = [
    { k: "views", label: t.views },
    { k: "chats", label: t.chats },
    { k: "contacts", label: t.contacts },
  ];

  const copy = () => {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(done).catch(() => {});
    }
  };

  return (
    <div
      data-campaign={campaignId}
      className="rounded-2xl p-4 flex flex-col gap-4"
      style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}
    >
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-white">{t.linkLabel}</span>
        <div className="flex items-center gap-2 min-w-0">
          <input
            readOnly
            value={link}
            aria-label={t.linkLabel}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 h-9 px-3 rounded-xl text-[12.5px] text-[#d4d4d4] outline-none font-mono"
            style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}
          />
          <button
            type="button"
            onClick={copy}
            className="shrink-0 h-9 px-3.5 rounded-xl text-[12.5px] font-medium text-[#d4d4d4] hover:text-white"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            {copied ? t.copied : t.copy}
          </button>
        </div>
        <span className="text-[11.5px] text-[#8e8e8e] leading-snug">{t.linkHint}</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {nums.map(({ k, label }) => (
          <div key={k} className="rounded-xl px-3 py-2.5 flex flex-col gap-0.5" style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}>
            <span className="text-[11.5px] text-[#a1a1a1]">{label}</span>
            <span className="text-[20px] font-semibold text-white tabular-nums leading-tight">{all[k].toLocaleString("en-US")}</span>
            <span className="text-[11px] text-[#8e8e8e] tabular-nums">{t.thisWeek(wk[k])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
