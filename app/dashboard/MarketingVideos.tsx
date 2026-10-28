"use client";

// «Mis videos»: the AI videos the marketing chat planned, made and published.
// The chat is where things are said and decided; this is where the results are
// seen. Cards in the chat: the OK for one proposal, and a video being made
// (with the live view when the owner has to sign in, pay or solve a check).

import { useState } from "react";
import type { PublicVideo } from "@/lib/marketingVideos";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/panel";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const num = (n: number) => n.toLocaleString("en-US");
const CARD = { background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -18px rgba(10,10,10,.16), 0 0 0 1px rgba(10,10,10,.06)" };

export function videoStatus(v: PublicVideo, es: boolean): { label: string; tone: "green" | "gray" | "amber" | "red" } {
  if (v.status === "making" && v.waiting) return { label: es ? "Te necesita" : "Needs you", tone: "amber" };
  switch (v.status) {
    case "planned":
      return { label: es ? "Planeado" : "Planned", tone: "gray" };
    case "making":
      return { label: es ? "Creando" : "Making", tone: "amber" };
    case "ready":
      return { label: es ? "Listo para publicar" : "Ready to publish", tone: "green" };
    case "launching":
      return { label: es ? "Publicando" : "Publishing", tone: "amber" };
    case "active":
      return { label: es ? "Activo" : "Active", tone: "green" };
    case "paused":
      return { label: es ? "Pausado" : "Paused", tone: "gray" };
    case "ended":
      return { label: es ? "Terminado" : "Ended", tone: "gray" };
    default:
      return { label: es ? "No se pudo" : "Couldn't make it", tone: "red" };
  }
}

function Badge({ v, es }: { v: PublicVideo; es: boolean }) {
  const s = videoStatus(v, es);
  const style =
    s.tone === "green"
      ? { background: TINT, color: ACCENT }
      : s.tone === "amber"
        ? { background: "rgba(245,158,11,0.12)", color: "#B45309" }
        : s.tone === "red"
          ? { background: "rgba(220,38,38,0.08)", color: "#B91C1C" }
          : { background: "rgba(10,10,10,0.06)", color: "#52525B" };
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-medium whitespace-nowrap" style={style}>
      {(v.status === "making" || v.status === "launching") && <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "currentColor" }} />}
      {s.label}
    </span>
  );
}

function Preview({ v, es, className }: { v: PublicVideo; es: boolean; className: string }) {
  if (v.videoUrl) {
    return <video src={v.videoUrl} muted playsInline loop preload="metadata" controls className={`${className} bg-black object-cover`} />;
  }
  return (
    <div className={`${className} flex flex-col items-center justify-center gap-2 text-center px-4`} style={{ background: "linear-gradient(160deg,#F3F4F1,#E9ECE6)" }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="13" height="14" rx="2.5" />
        <path d="M16 10l5-3v10l-5-3z" />
      </svg>
      <span className="text-[12px] text-psub">{v.status === "making" ? (es ? "Se está creando…" : "Being made…") : v.status === "failed" ? (es ? "Sin video" : "No video") : es ? "Aún sin crear" : "Not made yet"}</span>
    </div>
  );
}

export function VideoGallery({ videos, es, focusId, onPick, onAsk }: { videos: PublicVideo[]; es: boolean; focusId: string | null; onPick: (v: PublicVideo) => void; onAsk: (text: string) => void }) {
  return (
    <section id="mis-videos" className="px-4 md:px-6 pt-8 pb-16 md:pb-20">
      <div className="max-w-[1100px] mx-auto flex flex-col gap-5">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1">
            <h2 className="text-[22px] md:text-[26px] font-semibold tracking-[-0.02em] text-pfg">{es ? "Mis videos" : "My videos"}</h2>
            <p className="text-[14px] text-psub">
              {es ? "Toca un video para hablar de él en el chat: «pausa este» o «haz otro parecido»." : "Tap a video to talk about it in the chat: “pause this one” or “make another like it”."}
            </p>
          </div>
        </div>
        {videos.length === 0 ? (
          <div className="rounded-[24px] p-7 flex flex-col items-start gap-3" style={CARD}>
            <p className="text-[15px] text-pfg">{es ? "Todavía no hay videos." : "No videos yet."}</p>
            <p className="text-[14px] text-psub leading-relaxed">
              {es
                ? "Pídele al chat de Marketing videos para tus anuncios: te propone cuántos, el ángulo de cada uno y el presupuesto, y nada se crea ni se publica sin tu OK."
                : "Ask the Marketing chat for videos for your ads: it proposes how many, each one's angle and the budget, and nothing is made or published without your OK."}
            </p>
            <button type="button" onClick={() => onAsk(es ? "Quiero videos para mis anuncios. ¿Qué me recomiendas?" : "I want videos for my ads. What do you recommend?")} className="h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
              {es ? "Pedir videos en el chat" : "Ask for videos in the chat"}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {videos.map((v) => {
              const onMeta = ["active", "paused", "ended"].includes(v.status);
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(v)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(v))}
                  className="tap text-left rounded-[20px] overflow-hidden flex flex-col cursor-pointer transition hover:-translate-y-0.5 outline-none focus-visible:ring-2"
                  style={{ ...CARD, ...(focusId === v.id ? { boxShadow: `0 0 0 2px ${ACCENT}, 0 10px 30px -18px rgba(10,10,10,.2)` } : {}) }}
                  aria-label={es ? `Hablar de ${v.title} en el chat` : `Talk about ${v.title} in the chat`}
                >
                  <div onClick={(e) => v.videoUrl && e.stopPropagation()}>
                    <Preview v={v} es={es} className="w-full aspect-[9/14]" />
                  </div>
                  <div className="p-3 md:p-3.5 flex flex-col gap-2 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span className="text-[14px] font-medium text-pfg leading-snug line-clamp-2 min-w-0">{v.title}</span>
                    </div>
                    <Badge v={v} es={es} />
                    <div className="grid grid-cols-3 gap-1 pt-1">
                      <Stat k={es ? "Vistas" : "Views"} v={onMeta ? num(v.stats.views) : "—"} />
                      <Stat k={es ? "Mensajes" : "Messages"} v={onMeta ? num(v.stats.chats) : "—"} />
                      <Stat k={es ? "Gasto" : "Spent"} v={onMeta ? usd(v.stats.spend) : "—"} />
                    </div>
                    {v.dailyUsd !== null && onMeta && <span className="text-[12px] text-pmuted">{es ? `${usd(v.dailyUsd)} al día` : `${usd(v.dailyUsd)} a day`}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col min-w-0">
      <span className="text-[14px] font-semibold text-pfg tabular-nums truncate">{v}</span>
      <span className="text-[11px] text-pmuted truncate">{k}</span>
    </div>
  );
}

// The OK for one proposal (only while it's the one waiting).
export function ActionCard({ summary, es, onOk, onNo }: { summary: string; es: boolean; onOk: () => Promise<void>; onNo: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-[20px] p-4 md:p-5 flex flex-col gap-3 max-w-[560px]" style={CARD}>
      <span className="text-[12px] font-semibold uppercase tracking-[0.06em]" style={{ color: ACCENT }}>
        {es ? "Necesita tu OK" : "Needs your OK"}
      </span>
      <p className="text-[14.5px] text-pfg leading-relaxed">{summary}</p>
      <p className="text-[12.5px] text-psub">{es ? "Tu OK vale solo para esto. También puedes decir «dale»." : "Your OK covers only this. You can also say “go ahead”."}</p>
      <div className="flex gap-2 flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onOk();
            } finally {
              setBusy(false);
            }
          }}
          className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60"
          style={BRAND_BTN}
        >
          {busy ? (es ? "Haciéndolo…" : "Doing it…") : es ? "Sí, hazlo" : "Yes, do it"}
        </button>
        <button type="button" disabled={busy} onClick={onNo} className="h-10 px-5 rounded-full text-[14px] font-medium text-pfg bg-pcard" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.1)" }}>
          {es ? "Cambiar algo" : "Change something"}
        </button>
      </div>
    </div>
  );
}

// A video in the chat: its progress, the live view when the owner is needed, and the result.
export function VideoJobCard({ v, es, live, onReply }: { v: PublicVideo; es: boolean; live: boolean; onReply: (reply: "done" | "stop") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const w = live ? v.waiting : null;
  const reply = async (r: "done" | "stop") => {
    setBusy(true);
    try {
      await onReply(r);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-[20px] p-4 md:p-5 flex flex-col gap-3 max-w-[560px]" style={CARD}>
      <div className="flex items-center justify-between gap-3 min-w-0">
        <span className="text-[14.5px] font-medium text-pfg truncate min-w-0">{v.title}</span>
        <Badge v={v} es={es} />
      </div>
      <span className="text-[12.5px] text-psub">{v.toolName}</span>
      {v.videoUrl && <video src={v.videoUrl} controls playsInline preload="metadata" className="w-full max-w-[260px] rounded-2xl bg-black aspect-[9/16] object-cover" />}
      {live && v.steps.length > 0 && v.status === "making" && (
        <ul className="flex flex-col gap-1.5">
          {v.steps.map((s, i) => (
            <li key={i} className="flex items-center gap-2 text-[13px] text-pfg2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${s.status === "doing" ? "animate-pulse" : ""}`} style={{ background: s.status === "failed" ? "#DC2626" : s.status === "done" ? ACCENT : "#F59E0B" }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {w && (
        <div className="flex flex-col gap-2.5 rounded-2xl p-3.5" style={{ background: "rgba(245,158,11,0.07)", boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.22)" }}>
          <p className="text-[14px] text-pfg leading-relaxed">{w.label}</p>
          {w.detail && <p className="text-[13px] text-pfg2 leading-relaxed">{w.detail}</p>}
          {w.url && /browserbase/.test(w.url) && (
            <iframe src={w.url} title={w.label} className="w-full h-[420px] md:h-[520px] rounded-xl bg-white" sandbox="allow-same-origin allow-scripts allow-forms allow-popups" allow="clipboard-read; clipboard-write" />
          )}
          <p className="text-[12px] text-psub">{es ? "Lo que escribas en la vista en vivo no lo veo ni lo guardo." : "What you type in the live view isn't seen or kept by me."}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={busy} onClick={() => reply("done")} className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-60" style={BRAND_BTN}>
              {es ? "Listo, sigue" : "Done, continue"}
            </button>
            <button type="button" disabled={busy} onClick={() => reply("stop")} className="h-10 px-5 rounded-full text-[14px] font-medium text-pfg bg-pcard" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.1)" }}>
              {es ? "Dejarlo" : "Stop"}
            </button>
          </div>
        </div>
      )}
      {v.error && (v.status === "failed" || v.status === "ready") && live && <p className="text-[12.5px] text-[#B91C1C]">{v.error}</p>}
    </div>
  );
}
