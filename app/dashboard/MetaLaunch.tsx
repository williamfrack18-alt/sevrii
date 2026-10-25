"use client";

import { useEffect, useState } from "react";
import type { CampaignMeta } from "@/lib/db";
import {
  getMetaCampaignAction,
  launchCampaignOnMetaAction,
  refreshCampaignStatsAction,
  setCampaignMetaStatusAction,
  type MetaCampaignInfo,
  type MetaResult,
} from "@/app/metaActions";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

const TEXT = {
  es: {
    create: "Crear en Facebook (en pausa)",
    creating: "Creando…",
    createLine: "Se crea pausada; no gasta nada hasta que toques Activar.",
    retry: "Intentar de nuevo",
    paused: "En pausa",
    active: "Activa",
    error: "Error",
    activate: "Activar",
    pause: "Pausar",
    confirm: (max: string, days: number) => `Meta empezará a cobrarte hasta ${max} al día por ${days} día${days === 1 ? "" : "s"}. ¿Activar?`,
    budgetNote: (daily: string) => `Presupuesto diario ${daily}; algunos días Meta puede gastar hasta 75% más, sin pasarse del total de la semana.`,
    yes: "Sí, activar",
    cancel: "Cancelar",
    spend: "Gasto",
    impressions: "Impresiones",
    clicks: "Clics",
    refresh: "Actualizar",
    updated: (d: string) => `Actualizado ${d}`,
    onMeta: "En Facebook e Instagram",
    failed: "No se pudo completar. Inténtalo de nuevo.",
  },
  en: {
    create: "Create on Facebook (paused)",
    creating: "Creating…",
    createLine: "It's created paused; it spends nothing until you tap Activate.",
    retry: "Try again",
    paused: "Paused",
    active: "Active",
    error: "Error",
    activate: "Activate",
    pause: "Pause",
    confirm: (max: string, days: number) => `Meta will start charging you up to ${max} a day for ${days} day${days === 1 ? "" : "s"}. Activate?`,
    budgetNote: (daily: string) => `Daily budget ${daily}; on some days Meta may spend up to 75% more, without going over the weekly total.`,
    yes: "Yes, activate",
    cancel: "Cancel",
    spend: "Spend",
    impressions: "Impressions",
    clicks: "Clicks",
    refresh: "Refresh",
    updated: (d: string) => `Updated ${d}`,
    onMeta: "On Facebook and Instagram",
    failed: "Couldn't finish. Try again.",
  },
};

const ghost = { background: "rgba(10,10,10,0.068)", color: "#0A0A0A" };

export default function MetaLaunch({
  campaign,
  lang,
}: {
  campaign: { id: string; meta?: CampaignMeta | null; platform: string };
  lang: "es" | "en";
}) {
  const t = TEXT[lang];
  const isMeta = campaign.platform === "meta";
  const [info, setInfo] = useState<MetaCampaignInfo | null>(null);
  const [meta, setMeta] = useState<CampaignMeta | null>(campaign.meta ?? null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!isMeta) return;
    let live = true;
    getMetaCampaignAction(campaign.id)
      .then((r) => {
        if (!live || !r) return;
        setInfo(r);
        setMeta(r.meta);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [campaign.id, isMeta]);

  if (!isMeta || !info || !info.ready || !info.connected) return null;

  async function run(fn: () => Promise<MetaResult>) {
    setBusy(true);
    setNote("");
    try {
      const r = await fn();
      if ("error" in r) setNote(r.error);
      else setMeta(r.meta);
      if ("error" in r && !meta?.campaignId) {
        // A failed launch is saved as an error; show it as such.
        setMeta((m) => m ?? { campaignId: "", adSetId: "", adId: "", status: "error", error: r.error, launchedAt: new Date().toISOString() });
      }
    } catch {
      setNote(t.failed);
    } finally {
      setBusy(false);
    }
  }

  const launched = Boolean(meta?.campaignId);

  if (!launched) {
    return (
      <div className="rounded-xl p-4 flex flex-col gap-2" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.06)" }}>
        {meta?.status === "error" && meta.error && !note && <p className="text-[12.5px]" style={{ color: "#92400E" }}>{meta.error}</p>}
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => launchCampaignOnMetaAction(campaign.id))}
            className="h-10 px-5 rounded-full text-[13.5px] font-semibold disabled:opacity-60"
            style={BRAND_BTN}
          >
            {busy ? t.creating : meta?.status === "error" ? t.retry : t.create}
          </button>
        </div>
        <p className="text-[12.5px] text-psub">{t.createLine}</p>
        {note && <p className="text-[12.5px]" style={{ color: "#92400E" }}>{note}</p>}
      </div>
    );
  }

  const m = meta!;
  const chip =
    m.status === "active"
      ? { label: t.active, style: { background: TINT, color: ACCENT } }
      : m.status === "error"
        ? { label: t.error, style: { background: "rgba(255,196,0,.12)", color: "#ffc400" } }
        : { label: t.paused, style: { background: "rgba(10,10,10,0.068)", color: "#52525B" } };
  const when = m.stats?.at ? new Date(m.stats.at).toLocaleString(lang === "es" ? "es-US" : "en-US", { dateStyle: "short", timeStyle: "short" }) : "";

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.06)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-pfg">{t.onMeta}</span>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={chip.style}>
          {chip.label}
        </span>
      </div>
      {m.error && <p className="text-[12.5px]" style={{ color: "#92400E" }}>{m.error}</p>}

      {confirm ? (
        <div className="flex flex-col gap-2 rounded-lg p-3" style={{ background: "rgba(255,196,0,.08)" }}>
          <p className="text-[13px] text-pfg leading-relaxed">{t.confirm(usd(info.maxDailyUsd), info.durationDays)}</p>
          <p className="text-[12px] text-psub">{t.budgetNote(usd(info.dailyBudgetUsd))}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setCampaignMetaStatusAction(campaign.id, "active")).then(() => setConfirm(false))}
              className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
              style={BRAND_BTN}
            >
              {t.yes}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="h-9 px-4 rounded-full text-[13px] disabled:opacity-60" style={ghost}>
              {t.cancel}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {m.status === "active" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => setCampaignMetaStatusAction(campaign.id, "paused"))}
              className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
              style={ghost}
            >
              {t.pause}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirm(true)} className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
              {t.activate}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          [t.spend, m.stats ? usd(m.stats.spend) : "—"],
          [t.impressions, m.stats ? m.stats.impressions.toLocaleString("en-US") : "—"],
          [t.clicks, m.stats ? m.stats.clicks.toLocaleString("en-US") : "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg px-3 py-2" style={{ background: "#FFFFFF" }}>
            <div className="text-[11.5px] text-pmuted">{k}</div>
            <div className="text-[15px] font-semibold text-pfg">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => refreshCampaignStatsAction(campaign.id))}
          className="h-8 px-3 rounded-full text-[12.5px] disabled:opacity-60"
          style={{ background: TINT, color: ACCENT }}
        >
          {t.refresh}
        </button>
        {when && <span className="text-[12px] text-pmuted">{t.updated(when)}</span>}
      </div>
      {note && <p className="text-[12.5px]" style={{ color: "#92400E" }}>{note}</p>}
    </div>
  );
}
