"use client";

import { useEffect, useState } from "react";
import { ownerReviewsAction, replyReviewAction, reportReviewAction, type OwnerReview } from "@/app/reviewActions";
import { cachedView, loadView, putView } from "./viewCache";
import { ACCENT, INK } from "@/lib/panel";

const TEXT = {
  es: {
    title: "Reseñas",
    empty: "Todavía no tienes reseñas. Las deja el cliente que te pagó por Sevrii (al pagar crea su cuenta en segundos y luego puede reseñarte). En tu página no aparece nada hasta la primera.",
    summary: (avg: string, n: number) => `★ ${avg} · ${n} ${n === 1 ? "reseña" : "reseñas"} verificadas`,
    reply: "Responder en público",
    replyPh: "Gracias por tu reseña…",
    save: "Publicar respuesta",
    saving: "Guardando…",
    saved: "Respuesta publicada",
    report: "Reportar",
    reportPh: "¿Por qué es falsa u ofensiva?",
    reportSend: "Enviar reporte",
    reported: "Reportada: Sevrii la está revisando.",
    hidden: "Oculta por Sevrii",
    failed: "No se pudo. Inténtalo de nuevo.",
    close: "Cerrar",
    yourReply: "Tu respuesta",
  },
  en: {
    title: "Reviews",
    empty: "No reviews yet. They're left by customers who paid you through Sevrii (they create an account in seconds when paying, then they can review you). Nothing shows on your page until the first one.",
    summary: (avg: string, n: number) => `★ ${avg} · ${n} verified ${n === 1 ? "review" : "reviews"}`,
    reply: "Reply in public",
    replyPh: "Thanks for your review…",
    save: "Post reply",
    saving: "Saving…",
    saved: "Reply posted",
    report: "Report",
    reportPh: "Why is it fake or offensive?",
    reportSend: "Send report",
    reported: "Reported: Sevrii is reviewing it.",
    hidden: "Hidden by Sevrii",
    failed: "That didn't work. Try again.",
    close: "Close",
    yourReply: "Your reply",
  },
};

type State = { list: OwnerReview[]; avg: number | null; count: number };

// The owner's verified reviews: answer each one in public or report it.
export default function ReviewsPanel({ businessId, lang, onClose }: { businessId: string; lang: "es" | "en"; onClose: () => void }) {
  const t = TEXT[lang];
  const key = `reviews:${businessId}`;
  const [state, setState] = useState<State | null>(() => cachedView<State>(key));
  useEffect(() => {
    let alive = true;
    loadView(key, ownerReviewsAction)
      .then((s) => alive && s && setState(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  useEffect(() => {
    if (state) putView(key, state);
  }, [state, key]);

  const update = (id: string, patch: Partial<OwnerReview>) => setState((s) => (s ? { ...s, list: s.list.map((r) => (r.id === id ? { ...r, ...patch } : r)) } : s));

  return (
    <div className="shrink-0 mx-3 md:mx-4 mt-2.5 rounded-xl p-3 md:p-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.085)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-semibold" style={{ color: INK }}>
          {t.title}
          {state && state.count > 0 && state.avg !== null && <span className="ml-2 font-normal text-[13px]" style={{ color: "#B45309" }}>{t.summary(state.avg.toFixed(1), state.count)}</span>}
        </span>
        <button type="button" onClick={onClose} className="tap h-7 w-7 rounded-full text-[15px] leading-none text-pmuted hover:text-pfg" aria-label={t.close} title={t.close}>
          ×
        </button>
      </div>
      {state && state.list.length === 0 && <p className="text-[13px] text-psub leading-relaxed">{t.empty}</p>}
      {state?.list.map((r) => <ReviewItem key={r.id} r={r} t={t} lang={lang} onChange={(p) => update(r.id, p)} />)}
    </div>
  );
}

function ReviewItem({ r, t, lang, onChange }: { r: OwnerReview; t: (typeof TEXT)["es"]; lang: "es" | "en"; onChange: (p: Partial<OwnerReview>) => void }) {
  const [reply, setReply] = useState(r.reply);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", year: "numeric" }) : "";

  async function saveReply() {
    setBusy(true);
    setMsg("");
    try {
      const ok = await replyReviewAction(r.id, reply);
      if (ok) {
        onChange({ reply: reply.trim() });
        setEditing(false);
        setMsg(t.saved);
      } else setMsg(t.failed);
    } catch {
      setMsg(t.failed);
    }
    setBusy(false);
  }
  async function sendReport() {
    setBusy(true);
    setMsg("");
    try {
      const ok = await reportReviewAction(r.id, reason);
      if (ok) {
        onChange({ reported: true });
        setReporting(false);
      } else setMsg(t.failed);
    } catch {
      setMsg(t.failed);
    }
    setBusy(false);
  }

  return (
    <div className="rounded-lg p-3 flex flex-col gap-1.5" style={{ background: "rgba(10,10,10,0.034)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[15px] tracking-[2px]" style={{ color: "#F59E0B" }}>
          {"★★★★★".slice(0, r.rating)}
          <span style={{ color: "#D4D4D8" }}>{"★★★★★".slice(r.rating)}</span>
        </span>
        <span className="text-[12px] text-pmuted">
          {r.name} · {date}
        </span>
      </div>
      {r.text && <p className="text-[13.5px] leading-relaxed" style={{ color: INK }}>{r.text}</p>}
      {r.hidden && <p className="text-[12px] font-medium" style={{ color: "#B42318" }}>{t.hidden}</p>}
      {r.reported && !r.hidden && <p className="text-[12px]" style={{ color: "#B45309" }}>{t.reported}</p>}
      {r.reply && !editing && (
        <div className="rounded-md px-3 py-2 text-[13px]" style={{ background: "#fff" }}>
          <span className="block text-[11.5px] text-pmuted">{t.yourReply}</span>
          <span style={{ color: INK }}>{r.reply}</span>
        </div>
      )}
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea rows={2} maxLength={600} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t.replyPh} className="rounded-lg px-3 py-2 text-[16px] md:text-[13.5px] outline-none resize-none bg-white" style={{ border: "1px solid rgba(10,10,10,0.14)", color: INK }} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={saveReply} className="h-8 px-3.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-50" style={{ background: INK, color: "#fff" }}>
              {busy ? t.saving : t.save}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-8 px-3 rounded-lg text-[12.5px]" style={{ background: "rgba(10,10,10,0.051)", color: "#3F3F46" }}>
              {t.close}
            </button>
          </div>
        </div>
      ) : reporting ? (
        <div className="flex flex-col gap-2">
          <input maxLength={400} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reportPh} className="h-9 rounded-lg px-3 text-[16px] md:text-[13.5px] outline-none bg-white" style={{ border: "1px solid rgba(10,10,10,0.14)", color: INK }} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={sendReport} className="h-8 px-3.5 rounded-lg text-[12.5px] font-semibold disabled:opacity-50" style={{ background: "#B42318", color: "#fff" }}>
              {t.reportSend}
            </button>
            <button type="button" onClick={() => setReporting(false)} className="h-8 px-3 rounded-lg text-[12.5px]" style={{ background: "rgba(10,10,10,0.051)", color: "#3F3F46" }}>
              {t.close}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 text-[12.5px]">
          <button type="button" onClick={() => setEditing(true)} className="font-medium underline underline-offset-2" style={{ color: ACCENT }}>
            {t.reply}
          </button>
          {!r.reported && (
            <button type="button" onClick={() => setReporting(true)} className="text-pmuted underline underline-offset-2">
              {t.report}
            </button>
          )}
        </div>
      )}
      {msg && <span className="text-[12px]" style={{ color: msg === t.saved ? ACCENT : "#B42318" }}>{msg}</span>}
    </div>
  );
}
