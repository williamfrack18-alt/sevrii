"use client";

import { useState } from "react";
import { useLang } from "@/components/LangProvider";
import { setReachAction } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness } from "./types";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

const TEXT = {
  es: {
    title: "¿Dónde ofreces tu servicio?",
    sub: "Así el marketplace te muestra a los clientes que de verdad puedes atender.",
    local: "En persona, en mi zona",
    localHint: "Limpieza, mudanzas, reparaciones, belleza a domicilio…",
    remote: "En línea, desde cualquier lugar",
    remoteHint: "Edición de video, diseño, contabilidad, clases por internet…",
    city: "Tu ciudad o código postal (ZIP)",
    cityPh: "Ej. Miami, FL o 33172",
    radius: "Hasta cuántas millas vas",
    us: "Clientes en todo EE. UU.",
    world: "EE. UU. y otros países",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado.",
    notFound: "No encontramos esa ciudad. Prueba con tu código postal (5 números).",
    failed: "No se pudo guardar. Inténtalo de nuevo.",
    now: "Ahora:",
    notSet: "Todavía no lo has dicho.",
    nowLocal: (c: string, s: string, r: number) => `en persona en ${c}, ${s} y hasta ${r} millas`,
    nowRemote: (w: boolean) => (w ? "en línea, para EE. UU. y otros países" : "en línea, para todo EE. UU."),
  },
  en: {
    title: "Where do you offer your service?",
    sub: "So the marketplace shows you to the customers you can really serve.",
    local: "In person, in my area",
    localHint: "Cleaning, moving, repairs, beauty at home…",
    remote: "Online, from anywhere",
    remoteHint: "Video editing, design, bookkeeping, online classes…",
    city: "Your city or ZIP code",
    cityPh: "E.g. Miami, FL or 33172",
    radius: "How many miles you travel",
    us: "Customers anywhere in the US",
    world: "US and other countries",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    notFound: "We couldn't find that city. Try your ZIP code (5 digits).",
    failed: "Couldn't save. Try again.",
    now: "Now:",
    notSet: "You haven't set it yet.",
    nowLocal: (c: string, s: string, r: number) => `in person in ${c}, ${s} and up to ${r} miles`,
    nowRemote: (w: boolean) => (w ? "online, for the US and other countries" : "online, for all of the US"),
  },
};

const RADII = [5, 10, 15, 25, 40, 60, 100];

export default function StoreReach({ business, onUpdated }: { business: ClientBusiness; onUpdated: (b: ClientBusiness) => void }) {
  const lang = useLang();
  const t = TEXT[lang];
  const s = business.site;
  const guessMode: "local" | "remote" = s.reachMode === "remote" || business.plan.profile.serviceMode === "remote" ? "remote" : "local";
  const [mode, setMode] = useState<"local" | "remote">(s.reachMode || guessMode);
  const [place, setPlace] = useState(
    s.baseCity ? `${s.baseCity}, ${s.baseState}` : business.plan.profile.city ? `${business.plan.profile.city}${business.plan.profile.state ? `, ${business.plan.profile.state}` : ""}` : business.city || ""
  );
  const [radius, setRadius] = useState(s.reachMode === "local" ? s.reachRadius : business.plan.profile.radiusMiles || 25);
  const [scope, setScope] = useState<"us" | "world">(s.reachScope || "us");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      const res = await setReachAction({ mode, scope, radius, place });
      if (res.ok) {
        onUpdated(toClientBusiness(res.business));
        setNote({ ok: true, text: t.saved });
      } else setNote({ ok: false, text: res.error === "place" ? t.notFound : t.failed });
    } catch {
      setNote({ ok: false, text: t.failed });
    } finally {
      setBusy(false);
    }
  }

  const option = (m: "local" | "remote", label: string, hint: string, icon: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className="text-left rounded-xl p-3.5 flex-1 min-w-[220px]"
      style={{ background: mode === m ? "rgba(46,122,85,.18)" : "#161616", boxShadow: mode === m ? `0 0 0 1.5px ${ACCENT}` : "0 0 0 1px rgba(255,255,255,.08)" }}
    >
      <div className="text-[14px] font-semibold text-white">
        {icon} {label}
      </div>
      <div className="text-[12px] text-[#9a9a9a] mt-0.5">{hint}</div>
    </button>
  );
  const current =
    s.reachMode === "local" && s.baseCity ? t.nowLocal(s.baseCity, s.baseState, s.reachRadius) : s.reachMode === "remote" ? t.nowRemote(s.reachScope === "world") : t.notSet;

  return (
    <div className="rounded-2xl p-4 md:p-5 mb-5" style={{ background: "#0f0f0f", boxShadow: s.reachMode ? "0 0 0 1px rgba(255,255,255,.08)" : "0 0 0 1px rgba(212,167,44,.45)" }}>
      <h3 className="text-[15px] font-semibold text-white">📍 {t.title}</h3>
      <p className="text-[13px] text-[#9a9a9a] mt-1">{t.sub}</p>
      <div className="flex flex-wrap gap-3 mt-4">
        {option("local", t.local, t.localHint, "🚗")}
        {option("remote", t.remote, t.remoteHint, "💻")}
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        {mode === "local" ? (
          <>
            <label className="flex flex-col gap-1 flex-1 min-w-[220px]">
              <span className="text-[12.5px] text-[#a1a1a1]">{t.city}</span>
              <input
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                placeholder={t.cityPh}
                maxLength={80}
                className="h-10 rounded-xl px-3 text-[14px] text-white outline-none"
                style={{ background: "#1a1a1a", boxShadow: "0 0 0 1px rgba(255,255,255,.12)" }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] text-[#a1a1a1]">{t.radius}</span>
              <select
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="h-10 rounded-xl px-3 text-[14px] text-white outline-none"
                style={{ background: "#1a1a1a", boxShadow: "0 0 0 1px rgba(255,255,255,.12)" }}
              >
                {[...new Set([...RADII, radius])].sort((a, b) => a - b).map((r) => (
                  <option key={r} value={r}>
                    {r} {lang === "es" ? "millas" : "miles"}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(["us", "world"] as const).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => setScope(x)}
                className="h-10 px-4 rounded-full text-[13.5px] font-medium"
                style={scope === x ? { background: TINT, color: ACCENT, boxShadow: `0 0 0 1px ${ACCENT}` } : { background: "#1a1a1a", color: "#d4d4d4" }}
              >
                {x === "us" ? `🇺🇸 ${t.us}` : `🌎 ${t.world}`}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={save} disabled={busy || (mode === "local" && place.trim().length < 3)} className="h-10 px-5 rounded-full text-[14px] font-semibold disabled:opacity-50" style={BRAND_BTN}>
          {busy ? t.saving : t.save}
        </button>
      </div>
      <p className="text-[12.5px] mt-3" style={{ color: note ? (note.ok ? ACCENT : "#f87171") : "#8e8e8e" }}>
        {note ? note.text : `${t.now} ${current}`}
      </p>
    </div>
  );
}
