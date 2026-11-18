"use client";

import { useEffect, useState } from "react";
import { pageStatsAction, saveMetaPixelAction, type PageStatsState } from "@/app/pageStatsActions";
import { cachedView, loadView, putView } from "./viewCache";
import { ACCENT, INK } from "@/lib/panel";

type Period = "today" | "week" | "month";

const TEXT = {
  es: {
    title: "Números de tu página",
    periods: { today: "Hoy", week: "7 días", month: "30 días" } as Record<Period, string>,
    views: "Visitas",
    uniques: "Visitantes únicos",
    chats: "Conversaciones",
    contacts: "Dejaron sus datos",
    orders: "Clics en «Pedir»",
    payments: "Pagos",
    draft: "Tu página está en borrador: los números empiezan cuando la publicas.",
    note: "No cuentan tus propias visitas. Los días van en hora UTC.",
    pixel: "Píxel de Meta (Facebook e Instagram)",
    pixelHelp: "Si haces anuncios en Facebook o Instagram, pega aquí el ID de tu píxel (solo números). Lo encuentras en el Administrador de eventos de Meta.",
    pixelPh: "Ej. 123456789012345",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    remove: "Quitar",
    pixelOn: (id: string) => `Píxel activo: ${id}. Mide las visitas, los contactos del chat y los pagos.`,
    invalid: "El ID del píxel son solo números (8 a 20).",
    failed: "No se pudo guardar. Inténtalo de nuevo.",
    close: "Cerrar",
  },
  en: {
    title: "Your page's numbers",
    periods: { today: "Today", week: "7 days", month: "30 days" } as Record<Period, string>,
    views: "Visits",
    uniques: "Unique visitors",
    chats: "Conversations",
    contacts: "Left their details",
    orders: "\"Order\" clicks",
    payments: "Payments",
    draft: "Your page is a draft: the numbers start when you publish it.",
    note: "Your own visits don't count. Days are in UTC.",
    pixel: "Meta pixel (Facebook and Instagram)",
    pixelHelp: "If you run ads on Facebook or Instagram, paste your pixel ID here (numbers only). You'll find it in Meta's Events Manager.",
    pixelPh: "e.g. 123456789012345",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    remove: "Remove",
    pixelOn: (id: string) => `Pixel on: ${id}. It measures visits, chat contacts and payments.`,
    invalid: "A pixel ID is numbers only (8 to 20).",
    failed: "Couldn't save. Try again.",
    close: "Close",
  },
};

// Visits, unique visitors, chats, contacts, "Pedir" clicks and payments of the
// page, plus the owner's own Meta pixel. Shown above the preview in Store.
export default function PageStatsPanel({ businessId, lang, onClose }: { businessId: string; lang: "es" | "en"; onClose: () => void }) {
  const t = TEXT[lang];
  const key = `pagestats:${businessId}`;
  const [state, setState] = useState<PageStatsState | null>(() => cachedView<PageStatsState>(key));
  const [period, setPeriod] = useState<Period>("week");
  const [pixel, setPixel] = useState("");
  const [saving, setSaving] = useState<"" | "busy" | "ok">("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    loadView(key, pageStatsAction)
      .then((s) => {
        if (!alive || !s) return;
        setState(s);
        setPixel(s.pixelId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);
  useEffect(() => {
    if (state) putView(key, state);
  }, [state, key]);

  async function save(value: string) {
    setSaving("busy");
    setErr("");
    try {
      const r = await saveMetaPixelAction(value);
      if (!r.ok) {
        setErr(r.error === "invalid" ? t.invalid : t.failed);
        setSaving("");
        return;
      }
      setPixel(r.pixelId);
      setState((s) => (s ? { ...s, pixelId: r.pixelId } : s));
      setSaving("ok");
    } catch {
      setErr(t.failed);
      setSaving("");
    }
  }

  const n = state?.[period];
  const fmt = (x: number | undefined) => (x === undefined ? "—" : x.toLocaleString(lang === "es" ? "es-US" : "en-US"));
  const items: [string, number | undefined][] = [
    [t.views, n?.views],
    [t.uniques, n?.uniques],
    [t.chats, n?.chats],
    [t.contacts, n?.contacts],
    [t.orders, n?.orders],
    [t.payments, n?.payments],
  ];

  return (
    <div className="shrink-0 mx-3 md:mx-4 mt-2.5 rounded-xl p-3 md:p-4 flex flex-col gap-3" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,0.085)" }}>
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <span className="text-[14px] font-semibold" style={{ color: INK }}>{t.title}</span>
        <div className="flex items-center gap-1">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className="tap h-7 px-3 rounded-full text-[12.5px] font-medium"
              style={period === p ? { background: INK, color: "#fff" } : { background: "rgba(10,10,10,0.051)", color: "#3F3F46" }}
            >
              {t.periods[p]}
            </button>
          ))}
          <button type="button" onClick={onClose} className="tap ml-1 h-7 w-7 rounded-full text-[15px] leading-none text-pmuted hover:text-pfg" aria-label={t.close} title={t.close}>
            ×
          </button>
        </div>
      </div>
      {state && !state.published && <p className="text-[12.5px] text-psub">{t.draft}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {items.map(([label, v]) => (
          <div key={label} className="rounded-lg px-3 py-2.5" style={{ background: "rgba(10,10,10,0.034)" }}>
            <div className="text-[11.5px] text-pmuted">{label}</div>
            <div className="text-[20px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>{fmt(v)}</div>
          </div>
        ))}
      </div>
      <p className="text-[11.5px] text-pfaint">{t.note}</p>

      <div className="pt-3 flex flex-col gap-2" style={{ borderTop: "1px solid rgba(10,10,10,0.068)" }}>
        <span className="text-[13px] font-semibold" style={{ color: INK }}>{t.pixel}</span>
        <p className="text-[12.5px] text-psub leading-relaxed">{state?.pixelId ? t.pixelOn(state.pixelId) : t.pixelHelp}</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(pixel);
          }}
        >
          <input
            value={pixel}
            onChange={(e) => {
              setPixel(e.target.value.replace(/[^\d]/g, "").slice(0, 20));
              setSaving("");
            }}
            inputMode="numeric"
            placeholder={t.pixelPh}
            className="flex-1 min-w-0 h-9 rounded-lg px-3 text-[16px] md:text-[13.5px] outline-none bg-transparent"
            style={{ border: "1px solid rgba(10,10,10,0.14)", color: INK }}
          />
          <button type="submit" disabled={saving === "busy"} className="h-9 px-4 rounded-lg text-[13px] font-semibold disabled:opacity-50" style={{ background: INK, color: "#fff" }}>
            {saving === "busy" ? t.saving : saving === "ok" ? t.saved : t.save}
          </button>
          {state?.pixelId && (
            <button type="button" disabled={saving === "busy"} onClick={() => save("")} className="h-9 px-3 rounded-lg text-[13px] disabled:opacity-50" style={{ background: "rgba(10,10,10,0.051)", color: "#3F3F46" }}>
              {t.remove}
            </button>
          )}
        </form>
        {err && <p className="text-[12.5px]" style={{ color: "#b42318" }}>{err}</p>}
        {saving === "ok" && !err && <p className="text-[12px]" style={{ color: ACCENT }}>✓</p>}
      </div>
    </div>
  );
}
