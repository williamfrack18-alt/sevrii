"use client";

import { useEffect, useState } from "react";
import { homeStatsAction, type HomeStatsState } from "@/app/pageStatsActions";
import { cachedView, loadView, putView } from "./viewCache";
import dynamic from "next/dynamic";

// The globe (and its map data) loads on its own, after the numbers.
const HomeGlobe = dynamic(() => import("./HomeGlobe"), { ssr: false });

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
      <polyline points={pts} fill="none" stroke="#86CFA5" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={max > 0 ? 1 : 0.35} />
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
    <section className="home-stars relative flex flex-col gap-6 md:gap-8 rounded-[24px] md:rounded-[28px] overflow-hidden px-4 md:px-8 pt-5 md:pt-7 -mx-1 md:mx-0">
      {/* The numbers, in one line */}
      <div className="relative z-[1] -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto">
        <div className="min-w-max md:min-w-0 flex items-start gap-6 md:gap-0 md:justify-between">
          <div className="flex flex-col gap-0.5 text-[13px] md:text-[14px] pt-0.5 md:pr-6" style={{ color: "rgba(255,255,255,.82)" }}>
            <span>{t.range}</span>
            <span style={{ color: "rgba(255,255,255,.55)" }}>{t.scope}</span>
          </div>
          {metrics.map((m) => (
            <div key={m.label} className="flex flex-col gap-1 md:px-4">
              <span className="text-[13px] md:text-[14px] underline decoration-dotted decoration-[rgba(255,255,255,.3)] underline-offset-4" style={{ color: "rgba(255,255,255,.72)" }}>{m.label}</span>
              <span className="flex items-center gap-2">
                <span className="text-[16px] md:text-[17px] font-semibold text-white tabular-nums">{m.value}</span>
                {m.series.length > 1 && <Spark values={m.series} />}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 text-[13px] md:text-[14px] md:pl-4 pt-0.5 whitespace-nowrap" style={{ color: "rgba(255,255,255,.72)" }}>
            {t.live} <span className="font-semibold text-white tabular-nums">{s ? nf.format(s.live) : "—"}</span>
            <span className="relative flex h-2.5 w-2.5" aria-hidden="true">
              {s && s.live > 0 && <span className="absolute inline-flex h-full w-full rounded-full animate-ping" style={{ background: "rgba(134,207,165,.5)" }} />}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={s && s.live > 0 ? { background: "#86CFA5" } : { boxShadow: "inset 0 0 0 1.5px #86CFA5" }} />
            </span>
          </div>
        </div>
      </div>
      {s && !s.published && <p className="relative z-[1] -mt-3 md:-mt-5 text-[12.5px]" style={{ color: "rgba(255,255,255,.55)" }}>{t.draft}</p>}

      {/* The greeting over the globe (drag it to spin it) */}
      <div className="relative h-[330px] md:h-[450px] overflow-hidden -mx-4 md:-mx-8">
        <div
          className="absolute left-1/2 -translate-x-1/2 top-0 w-[370px] md:w-[580px]"
          style={{ WebkitMaskImage: "linear-gradient(#000 66%, transparent 94%)", maskImage: "linear-gradient(#000 66%, transparent 94%)" }}
        >
          <HomeGlobe dark places={s?.places ?? []} label={t.mapLabel} visitors={t.visitors} />
        </div>
        <div className="pointer-events-none relative h-full flex items-center justify-center text-center px-4">
          <h1 className="text-[28px] md:text-[44px] leading-[1.12] font-semibold tracking-[-0.02em] text-white" style={{ textShadow: "0 2px 24px rgba(0,0,0,.65), 0 0 2px rgba(0,0,0,.4)" }}>
            {greeting}
            <br />
            {t.grow}
          </h1>
        </div>
      </div>
    </section>
  );
}
