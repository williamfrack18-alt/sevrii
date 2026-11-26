"use client";

import { useEffect, useState } from "react";
import { homeStatsAction, type HomeStatsState } from "@/app/pageStatsActions";
import { cachedView, loadView, putView } from "./viewCache";
import { WORLD_DOTS } from "@/lib/worldDots";

// The top of Inicio, like an admin home: the page's last 30 days in one line
// (visits, sales, orders, conversion, visitors right now), a big greeting, and
// behind it a dotted world map with where visitors came from.

const TEXT = {
  es: {
    range: "Últimos 30 días",
    scope: "Tu página",
    sessions: "Visitas",
    sales: "Ventas totales",
    orders: "Pedidos",
    conversion: "Tasa de conversión",
    live: "Visitantes en vivo",
    draft: "Tu página está en borrador: los números empiezan cuando la publicas.",
    greet: (h: number) => (h < 5 ? "¡Buenas noches" : h < 12 ? "¡Buenos días" : h < 19 ? "¡Buenas tardes" : "¡Buenas noches"),
    hello: "¡Hola",
    grow: "Sigamos haciendo crecer tu negocio.",
    visitors: (n: number) => `${n} ${n === 1 ? "visitante" : "visitantes"}`,
    mapLabel: "Mapa de dónde vienen tus visitantes",
  },
  en: {
    range: "Last 30 days",
    scope: "Your page",
    sessions: "Visits",
    sales: "Total sales",
    orders: "Orders",
    conversion: "Conversion rate",
    live: "Live visitors",
    draft: "Your page is a draft: the numbers start when you publish it.",
    greet: (h: number) => (h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"),
    hello: "Hi",
    grow: "Let's keep growing your business.",
    visitors: (n: number) => `${n} ${n === 1 ? "visitor" : "visitors"}`,
    mapLabel: "Map of where your visitors come from",
  },
};

function Spark({ values }: { values: number[] }) {
  const w = 44;
  const h = 16;
  const max = Math.max(...values, 0);
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(max > 0 ? h - 1.5 - (v / max) * (h - 3) : h - 1.5).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline points={pts} fill="none" stroke="#16A34A" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={max > 0 ? 1 : 0.35} />
    </svg>
  );
}

function WorldMap({ places, label, visitors }: { places: HomeStatsState["places"]; label: string; visitors: (n: number) => string }) {
  const top = Math.max(1, ...places.map((p) => p.n));
  return (
    <svg viewBox="0 0 360 138" className="w-full h-auto" role="img" aria-label={label}>
      <path d={WORLD_DOTS} stroke="#CFCFCA" strokeWidth="1.25" strokeLinecap="round" fill="none" />
      {places.map((p, i) => {
        const x = p.lng + 180;
        const y = 80 - p.lat;
        if (x < 0 || x > 360 || y < 0 || y > 138) return null;
        const r = 0.9 + 1.5 * Math.sqrt(p.n / top);
        return (
          <g key={`${p.lat},${p.lng},${i}`}>
            <title>{`${p.city || p.country || ""}${p.city || p.country ? " · " : ""}${visitors(p.n)}`}</title>
            <circle cx={x} cy={y} r={r * 2} fill="#16A34A" opacity="0.12" />
            <circle cx={x} cy={y} r={r} fill="#16A34A" />
          </g>
        );
      })}
    </svg>
  );
}

export default function HomeHero({ businessId, name, lang }: { businessId: string; name: string; lang: "es" | "en" }) {
  const t = TEXT[lang];
  const key = `home:${businessId}`;
  const [state, setState] = useState<HomeStatsState | null>(() => cachedView<HomeStatsState>(key));
  // The greeting follows the owner's own clock (known only in the browser).
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    setHour(new Date().getHours());
    let alive = true;
    const load = () =>
      loadView(key, homeStatsAction)
        .then((s) => {
          if (alive && s) {
            setState(s);
            putView(key, s);
          }
        })
        .catch(() => {});
    load();
    // "En vivo" stays fresh while Inicio is open.
    const id = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key]);

  const nf = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US");
  const money = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const s = state;
  const conv = s && s.uniques > 0 ? (s.orders / s.uniques) * 100 : 0;
  const metrics: { label: string; value: string; series: number[] }[] = [
    { label: t.sessions, value: s ? nf.format(s.sessions) : "—", series: s?.series.sessions ?? [] },
    { label: t.sales, value: s ? money.format(s.salesCents / 100) : "—", series: s?.series.sales ?? [] },
    { label: t.orders, value: s ? nf.format(s.orders) : "—", series: s?.series.orders ?? [] },
    { label: t.conversion, value: s ? `${conv.toLocaleString(lang === "es" ? "es-US" : "en-US", { maximumFractionDigits: 2 })} %` : "—", series: s?.series.conversion ?? [] },
  ];
  const first = name.trim().split(/\s+/)[0] || "";
  const greeting = `${hour === null ? t.hello : t.greet(hour)}${first ? `, ${first}` : ""}!`;

  return (
    <section className="relative flex flex-col gap-8 md:gap-12">
      {/* The numbers, in one line */}
      <div className="relative z-[1] -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto">
        <div className="min-w-max md:min-w-0 flex items-start gap-6 md:gap-0 md:justify-between">
          <div className="flex flex-col gap-0.5 text-[13px] md:text-[14px] text-psub pt-0.5 md:pr-6">
            <span>{t.range}</span>
            <span className="text-pmuted">{t.scope}</span>
          </div>
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-1 md:px-4">
              <span className="text-[13px] md:text-[14px] text-psub underline decoration-dotted decoration-[rgba(10,10,10,.25)] underline-offset-4">{m.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[16px] md:text-[17px] font-semibold text-pfg tabular-nums">{m.value}</span>
                {m.series.length > 1 && <Spark values={m.series} />}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-[13px] md:text-[14px] text-psub md:pl-4 pt-0.5 whitespace-nowrap">
            {t.live} <span className="font-semibold text-pfg tabular-nums">{s ? nf.format(s.live) : "—"}</span>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              {s && s.live > 0 && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "rgba(22,163,74,.45)" }} />}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={s && s.live > 0 ? { background: "#16A34A" } : { boxShadow: "inset 0 0 0 1.5px #16A34A" }} />
            </span>
          </div>
        </div>
      </div>
      {s && !s.published && <p className="relative z-[1] -mt-4 md:-mt-8 text-[12.5px] text-pmuted">{t.draft}</p>}

      {/* The greeting over the world map */}
      <div className="relative">
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-10 md:-top-16 w-[150%] md:w-full max-w-[1040px]"
          style={{ WebkitMaskImage: "radial-gradient(ellipse 70% 75% at 50% 50%, #000 45%, transparent 100%)", maskImage: "radial-gradient(ellipse 70% 75% at 50% 50%, #000 45%, transparent 100%)" }}
        >
          <WorldMap places={s?.places ?? []} label={t.mapLabel} visitors={t.visitors} />
        </div>
        <div className="relative text-center py-6 md:py-16">
          <h1 className="text-[28px] md:text-[44px] leading-[1.12] font-semibold tracking-[-0.02em] text-pfg">
            {greeting}
            <br />
            {t.grow}
          </h1>
        </div>
      </div>
    </section>
  );
}
