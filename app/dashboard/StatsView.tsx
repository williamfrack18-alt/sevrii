"use client";

import { useEffect, useState } from "react";
import { saveMetaPixelAction, webStatsAction, type WebStatsState } from "@/app/pageStatsActions";
import { cachedView, loadView, putView } from "./viewCache";
import SevriiLoader from "@/components/SevriiLoader";

// Estadísticas: the page's numbers (visits, visitors, chats, contacts, "Pedir"
// taps, orders, sales, conversion), a chart day by day, where visitors come
// from, and the owner's Meta pixel. Pearl page, white cards.

type Days = 7 | 30 | 90;

const TEXT = {
  es: {
    title: "Estadísticas",
    sub: "Cómo le va a tu página: quién la visita, quién te escribe y quién te compra.",
    days: (d: number) => `${d} días`,
    visits: "Visitas",
    uniques: "Visitantes únicos",
    chats: "Conversaciones",
    contacts: "Dejaron sus datos",
    orders: "Clics en «Pedir»",
    payments: "Pedidos pagados",
    sales: "Ventas",
    conversion: "Conversión",
    chartTitle: "Visitas por día",
    chartLegendV: "Visitas",
    chartLegendU: "Visitantes únicos",
    places: "De dónde vienen",
    noPlaces: "Todavía no hay visitas con ubicación. Aparecen aquí cuando tu página publicada recibe visitas.",
    visitors: (n: number) => `${n} ${n === 1 ? "visitante" : "visitantes"}`,
    funnel: "Del visitante al pago",
    draft: "Tu página está en borrador: los números empiezan cuando la publicas.",
    note: "No cuentan tus propias visitas. Los días van en hora UTC.",
    pixel: "Píxel de Meta (Facebook e Instagram)",
    pixelHelp: "Si haces anuncios en Facebook o Instagram, pega el ID de tu píxel (solo números). Lo encuentras en el Administrador de eventos de Meta.",
    pixelOn: (id: string) => `Píxel activo: ${id}. Mide las visitas, los contactos del chat y los pagos.`,
    pixelPh: "Ej. 123456789012345",
    save: "Guardar",
    saving: "Guardando…",
    saved: "Guardado",
    remove: "Quitar",
    invalid: "El ID del píxel son solo números (8 a 20).",
    failed: "No se pudo guardar. Inténtalo de nuevo.",
    loading: "Cargando…",
  },
  en: {
    title: "Analytics",
    sub: "How your page is doing: who visits, who writes to you and who buys.",
    days: (d: number) => `${d} days`,
    visits: "Visits",
    uniques: "Unique visitors",
    chats: "Conversations",
    contacts: "Left their details",
    orders: '"Order" clicks',
    payments: "Paid orders",
    sales: "Sales",
    conversion: "Conversion",
    chartTitle: "Visits per day",
    chartLegendV: "Visits",
    chartLegendU: "Unique visitors",
    places: "Where they come from",
    noPlaces: "No visits with a location yet. They show here when your published page gets visits.",
    visitors: (n: number) => `${n} ${n === 1 ? "visitor" : "visitors"}`,
    funnel: "From visitor to payment",
    draft: "Your page is a draft: the numbers start when you publish it.",
    note: "Your own visits don't count. Days are in UTC.",
    pixel: "Meta pixel (Facebook and Instagram)",
    pixelHelp: "If you run ads on Facebook or Instagram, paste your pixel ID (numbers only). You'll find it in Meta's Events Manager.",
    pixelOn: (id: string) => `Pixel on: ${id}. It measures visits, chat contacts and payments.`,
    pixelPh: "e.g. 123456789012345",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    remove: "Remove",
    invalid: "A pixel ID is numbers only (8 to 20).",
    failed: "Couldn't save. Try again.",
    loading: "Loading…",
  },
};

const FLAG = (cc: string) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "🌐");

function Chart({ visits, uniques, from, lang }: { visits: number[]; uniques: number[]; from: string; lang: "es" | "en" }) {
  const W = 720;
  const H = 200;
  const pad = { l: 8, r: 8, t: 12, b: 26 };
  const n = visits.length;
  const max = Math.max(4, ...visits);
  const bw = (W - pad.l - pad.r) / n;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = uniques.map((u, i) => `${(pad.l + bw * i + bw / 2).toFixed(1)},${y(u).toFixed(1)}`).join(" ");
  const day = (i: number) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const ticks = n <= 7 ? Array.from({ length: n }, (_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="chart">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="rgba(40,32,16,.07)" strokeDasharray="3 4" />
      ))}
      {visits.map((v, i) => {
        const h = H - pad.b - y(v);
        return <rect key={i} x={pad.l + bw * i + bw * 0.18} y={y(v)} width={bw * 0.64} height={Math.max(v ? 2 : 0, h)} rx={Math.min(4, bw * 0.3)} fill="#CFE8D9" />;
      })}
      <polyline points={line} fill="none" stroke="#15803D" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {ticks.map((i) => (
        <text key={i} x={pad.l + bw * i + bw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#8A8A85">
          {day(i)}
        </text>
      ))}
    </svg>
  );
}

export default function StatsView({ businessId, lang }: { businessId: string; lang: "es" | "en" }) {
  const t = TEXT[lang];
  const [days, setDays] = useState<Days>(30);
  const key = `webstats:${businessId}:${days}`;
  const [state, setState] = useState<WebStatsState | null>(() => cachedView<WebStatsState>(key));
  const [pixel, setPixel] = useState("");
  const [saving, setSaving] = useState<"" | "busy" | "ok">("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setState(cachedView<WebStatsState>(key));
    loadView(key, () => webStatsAction(days))
      .then((s) => {
        if (!alive || !s) return;
        setState(s);
        putView(key, s);
        setPixel((p) => p || s.pixelId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, days]);

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

  const loc = lang === "es" ? "es-US" : "en-US";
  const nf = new Intl.NumberFormat(loc);
  const money = new Intl.NumberFormat(loc, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const s = state;
  const conv = s && s.uniques > 0 ? (s.orders / s.uniques) * 100 : 0;
  const cards: [string, string][] = s
    ? [
        [t.visits, nf.format(s.sessions)],
        [t.uniques, nf.format(s.uniques)],
        [t.chats, nf.format(s.page.chats)],
        [t.contacts, nf.format(s.page.contacts)],
        [t.orders, nf.format(s.page.orders)],
        [t.payments, nf.format(s.orders)],
        [t.sales, money.format(s.salesCents / 100)],
        [t.conversion, `${conv.toLocaleString(loc, { maximumFractionDigits: 2 })} %`],
      ]
    : [];
  const funnel: [string, number][] = s
    ? [
        [t.uniques, s.uniques],
        [t.chats, s.page.chats],
        [t.contacts, s.page.contacts],
        [t.payments, s.orders],
      ]
    : [];
  const top = Math.max(1, ...funnel.map((f) => f[1]));
  const placeMax = Math.max(1, ...(s?.places ?? []).map((p) => p.n));

  return (
    <div className="pearl-page min-h-[calc(100dvh-var(--hdr))] md:min-h-[calc(100vh-16px)] px-4 md:px-8 pt-5 md:pt-8 pb-10">
      <div className="max-w-[1120px] mx-auto flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.02em] text-pfg leading-tight">{t.title}</h1>
            <p className="text-[13.5px] text-psub mt-1">{t.sub}</p>
          </div>
          <div className="pearl-card !rounded-full p-1 flex gap-1">
            {([7, 30, 90] as Days[]).map((d) => (
              <button key={d} type="button" onClick={() => setDays(d)} className={`pearl-pill ${days === d ? "on" : ""}`}>
                {t.days(d)}
              </button>
            ))}
          </div>
        </div>
        {s && !s.published && (
          <div className="rounded-2xl px-4 py-3 text-[13px] text-pfg2" style={{ background: "#FDF6E7", boxShadow: "0 0 0 1px rgba(180,120,20,.15)" }}>
            {t.draft}
          </div>
        )}

        {!s ? (
          <div className="pearl-card py-20 flex justify-center">
            <SevriiLoader label={t.loading} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {cards.map(([label, value]) => (
                <div key={label} className="pearl-card px-4 py-3.5 flex flex-col gap-1">
                  <span className="text-[12.5px] text-pmuted">{label}</span>
                  <span className="text-[22px] md:text-[24px] font-semibold tracking-[-0.01em] text-pfg tabular-nums">{value}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
              <div className="pearl-card p-4 md:p-5 flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-semibold text-pfg">{t.chartTitle}</span>
                  <span className="flex items-center gap-3 text-[12px] text-pmuted">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "#CFE8D9" }} />
                      {t.chartLegendV}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-0.5 w-3 rounded" style={{ background: "#15803D" }} />
                      {t.chartLegendU}
                    </span>
                  </span>
                </div>
                <Chart visits={s.series.sessions} uniques={s.series.uniques} from={s.from} lang={lang} />
              </div>

              <div className="pearl-card p-4 md:p-5 flex flex-col gap-3">
                <span className="text-[15px] font-semibold text-pfg">{t.funnel}</span>
                <div className="flex flex-col gap-2.5">
                  {funnel.map(([label, v]) => (
                    <div key={label} className="flex flex-col gap-1">
                      <div className="flex justify-between text-[13px]">
                        <span className="text-psub">{label}</span>
                        <span className="font-semibold text-pfg tabular-nums">{nf.format(v)}</span>
                      </div>
                      <div className="h-2 rounded-full" style={{ background: "#F1EEE6" }}>
                        <div className="h-2 rounded-full" style={{ width: `${Math.max(v ? 3 : 0, (v / top) * 100)}%`, background: "#16A34A" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div className="pearl-card p-4 md:p-5 flex flex-col gap-2">
                <span className="text-[15px] font-semibold text-pfg">{t.places}</span>
                {s.places.length === 0 ? (
                  <p className="text-[13px] text-psub leading-relaxed">{t.noPlaces}</p>
                ) : (
                  <ul className="flex flex-col">
                    {s.places.slice(0, 8).map((p, i) => (
                      <li key={`${p.lat},${p.lng}`} className="flex items-center gap-3 py-2" style={i ? { borderTop: "1px solid rgba(40,32,16,.07)" } : undefined}>
                        <span className="text-[18px] leading-none w-6 text-center">{FLAG(p.country)}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[14px] text-pfg truncate">{p.city || p.country || "—"}</span>
                          <span className="block h-1.5 mt-1 rounded-full" style={{ width: `${Math.max(6, (p.n / placeMax) * 100)}%`, background: "#CFE8D9" }} />
                        </span>
                        <span className="text-[13px] text-psub tabular-nums shrink-0">{t.visitors(p.n)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pearl-card p-4 md:p-5 flex flex-col gap-2.5">
                <span className="text-[15px] font-semibold text-pfg">{t.pixel}</span>
                <p className="text-[13px] text-psub leading-relaxed">{s.pixelId ? t.pixelOn(s.pixelId) : t.pixelHelp}</p>
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
                    className="flex-1 min-w-0 h-10 rounded-full px-4 text-[16px] md:text-[13.5px] outline-none pearl-soft text-pfg"
                    style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.12)" }}
                  />
                  <button type="submit" disabled={saving === "busy"} className="pearl-btn dark h-10 disabled:opacity-50">
                    {saving === "busy" ? t.saving : saving === "ok" ? t.saved : t.save}
                  </button>
                  {s.pixelId && (
                    <button type="button" disabled={saving === "busy"} onClick={() => save("")} className="pearl-btn h-10 disabled:opacity-50">
                      {t.remove}
                    </button>
                  )}
                </form>
                {err && <p className="text-[12.5px] text-red-600">{err}</p>}
              </div>
            </div>
            <p className="text-[12px] text-pmuted">{t.note}</p>
          </>
        )}
      </div>
    </div>
  );
}
