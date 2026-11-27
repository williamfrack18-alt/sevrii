"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { saveMetaPixelAction, webStatsAction, type WebStatsState } from "@/app/pageStatsActions";
import { cachedView, loadView, putView } from "./viewCache";
import SevriiLoader from "@/components/SevriiLoader";

// Estadísticas: the page's numbers (visits, visitors, chats, contacts, "Pedir"
// taps, orders, sales, conversion), a chart day by day, where visitors come
// from, and the owner's Meta pixel. Same look as Inicio: the numbers and an
// explorable chart over the stars, then green cards.

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
    stepHint: "Pasa el cursor por cada paso para ver cuántos siguen.",
    stepRate: (n: number, from: string) => `${n}% de «${from}» llegó a este paso.`,
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
    stepHint: "Hover each step to see how many continue.",
    stepRate: (n: number, from: string) => `${n}% of "${from}" reached this step.`,
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

// The globe (and its map data) loads on its own, after the numbers.
const HomeGlobe = dynamic(() => import("./HomeGlobe"), { ssr: false });

type MetricKey = "sessions" | "uniques" | "sales" | "orders" | "conversion";

// The big chart: a soft green area over the stars. Moving the mouse (or a
// finger) over it shows that day's number.
function AreaChart({ values, from, lang, fmt }: { values: number[]; from: string; lang: "es" | "en"; fmt: (v: number) => string }) {
  const W = 1000;
  const H = 240;
  const pad = { l: 4, r: 4, t: 18, b: 30 };
  const n = values.length;
  const max = Math.max(...values, 0) || 1;
  const x = (i: number) => pad.l + ((W - pad.l - pad.r) * i) / Math.max(1, n - 1);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const [hover, setHover] = useState<number | null>(null);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  // Smooth line (Catmull-Rom → Bézier)
  let d = pts.length ? `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}` : "";
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${Math.min(H - pad.b, c1[1]).toFixed(1)} ${c2[0].toFixed(1)},${Math.min(H - pad.b, c2[1]).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = pts.length ? `${d} L${x(n - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z` : "";
  const day = (i: number, long = false) => {
    const dt = new Date(`${from}T00:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + i);
    return dt.toLocaleDateString(lang === "es" ? "es-US" : "en-US", long ? { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" } : { day: "numeric", month: "short", timeZone: "UTC" });
  };
  const ticks = n <= 7 ? Array.from({ length: n }, (_, i) => i) : [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round((3 * (n - 1)) / 4), n - 1];
  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect();
    const fx = ((clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((fx - pad.l) / (W - pad.l - pad.r)) * (n - 1)))));
  };
  const hx = hover === null ? 0 : x(hover);
  return (
    <div className="relative select-none">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-[200px] md:h-[240px] block touch-pan-y"
        role="img"
        aria-label="chart"
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="st-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3ddc84" stopOpacity="0.38" />
            <stop offset="100%" stopColor="#3ddc84" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke="rgba(255,255,255,.08)" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#st-area)" />
        <path d={d} fill="none" stroke="#5BE39A" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hover !== null && <line x1={hx} x2={hx} y1={pad.t - 8} y2={H - pad.b} stroke="rgba(255,255,255,.35)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {/* Labels in HTML so they don't stretch with the chart */}
      <div className="absolute left-0 right-0 bottom-0 h-[26px] pointer-events-none">
        {ticks.map((i) => (
          <span key={i} className="absolute text-[11px] -translate-x-1/2 whitespace-nowrap" style={{ left: `${(x(i) / W) * 100}%`, bottom: 4, color: "rgba(255,255,255,.5)" }}>
            {day(i)}
          </span>
        ))}
      </div>
      {hover !== null && (
        <>
          <span className="pointer-events-none absolute h-3 w-3 rounded-full -translate-x-1/2 -translate-y-1/2" style={{ left: `${(hx / W) * 100}%`, top: `${(y(values[hover]) / H) * 100}%`, background: "#5BE39A", boxShadow: "0 0 0 4px rgba(91,227,154,.25), 0 0 0 1.5px #04150c inset" }} />
          <div
            className="pointer-events-none absolute top-0 z-[2] rounded-xl px-3 py-2 text-[12.5px] whitespace-nowrap"
            style={{ left: `${(hx / W) * 100}%`, transform: `translateX(${hover > n * 0.75 ? "-100%" : hover < n * 0.25 ? "0" : "-50%"})`, background: "rgba(4,18,12,.92)", boxShadow: "0 10px 24px -10px rgba(0,0,0,.6), inset 0 0 0 1px rgba(160,240,210,.16)", color: "#fff" }}
          >
            <div style={{ color: "rgba(255,255,255,.6)" }}>{day(hover, true)}</div>
            <div className="text-[15px] font-semibold tabular-nums">{fmt(values[hover])}</div>
          </div>
        </>
      )}
    </div>
  );
}

export default function StatsView({ businessId, lang }: { businessId: string; lang: "es" | "en" }) {
  const t = TEXT[lang];
  const [days, setDays] = useState<Days>(30);
  const [metric, setMetric] = useState<MetricKey>("sessions");
  const key = `webstats:${businessId}:${days}`;
  const [state, setState] = useState<WebStatsState | null>(() => cachedView<WebStatsState>(key));
  const [pixel, setPixel] = useState("");
  const [saving, setSaving] = useState<"" | "busy" | "ok">("");
  const [err, setErr] = useState("");
  const [hoverStep, setHoverStep] = useState<number | null>(null);

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
  const pct = (v: number) => `${v.toLocaleString(loc, { maximumFractionDigits: 2 })} %`;
  const s = state;
  const conv = s && s.uniques > 0 ? (s.orders / s.uniques) * 100 : 0;
  const metrics: { k: MetricKey; label: string; value: string; series: number[]; fmt: (v: number) => string }[] = s
    ? [
        { k: "sessions", label: t.visits, value: nf.format(s.sessions), series: s.series.sessions, fmt: (v) => nf.format(v) },
        { k: "uniques", label: t.uniques, value: nf.format(s.uniques), series: s.series.uniques, fmt: (v) => nf.format(v) },
        { k: "sales", label: t.sales, value: money.format(s.salesCents / 100), series: s.series.sales, fmt: (v) => money.format(v / 100) },
        { k: "orders", label: t.payments, value: nf.format(s.orders), series: s.series.orders, fmt: (v) => nf.format(v) },
        { k: "conversion", label: t.conversion, value: pct(conv), series: s.series.conversion, fmt: (v) => pct(v * 100) },
      ]
    : [];
  const cur = metrics.find((m) => m.k === metric) ?? metrics[0];
  const small: [string, number][] = s
    ? [
        [t.chats, s.page.chats],
        [t.contacts, s.page.contacts],
        [t.orders, s.page.orders],
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
    <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen">
      <div className="max-w-[1120px] mx-auto px-4 md:px-10 pt-5 md:pt-14 pb-12 md:pb-20 flex flex-col gap-5 md:gap-6">
        {/* The numbers over the stars, with a chart you can explore */}
        <section className="home-stars relative rounded-[24px] md:rounded-[28px] overflow-hidden px-4 md:px-8 pt-5 md:pt-7 pb-4 md:pb-6 -mx-1 md:mx-0 flex flex-col gap-5">
          <div className="relative z-[1] flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[26px] md:text-[34px] font-semibold tracking-[-0.02em] text-white leading-tight">{t.title}</h1>
              <p className="text-[13.5px] mt-1" style={{ color: "rgba(255,255,255,.6)" }}>{t.sub}</p>
            </div>
            <div className="st-seg" role="tablist" aria-label={t.title}>
              {([7, 30, 90] as Days[]).map((d) => (
                <button key={d} type="button" role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={days === d ? "on" : ""}>
                  {t.days(d)}
                </button>
              ))}
            </div>
          </div>
          {s && !s.published && <p className="relative z-[1] -mt-2 text-[12.5px]" style={{ color: "rgba(255,255,255,.55)" }}>{t.draft}</p>}

          {!s ? (
            <div className="relative z-[1] py-24 flex justify-center">
              <SevriiLoader label={t.loading} />
            </div>
          ) : (
            <>
              <div className="relative z-[1] -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto no-scrollbar">
                <div className="flex gap-2 min-w-max md:min-w-0 md:grid md:grid-cols-5">
                  {metrics.map((m) => (
                    <button key={m.k} type="button" onClick={() => setMetric(m.k)} aria-pressed={metric === m.k} className={`st-metric ${metric === m.k ? "on" : ""}`}>
                      <span className="text-[12.5px] md:text-[13px]" style={{ color: "rgba(255,255,255,.66)" }}>{m.label}</span>
                      <span className="text-[19px] md:text-[22px] font-semibold text-white tabular-nums tracking-[-0.01em]">{m.value}</span>
                    </button>
                  ))}
                </div>
              </div>
              {cur && (
                <div className="relative z-[1]">
                  <AreaChart key={`${cur.k}-${days}`} values={cur.series} from={s.from} lang={lang} fmt={cur.fmt} />
                </div>
              )}
            </>
          )}
        </section>

        {s && (
          <div className="home-green flex flex-col gap-5 md:gap-6">
            <section className="grid grid-cols-3 gap-3 md:gap-5">
              {small.map(([label, v]) => (
                <div key={label} className="p-card p-4 md:p-6 flex flex-col gap-3">
                  <span className="text-[13px] md:text-[14px] text-pmuted">{label}</span>
                  <span className="text-[28px] md:text-[38px] leading-none font-medium tracking-[-0.03em] tabular-nums text-pfg">{nf.format(v)}</span>
                </div>
              ))}
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 md:gap-6">
              {/* Where they come from: the globe and the list */}
              <section className="p-card p-5 md:p-7 flex flex-col gap-4 overflow-hidden">
                <span className="text-[18px] md:text-[20px] font-medium tracking-[-0.01em] text-pfg">{t.places}</span>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4 items-center">
                  <div className="w-full max-w-[300px] mx-auto">
                    <HomeGlobe dark places={s.places} label={t.places} visitors={t.visitors} />
                  </div>
                  {s.places.length === 0 ? (
                    <p className="text-[13.5px] text-pmuted leading-relaxed">{t.noPlaces}</p>
                  ) : (
                    <ul className="flex flex-col">
                      {s.places.slice(0, 6).map((p, i) => (
                        <li key={`${p.lat},${p.lng}`} className="flex items-center gap-3 py-2" style={i ? { borderTop: "1px solid rgba(255,255,255,.08)" } : undefined}>
                          <span className="text-[17px] leading-none w-6 text-center">{FLAG(p.country)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13.5px] text-pfg truncate">{p.city || p.country || "—"}</span>
                            <span className="block h-1.5 mt-1 rounded-full" style={{ width: `${Math.max(6, (p.n / placeMax) * 100)}%`, background: "linear-gradient(90deg,#2f8a63,#5BE39A)" }} />
                          </span>
                          <span className="text-[12.5px] text-pmuted tabular-nums shrink-0">{nf.format(p.n)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              {/* From visitor to payment: hover a step to see how many continue */}
              <section className="p-card p-5 md:p-7 flex flex-col gap-4">
                <span className="text-[18px] md:text-[20px] font-medium tracking-[-0.01em] text-pfg">{t.funnel}</span>
                <div className="flex items-end gap-2 md:gap-3 h-[190px]" onPointerLeave={() => setHoverStep(null)}>
                  {funnel.map(([label, v], i) => {
                    const on = hoverStep === i;
                    return (
                      <button
                        key={label}
                        type="button"
                        onPointerEnter={() => setHoverStep(i)}
                        onFocus={() => setHoverStep(i)}
                        onClick={() => setHoverStep(i)}
                        className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-1.5 text-center"
                      >
                        <span className="text-[15px] md:text-[17px] font-semibold tabular-nums text-pfg">{nf.format(v)}</span>
                        <span
                          className="w-full rounded-t-[10px] transition-all duration-300"
                          style={{ height: `${Math.max(v ? 6 : 2, (v / top) * 120)}px`, background: on ? "linear-gradient(180deg,#5BE39A,#2f8a63)" : "linear-gradient(180deg,rgba(91,227,154,.55),rgba(47,138,99,.35))", boxShadow: on ? "0 0 24px -4px rgba(91,227,154,.5)" : "none" }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2 md:gap-3 -mt-2">
                  {funnel.map(([label], i) => (
                    <span key={label} className="flex-1 min-w-0 text-[11.5px] md:text-[12px] text-center leading-tight text-pmuted" style={hoverStep === i ? { color: "#fff" } : undefined}>
                      {label}
                    </span>
                  ))}
                </div>
                <p className="text-[13px] text-pmuted min-h-[20px]">
                  {hoverStep !== null && hoverStep > 0 && funnel[hoverStep - 1][1] > 0
                    ? t.stepRate(Math.round((funnel[hoverStep][1] / funnel[hoverStep - 1][1]) * 100), funnel[hoverStep - 1][0])
                    : t.stepHint}
                </p>
              </section>
            </div>

            <section className="p-card p-5 md:p-7 flex flex-col gap-3">
              <span className="text-[18px] md:text-[20px] font-medium tracking-[-0.01em] text-pfg">{t.pixel}</span>
              <p className="text-[13.5px] text-pmuted leading-relaxed max-w-[720px]">{s.pixelId ? t.pixelOn(s.pixelId) : t.pixelHelp}</p>
              <form
                className="flex flex-wrap gap-2 max-w-[620px]"
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
                  className="st-input flex-1 min-w-[180px]"
                />
                <button type="submit" disabled={saving === "busy"} className="p-btn sm disabled:opacity-50">
                  {saving === "busy" ? t.saving : saving === "ok" ? t.saved : t.save}
                </button>
                {s.pixelId && (
                  <button type="button" disabled={saving === "busy"} onClick={() => save("")} className="p-btn sm light disabled:opacity-50">
                    {t.remove}
                  </button>
                )}
              </form>
              {err && <p className="text-[12.5px]" style={{ color: "#fca5a5" }}>{err}</p>}
            </section>
            <p className="text-[12px] text-pmuted" style={{ color: "#71717A" }}>{t.note}</p>
          </div>
        )}
      </div>
    </div>
  );
}
