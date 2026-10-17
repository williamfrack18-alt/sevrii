"use client";

import { useEffect, useRef, useState } from "react";
import StoreChat from "./StoreChat";
import { useT, useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { fillStoreFromPlanAction, setPublishedAction } from "@/app/storeActions";
import { planFingerprint, planReadyForStore } from "@/lib/planToStore";
import type { PublishGap } from "@/lib/site";
import { MARKET_CATEGORY_EN, type MarketCategory } from "@/lib/marketCategories";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

// Store = one clean chat (like ChatGPT). The live page sits right below it.
export default function StoreView({
  business,
  services,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  canPublish = true,
  onPlans,
  onChats,
}: {
  onChats?: () => void;
  canPublish?: boolean;
  onPlans?: () => void;
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: { id: string; role: string; content: string }[]) => void;
}) {
  const t = useT();
  const lang = useLang();
  const st = STORE_TEXT[lang].editor;
  const lk = PLANS_TEXT[lang].lock;
  const [previewKey, setPreviewKey] = useState(0);
  const [frameH, setFrameH] = useState(1100);
  const frameRef = useRef<HTMLIFrameElement>(null);

  // The preview shows the whole page at its real height (no scroll inside the
  // frame), so one scroll moves everything and the top of the page is never skipped.
  function fitFrame() {
    const f = frameRef.current;
    try {
      const doc = f?.contentDocument;
      if (!f || !doc) return;
      const measure = () => {
        const h = Math.max(doc.body?.scrollHeight ?? 0, doc.documentElement?.scrollHeight ?? 0);
        if (h > 200) setFrameH((cur) => (Math.abs(cur - h) > 4 ? h : cur));
      };
      measure();
      const ro = new ResizeObserver(measure);
      if (doc.body) ro.observe(doc.body);
      f.addEventListener("load", () => ro.disconnect(), { once: true });
      [400, 1200, 3000].forEach((ms) => setTimeout(measure, ms));
    } catch {
      // never block the preview
    }
  }

  // Scrolling down from the chat stops for a moment at the top of the page,
  // so the owner sees its beginning before moving on.
  useEffect(() => {
    const page = document.getElementById("store-page");
    if (!page) return;
    const pageTop = () => page.getBoundingClientRect().top + window.scrollY;
    let lockUntil = 0;
    let paused = false;
    let lastY = window.scrollY;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY <= 0) return;
      if (Date.now() < lockUntil) {
        e.preventDefault();
        return;
      }
      const t = pageTop();
      const y = window.scrollY;
      if (!paused && y < t - 2 && y + e.deltaY > t - 2) {
        e.preventDefault();
        window.scrollTo({ top: t });
        paused = true;
        lockUntil = Date.now() + 700;
      }
    };
    // Touch / momentum: if the scroll jumps past the top of the page, bring it back once.
    const onScroll = () => {
      const t = pageTop();
      const y = window.scrollY;
      if (y < t - 60) paused = false;
      if (!paused && lastY < t - 2 && y > t + 2) {
        paused = true;
        lockUntil = Date.now() + 700;
        window.scrollTo({ top: t });
      }
      lastY = window.scrollY;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "gaps"; gaps: PublishGap[] } | { kind: "ok" } | { kind: "error" } | null>(null);

  async function publish(on: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const res = await setPublishedAction(on);
      if (res.upgrade) onPlans?.();
      else if (res.ok) {
        onUpdated(toClientBusiness(res.business), services);
        setPreviewKey((k) => k + 1);
        if (on) setNotice({ kind: "ok" });
      } else if (res.gaps.length) setNotice({ kind: "gaps", gaps: res.gaps });
      else setNotice({ kind: "error" });
    } catch {
      setNotice({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }
  const liveUrl = `/site/${business.slug}`;

  // The Brain's expediente is approved and the page doesn't reflect it yet.
  const fp = STORE_TEXT[lang].editor.fromPlan;
  const planPending = planReadyForStore(business.plan) && business.site.fromPlan !== planFingerprint(business.plan);
  const [filling, setFilling] = useState(false);
  const [fillError, setFillError] = useState(false);
  const [sync, setSync] = useState<{ key: number; messages: { id: string; role: string; content: string }[] } | undefined>();

  async function fillFromPlan() {
    setFilling(true);
    setFillError(false);
    try {
      const res = await fillStoreFromPlanAction();
      if (!res.ok) setFillError(true);
      onUpdated(
        toClientBusiness(res.business),
        res.services.map((x) => ({ id: x.id, name: x.name, price: x.price, description: x.description }))
      );
      setSync({ key: Date.now(), messages: res.messages });
      onMessages?.(res.messages);
      setPreviewKey((k) => k + 1);
    } catch {
      setFillError(true);
    } finally {
      setFilling(false);
    }
  }

  return (
    <div style={{ background: "#000" }}>
      {/* Chat: fills the screen, composer pinned at the bottom */}
      <section
        className={`${business.published ? "h-[calc(100dvh-var(--hdr))] md:h-screen" : "h-[calc(100dvh-var(--hdr)-44px)] md:h-[calc(100vh-44px)]"} flex flex-col`}
      >
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between">
          <span className="text-[17px] font-semibold text-white">
            Sevrii <span className="text-[#8e8e8e] font-normal">· Store</span>
          </span>
          <div className="flex items-center gap-2">
            {business.site.chat && (
              <button type="button" onClick={onChats} className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
                {lang === "es" ? "Conversaciones" : "Conversations"}
              </button>
            )}
            {business.published ? (
              <>
                {business.marketCategory && (
                  <a
                    href={lang === "es" ? "/#explorar" : "/en#explorar"}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium"
                    style={{ background: "rgba(255,255,255,.06)", color: "#d4d4d4" }}
                  >
                    {st.inMarket}: {lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}
                  </a>
                )}
                <a href="#store-page" className="text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: TINT, color: ACCENT }}>
                  {st.live}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(false)}
                  className="text-[12px] px-3 py-1 rounded-full font-medium disabled:opacity-50"
                  style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}
                >
                  {st.unpublish}
                </button>
              </>
            ) : canPublish ? (
              <>
                <a href="#store-page" className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
                  {st.draft}
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => publish(true)}
                  className="h-8 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
                  style={BRAND_BTN}
                >
                  {busy ? st.publishing : st.publish}
                </button>
              </>
            ) : (
              <>
                <a href="#store-page" className="hidden sm:inline-flex text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(255,255,255,.08)", color: "#d4d4d4" }}>
                  {st.draft}
                </a>
                <button type="button" onClick={onPlans} className="text-[12px] px-3 py-1 rounded-full font-semibold" style={{ background: TINT, color: ACCENT }}>
                  {lk.publishChip} →
                </button>
              </>
            )}
          </div>
        </div>
        {notice && (
          <div className="shrink-0 mx-4 md:mx-6 mb-2 rounded-xl px-4 py-3 text-[13.5px] text-[#ececec] flex items-start justify-between gap-3" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}>
            <div>
              {notice.kind === "gaps" ? (
                <>
                  <div className="font-medium">{st.gapsTitle}</div>
                  <ul className="mt-1 text-[#a1a1aa] list-disc pl-5">
                    {notice.gaps.map((g) => (
                      <li key={g}>{st.gaps[g]}</li>
                    ))}
                  </ul>
                </>
              ) : notice.kind === "ok" ? (
                <span>
                  <span style={{ color: ACCENT }}>✓ </span>
                  {st.publishedOk}
                  {business.marketCategory ? ` ${st.inMarket}: ${lang === "es" ? business.marketCategory : MARKET_CATEGORY_EN[business.marketCategory as MarketCategory] ?? business.marketCategory}.` : ""}
                </span>
              ) : (
                <span>{st.publishFailed}</span>
              )}
            </div>
            <button type="button" onClick={() => setNotice(null)} className="text-[#8e8e8e] text-[16px] leading-none" aria-label={st.close} title={st.close}>
              ×
            </button>
          </div>
        )}
        {planPending && (
          <div
            className="shrink-0 mx-4 md:mx-6 mb-2 rounded-2xl px-4 py-4 md:px-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5"
            style={{ background: "linear-gradient(135deg, rgba(46,122,85,.22), rgba(46,122,85,.08))", boxShadow: "0 0 0 1px rgba(46,122,85,.45)" }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-semibold text-white">{business.site.fromPlan ? fp.changedTitle : fp.newTitle}</div>
              <p className="text-[13.5px] text-[#c9c9c9] mt-0.5 leading-relaxed">{business.site.fromPlan ? fp.changedText : fp.newText}</p>
              <p className="text-[12.5px] text-[#8e8e8e] mt-1">
                {fp.keep}
                {services.length > 0 ? ` ${fp.replaceServices}` : ""}
              </p>
              {fillError && <p className="text-[12.5px] mt-1 text-red-400">{fp.failed}</p>}
            </div>
            <button
              type="button"
              disabled={filling}
              onClick={fillFromPlan}
              className="h-10 px-5 rounded-full text-[14px] font-semibold shrink-0 disabled:opacity-60 self-start sm:self-auto"
              style={BRAND_BTN}
            >
              {filling ? fp.building : business.site.fromPlan ? fp.update : fp.build}
            </button>
          </div>
        )}
        <StoreChat
          business={business}
          onBusiness={(b) => {
            onUpdated(b, services);
            setPreviewKey((k) => k + 1);
          }}
          sync={sync}
          greeting={greeting}
          initialMessages={initialMessages}
          onMessages={onMessages}
          onUpdated={(b, s) => {
            onUpdated(b, s);
            setPreviewKey((k) => k + 1);
          }}
        />
      </section>

      {/* While it's a draft: a quiet pointer to the page being built below. */}
      {!business.published && (
        <a
          href="#store-page"
          className="h-[44px] px-4 flex items-center justify-center gap-2 text-[13px] font-medium text-[#d4d4d4] hover:text-white transition-colors truncate"
          style={{ background: "rgba(46,122,85,.12)", borderTop: "1px solid rgba(46,122,85,.3)" }}
        >
          <span className="truncate">{st.belowHint}</span>
          <span aria-hidden="true" className="text-[#8e8e8e]">↓</span>
        </a>
      )}

      {/* The page, below the chat */}
      <section id="store-page" className="px-3 md:px-8 pt-6 pb-10" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="max-w-[1180px] mx-auto">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-[15px] font-semibold text-white">{st.yourPage}</h2>
            <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-muted hover:text-ink">
              {business.published ? t.dashboard.openLive : st.viewDraft} ↗
            </a>
          </div>
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
            <iframe
              ref={frameRef}
              key={`${business.slug}-${previewKey}`}
              src={liveUrl}
              title={t.dashboard.livePageTitle}
              scrolling="no"
              onLoad={fitFrame}
              className="w-full border-0 block"
              style={{ height: `${frameH}px` }}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
