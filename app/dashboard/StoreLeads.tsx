"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/components/LangProvider";
import { listMyLeadsAction } from "@/app/leadActions";
import type { LeadRow } from "@/lib/db";
import { formatPhone } from "@/lib/site";
import { ACCENT, TINT } from "@/lib/brand";

const TEXT = {
  es: {
    title: "Solicitudes de clientes",
    sub: "Lo que te piden en el formulario «Cotización gratis» de tu página. También te llega por correo. Responde rápido: quien contesta primero se queda con el cliente.",
    empty: "Todavía no hay solicitudes. Cuando alguien llene el formulario de tu página, aparece aquí.",
    call: "Llamar",
    text: "Texto",
    email: "Correo",
    prefers: "Prefiere",
    prefs: { call: "llamada", text: "texto", whatsapp: "WhatsApp", email: "correo" } as Record<string, string>,
    more: "Ver todas",
    less: "Ver menos",
  },
  en: {
    title: "Customer requests",
    sub: "What people send from the “Free quote” form on your page. You also get them by email. Reply fast: whoever answers first usually gets the job.",
    empty: "No requests yet. When someone fills in the form on your page, it shows up here.",
    call: "Call",
    text: "Text",
    email: "Email",
    prefers: "Prefers",
    prefs: { call: "call", text: "text", whatsapp: "WhatsApp", email: "email" } as Record<string, string>,
    more: "See all",
    less: "See less",
  },
};

function when(iso: string, lang: "es" | "en") {
  const d = new Date(iso);
  return d.toLocaleString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function StoreLeads({ businessId }: { businessId: string }) {
  const lang = useLang();
  const t = TEXT[lang];
  const [leads, setLeads] = useState<LeadRow[] | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    listMyLeadsAction()
      .then((l) => alive && setLeads(l))
      .catch(() => alive && setLeads([]));
    return () => {
      alive = false;
    };
  }, [businessId]);

  if (leads === null) return null;
  const shown = all ? leads : leads.slice(0, 4);
  const pill = "h-8 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center";

  return (
    <div id="leads" className="rounded-2xl p-4 md:p-5 mb-5" style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}>
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-white">📥 {t.title}</h3>
        {leads.length > 0 && (
          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: TINT, color: ACCENT }}>
            {leads.length >= 50 ? "50+" : leads.length}
          </span>
        )}
      </div>
      <p className="text-[13px] text-[#9a9a9a] mt-1">{t.sub}</p>
      {leads.length === 0 ? (
        <p className="text-[13px] text-[#8e8e8e] mt-3 rounded-xl p-4" style={{ border: "1px dashed rgba(255,255,255,.15)" }}>
          {t.empty}
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 mt-4">
          {shown.map((l) => (
            <div key={l.id} className="rounded-xl p-4" style={{ background: "#161616", boxShadow: "0 0 0 1px rgba(255,255,255,.07)" }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14.5px] font-semibold text-white truncate">{l.name}</span>
                <span className="text-[11.5px] text-[#8e8e8e] shrink-0">{when(l.createdAt, lang)}</span>
              </div>
              {l.service && <div className="text-[13px] mt-0.5" style={{ color: ACCENT }}>{l.service}</div>}
              {l.message && <p className="text-[13px] text-[#cfcfcf] mt-1.5 leading-relaxed break-words">{l.message}</p>}
              <div className="text-[12.5px] text-[#a1a1a1] mt-2">
                {[l.phone ? formatPhone(l.phone) : "", l.email].filter(Boolean).join(" · ")}
                {l.contactPref && ` · ${t.prefers}: ${t.prefs[l.contactPref] ?? l.contactPref}`}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {l.phone && (
                  <>
                    <a href={`tel:${l.phone}`} className={pill} style={{ background: TINT, color: ACCENT }}>
                      📞 {t.call}
                    </a>
                    <a href={`sms:${l.phone}`} className={pill} style={{ background: "rgba(255,255,255,.08)", color: "#e5e5e5" }}>
                      💬 {t.text}
                    </a>
                  </>
                )}
                {l.email && (
                  <a href={`mailto:${l.email}`} className={pill} style={{ background: "rgba(255,255,255,.08)", color: "#e5e5e5" }}>
                    ✉️ {t.email}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {leads.length > 4 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-3 text-[13px] font-medium" style={{ color: ACCENT }}>
          {all ? t.less : `${t.more} (${leads.length})`}
        </button>
      )}
    </div>
  );
}
