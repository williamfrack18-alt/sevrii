"use client";

import { useState } from "react";
import { useLang } from "@/components/LangProvider";
import { MK_TEXT } from "@/lib/marketingI18n";
import { maxDailySpend, type CampaignSpec } from "@/lib/marketing";
import { sendMarketingChatAction } from "@/app/marketingActions";
import ChatPanel, { type Msg } from "./ChatPanel";
import { toClientBusiness, type ClientBusiness, type ClientCampaign } from "./types";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

// Marketing = the same clean chat as Store. The strategy and campaigns the
// brain builds appear right below it.
export default function MarketingView({
  business,
  campaigns,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
}: {
  business: ClientBusiness;
  campaigns: ClientCampaign[];
  initialMessages: Msg[];
  greeting: string;
  onUpdated: (business: ClientBusiness, campaigns: ClientCampaign[]) => void;
  onMessages?: (m: Msg[]) => void;
}) {
  const lang = useLang();
  const t = MK_TEXT[lang];
  const strategy = business.marketing.strategy;
  const withSpec = campaigns.filter((c) => c.spec);

  return (
    <div style={{ background: "#000" }}>
      <section className="h-[calc(100dvh-118px)] md:h-screen flex flex-col">
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between">
          <span className="text-[17px] font-semibold text-white">
            Sevrii <span className="text-[#8e8e8e] font-normal">· Marketing</span>
          </span>
          {withSpec.length > 0 && (
            <a href="#mk-plan" className="text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
              {withSpec.length} {t.campaigns.toLowerCase()}
            </a>
          )}
        </div>
        <ChatPanel
          greeting={greeting}
          initialMessages={initialMessages}
          texts={{ ...t.chat, seeBelowHref: "#mk-plan" }}
          onSend={async (text) => {
            const res = await sendMarketingChatAction(text);
            onMessages?.(res.messages);
            onUpdated(
              toClientBusiness(res.business),
              res.campaigns.map((c) => ({
                id: c.id,
                title: c.title,
                goal: c.goal,
                status: c.status,
                adCopy: c.adCopy,
                budgetNote: c.budgetNote,
                audience: c.audience,
                platforms: c.platforms,
                variations: c.variations,
                spec: c.spec ?? null,
              }))
            );
            return res.messages;
          }}
        />
      </section>

      <section id="mk-plan" className="px-4 md:px-8 pt-8 pb-14" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-[1100px] mx-auto flex flex-col gap-10">
          <div>
            <h2 className="text-[20px] font-semibold text-white mb-4">{t.plan}</h2>
            {!strategy ? (
              <p className="text-[14.5px] text-[#8e8e8e]">{t.planEmpty}</p>
            ) : (
              <div className="flex flex-col gap-5">
                <p className="text-[15.5px] leading-relaxed text-[#ececec] max-w-[760px]">{strategy.summary}</p>
                {strategy.stages.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {strategy.stages.map((s, i) => (
                      <div key={i} className="rounded-2xl p-5 flex flex-col gap-2" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.07)" }}>
                        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "#3ddc84" }}>
                          {i + 1} · {t.stages[s.stage]}
                        </span>
                        <span className="text-[15.5px] font-semibold text-white">{s.title}</span>
                        <span className="text-[12.5px] text-[#8e8e8e]">{s.channel}</span>
                        <span className="text-[14px] text-[#d4d4d4] leading-relaxed">{s.message}</span>
                        <span className="text-[13px] text-[#a1a1aa] leading-relaxed">→ {s.action}</span>
                      </div>
                    ))}
                  </div>
                )}
                {strategy.budgetPlan && (
                  <p className="text-[14px] text-[#a1a1aa]">
                    <span className="text-white font-medium">{t.budget}:</span> {strategy.budgetPlan}
                  </p>
                )}
              </div>
            )}
          </div>

          {withSpec.length > 0 && (
            <div>
              <h2 className="text-[20px] font-semibold text-white mb-4">{t.campaigns}</h2>
              <div className="flex flex-col gap-5">
                {withSpec.map((c) => (
                  <CampaignCard key={c.id} campaign={c} spec={c.spec as CampaignSpec} business={business} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const t = MK_TEXT[useLang()];
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="text-[12px] px-2.5 py-1 rounded-full text-[#d4d4d4] hover:text-white"
      style={{ background: "rgba(255,255,255,0.07)" }}
      onClick={() =>
        navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => {})
      }
    >
      {done ? t.copied : t.copy}
    </button>
  );
}

function CampaignCard({ campaign, spec, business }: { campaign: ClientCampaign; spec: CampaignSpec; business: ClientBusiness }) {
  const t = MK_TEXT[useLang()];
  const image = business.site.coverUrl || business.site.gallery[0] || "";
  const total = spec.dailyBudgetUsd * spec.durationDays;
  const cta = t.cta[spec.destination];

  return (
    <div className="rounded-3xl p-5 md:p-6 flex flex-col gap-5" style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[17px] font-semibold text-white">{campaign.title}</span>
          <span className="text-[13.5px] text-[#a1a1aa]">{campaign.goal}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="text-[11.5px] px-2.5 py-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)", color: "#d4d4d4" }}>
            {t.draft}
          </span>
          <span className="text-[11.5px] px-2.5 py-1 rounded-full" style={{ background: "rgba(255,196,0,0.12)", color: "#ffc400" }}>
            {t.autoSoon}
          </span>
        </div>
      </div>

      {/* Key facts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[13.5px]">
        <Fact k={t.platform[spec.platform]} v={t.objective[spec.objective]} />
        <Fact k={t.audience} v={`${t.area(spec.city, spec.radiusMiles)} · ${t.ages(spec.ageMin, spec.ageMax)} · ${t.language[spec.language]}`} />
        <Fact k={t.daily} v={`${usd(spec.dailyBudgetUsd)} × ${t.duration(spec.durationDays)}`} />
        <Fact k={t.total} v={usd(total)} />
      </div>
      {spec.platform === "meta" && <p className="text-[12.5px] text-[#8e8e8e] -mt-2">{t.maxDay(usd(maxDailySpend(spec.dailyBudgetUsd)))}</p>}
      {spec.specialCategory !== "none" && (
        <p className="text-[13px] rounded-xl px-3.5 py-2.5" style={{ background: "rgba(255,196,0,0.1)", color: "#ffd75e" }}>
          {t.special(t.specialNames[spec.specialCategory])}
        </p>
      )}

      {/* Ads */}
      {spec.platform === "meta" && spec.ads.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {spec.ads.map((ad, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-[#8e8e8e]">{t.variation(i + 1)}</span>
                <CopyButton text={`${ad.primaryText}\n\n${ad.headline}${ad.description ? `\n${ad.description}` : ""}`} />
              </div>
              {/* Facebook/Instagram feed preview */}
              <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", color: "#1c1e21" }}>
                <div className="flex items-center gap-2.5 px-3 pt-3">
                  <span className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: business.accentColor === "#122118" ? "#234f36" : business.accentColor }}>
                    {business.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="leading-tight">
                    <div className="text-[13px] font-semibold">{business.name}</div>
                    <div className="text-[11px] text-[#65676b]">{t.sponsored}</div>
                  </div>
                </div>
                <p className="px-3 py-2.5 text-[13.5px] leading-snug whitespace-pre-line">{ad.primaryText}</p>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="w-full aspect-[1.91/1] object-cover" />
                ) : (
                  <div className="w-full aspect-[1.91/1] flex items-center justify-center text-white text-[15px] font-semibold px-6 text-center" style={{ background: "linear-gradient(135deg,#234f36,#0b1a12)" }}>
                    {business.site.headline || business.name}
                  </div>
                )}
                <div className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ background: "#f0f2f5" }}>
                  <div className="min-w-0">
                    <div className="text-[11px] text-[#65676b] uppercase truncate">sevrii.com</div>
                    <div className="text-[13.5px] font-semibold truncate">{ad.headline}</div>
                  </div>
                  <span className="shrink-0 text-[12.5px] font-semibold px-3 py-1.5 rounded-md" style={{ background: "#e4e6eb" }}>
                    {cta}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {spec.platform === "google" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl p-4 flex flex-col gap-1 self-start" style={{ background: "#fff", color: "#202124" }}>
            <span className="text-[12px]">
              <b>{t.googleSponsored}</b> · sevrii.com/site/{business.slug}
            </span>
            <span className="text-[18px] leading-snug" style={{ color: "#1a0dab" }}>
              {spec.headlines.slice(0, 3).join(" | ")}
            </span>
            <span className="text-[13.5px] text-[#4d5156]">{spec.descriptions.slice(0, 2).join(" ")}</span>
          </div>
          <div className="flex flex-col gap-3 text-[13.5px]">
            <ListBlock title={t.headlines} items={spec.headlines} />
            <ListBlock title={t.descriptions} items={spec.descriptions} />
            <ListBlock title={t.keywords} items={spec.keywords} />
            {spec.negativeKeywords.length > 0 && <ListBlock title={t.negatives} items={spec.negativeKeywords} />}
          </div>
        </div>
      )}

      {spec.notes && (
        <p className="text-[13.5px] text-[#d4d4d4]">
          <span className="text-white font-medium">{t.note}:</span> {spec.notes}
        </p>
      )}

      <details className="group">
        <summary className="cursor-pointer list-none text-[13.5px] text-[#a1a1aa] hover:text-white">
          {t.howTo} <span className="inline-block transition group-open:rotate-90">›</span>
        </summary>
        <ol className="mt-3 flex flex-col gap-1.5 text-[13.5px] text-[#d4d4d4] list-decimal pl-5">
          {(spec.platform === "meta" ? t.metaSteps : t.googleSteps).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-xl px-3.5 py-3" style={{ background: "#171717" }}>
      <div className="text-[11.5px] text-[#8e8e8e] mb-0.5">{k}</div>
      <div className="text-white leading-snug">{v}</div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] text-[#8e8e8e]">{title}</span>
        <CopyButton text={items.join("\n")} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <span key={x} className="text-[12.5px] px-2.5 py-1 rounded-full text-[#ececec]" style={{ background: "#1c1c1c" }}>
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}
