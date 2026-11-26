"use client";

import { useEffect, useState } from "react";
import { customersAction } from "@/app/pageStatsActions";
import type { BusinessCustomer } from "@/lib/db";
import { cachedView, loadView, putView } from "./viewCache";
import SevriiLoader from "@/components/SevriiLoader";

// Clientes: everyone who paid through Sevrii and everyone who left a name,
// phone or email in the page chat, in one list. A row with a chat opens it in
// Conversaciones.

const TEXT = {
  es: {
    title: "Clientes",
    sub: (n: number) => `${n} ${n === 1 ? "cliente" : "clientes"} · quienes te pagaron y quienes dejaron sus datos en el chat`,
    search: "Buscar por nombre, correo o teléfono",
    all: "Todos",
    paid: "Compraron",
    chat: "Del chat",
    name: "Cliente",
    contact: "Contacto",
    source: "Origen",
    orders: "Compras",
    spent: "Total",
    last: "Última vez",
    srcPaid: "Pagó",
    srcChat: "Chat",
    aff: "Afiliado",
    noName: "Sin nombre",
    openChat: "Ver chat",
    empty: "Todavía no tienes clientes",
    emptySub: "Aquí aparece quien te paga por Sevrii y quien deja su nombre, teléfono o correo en el chat de tu página.",
    none: "Nadie coincide con la búsqueda.",
    total: "Vendido a estos clientes",
    loading: "Cargando…",
  },
  en: {
    title: "Customers",
    sub: (n: number) => `${n} ${n === 1 ? "customer" : "customers"} · who paid you and who left their details in the chat`,
    search: "Search by name, email or phone",
    all: "All",
    paid: "Bought",
    chat: "From chat",
    name: "Customer",
    contact: "Contact",
    source: "Source",
    orders: "Orders",
    spent: "Total",
    last: "Last seen",
    srcPaid: "Paid",
    srcChat: "Chat",
    aff: "Affiliate",
    noName: "No name",
    openChat: "Open chat",
    empty: "No customers yet",
    emptySub: "Whoever pays you through Sevrii or leaves their name, phone or email in your page chat shows up here.",
    none: "Nobody matches the search.",
    total: "Sold to these customers",
    loading: "Loading…",
  },
};

const TONES = [
  ["#E7F4EC", "#14532D"],
  ["#FDF0E1", "#7C4A12"],
  ["#E8EFFB", "#1E3A8A"],
  ["#F6E8F1", "#831843"],
  ["#EEEAF9", "#4C1D95"],
  ["#EFEFEA", "#3F3F46"],
];
function tone(n: string) {
  let h = 0;
  for (const ch of n || "?") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export default function CustomersView({ businessId, lang, onOpenChat }: { businessId: string; lang: "es" | "en"; onOpenChat: (conversationId: string) => void }) {
  const t = TEXT[lang];
  const key = `customers:${businessId}`;
  const [list, setList] = useState<BusinessCustomer[] | null>(() => cachedView<BusinessCustomer[]>(key));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "paid" | "chat">("all");

  useEffect(() => {
    let alive = true;
    loadView(key, customersAction)
      .then((r) => {
        if (alive && r) {
          setList(r);
          putView(key, r);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key]);

  const loc = lang === "es" ? "es-US" : "en-US";
  const money = new Intl.NumberFormat(loc, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" }) : "—");
  const query = q.trim().toLowerCase();
  const all = list ?? [];
  const shown = all
    .filter((c) => (filter === "paid" ? c.orders > 0 : filter === "chat" ? c.orders === 0 : true))
    .filter((c) => !query || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(query));
  const paidN = all.filter((c) => c.orders > 0).length;
  const total = shown.reduce((a, c) => a + c.spentCents, 0);

  return (
    <div className="pearl-page min-h-[calc(100dvh-var(--hdr))] md:min-h-[calc(100vh-16px)] px-4 md:px-8 pt-5 md:pt-8 pb-10">
      <div className="max-w-[1120px] mx-auto flex flex-col gap-5">
        <div className="min-w-0">
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.02em] text-pfg leading-tight">{t.title}</h1>
          <p className="text-[13.5px] text-psub mt-1">{list ? t.sub(all.length) : " "}</p>
        </div>

        {list === null ? (
          <div className="pearl-card py-20 flex justify-center">
            <SevriiLoader label={t.loading} />
          </div>
        ) : all.length === 0 ? (
          <div className="pearl-card py-16 px-6 flex flex-col items-center text-center gap-3">
            <span className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "#E7F4EC", color: "#15803D" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3.5" />
                <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
              </svg>
            </span>
            <p className="text-[16px] font-medium text-pfg">{t.empty}</p>
            <p className="text-[13.5px] text-psub max-w-[420px] leading-relaxed">{t.emptySub}</p>
          </div>
        ) : (
          <div className="pearl-card overflow-hidden">
            <div className="p-3 md:p-4 flex flex-col md:flex-row md:items-center gap-2.5" style={{ borderBottom: "1px solid rgba(40,32,16,.08)" }}>
              <label className="flex-1 flex items-center gap-2 h-10 px-3 rounded-full pearl-soft text-pfaint" style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.08)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} className="flex-1 min-w-0 bg-transparent outline-none text-[16px] md:text-[13.5px] text-pfg placeholder:text-pfaint" />
              </label>
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {(
                  [
                    ["all", t.all, all.length],
                    ["paid", t.paid, paidN],
                    ["chat", t.chat, all.length - paidN],
                  ] as const
                ).map(([k, label, n]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`pearl-pill shrink-0 ${filter === k ? "on" : ""}`}>
                    {label}
                    <span className="n">{n}</span>
                  </button>
                ))}
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="text-[13.5px] text-pmuted px-5 py-8">{t.none}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="text-[12px] text-pmuted">
                      <th className="font-medium px-5 py-3">{t.name}</th>
                      <th className="font-medium px-3 py-3">{t.contact}</th>
                      <th className="font-medium px-3 py-3">{t.source}</th>
                      <th className="font-medium px-3 py-3 text-right">{t.orders}</th>
                      <th className="font-medium px-3 py-3 text-right">{t.spent}</th>
                      <th className="font-medium px-3 py-3">{t.last}</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const nm = c.name || t.noName;
                      const [bg, fg] = tone(nm);
                      return (
                        <tr key={c.key} className="text-[13.5px] hover:bg-[#FBFAF7] transition-colors" style={{ borderTop: "1px solid rgba(40,32,16,.06)" }}>
                          <td className="px-5 py-3">
                            <span className="flex items-center gap-3 min-w-0">
                              <span className="h-9 w-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: bg, color: fg }}>
                                {nm.trim().slice(0, 1).toUpperCase()}
                              </span>
                              <span className={`truncate font-medium ${c.name ? "text-pfg" : "text-pmuted"}`}>{nm}</span>
                            </span>
                          </td>
                          <td className="px-3 py-3 text-psub">
                            <span className="block truncate max-w-[220px]">{c.email || "—"}</span>
                            {c.phone && <span className="block text-[12.5px] text-pmuted">{c.phone}</span>}
                          </td>
                          <td className="px-3 py-3">
                            <span className="flex flex-wrap gap-1">
                              <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={c.orders > 0 ? { background: "#E7F4EC", color: "#15803D" } : { background: "#F1EEE6", color: "#52525B" }}>
                                {c.orders > 0 ? t.srcPaid : t.srcChat}
                              </span>
                              {c.affiliate && (
                                <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#EEEAF9", color: "#4C1D95" }}>
                                  {t.aff}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-pfg">{c.orders || "—"}</td>
                          <td className="px-3 py-3 text-right tabular-nums font-medium text-pfg">{c.spentCents ? money.format(c.spentCents / 100) : "—"}</td>
                          <td className="px-3 py-3 text-psub whitespace-nowrap">{when(c.lastAt)}</td>
                          <td className="px-5 py-3 text-right">
                            {c.conversationId && (
                              <button type="button" onClick={() => onOpenChat(c.conversationId!)} className="pearl-btn h-8 text-[12.5px]">
                                {t.openChat}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {total > 0 && (
              <div className="px-5 py-3 flex justify-between text-[13px] pearl-soft" style={{ borderTop: "1px solid rgba(40,32,16,.08)" }}>
                <span className="text-psub">{t.total}</span>
                <span className="font-semibold text-pfg tabular-nums">{money.format(total / 100)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
