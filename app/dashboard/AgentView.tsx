"use client";

import StoreChat from "./StoreChat";
import { AgentRow } from "./StoreSummary";
import type { ChatChip } from "./ChatPanel";
import { useLang } from "@/components/LangProvider";
import type { ClientBusiness, ClientService } from "./types";
import { ACCENT, TINT } from "@/lib/panel";

const CARD = { background: "#FFFFFF", boxShadow: "0 1px 2px rgba(10,10,10,.04), 0 10px 30px -14px rgba(10,10,10,.14), 0 0 0 1px rgba(10,10,10,.05)" } as const;
const INK = "#0A0A0A";
const GREEN = "#16A34A";

const TEXT = {
  es: {
    area: "Agente",
    on: "Activo",
    off: "Apagado",
    open: "Abrir su chat",
    dock: "Tu agente: estado y cómo se ve",
    noAgent: "Este proyecto no tiene agente de IA",
    noAgentText: "Aquí se configura el agente cuando el proyecto es un agente de IA que hace el servicio. Las páginas de servicios hechos por personas se configuran en Store.",
    lookTitle: "Así lo ve tu cliente",
    lookNote: "Chat a pantalla completa con el nombre y la identidad de tu agente, en el negro, blanco y verde de Sevrii.",
    lookStatus: (b: string) => `Agente de IA de ${b} · responde al instante`,
    lookUser: "Hola, quiero empezar",
    lookPlaceholder: "Escribe tu mensaje…",
    hello: "¡Hola! Soy un agente de IA. ¿En qué te ayudo?",
    chips: [
      { label: "Darle más información", text: "Quiero que el agente sepa esto: " },
      { label: "Cambiar lo que hace", text: "Cambia lo que hace el agente: " },
      { label: "Cambiar su saludo", text: "Cambia el saludo del agente a: " },
      { label: "Cambiar sus límites", text: "Cambia los límites del agente: " },
      { label: "Cambiar su nombre", text: "Cambia el nombre del agente a: " },
    ] as ChatChip[],
  },
  en: {
    area: "Agent",
    on: "On",
    off: "Off",
    open: "Open its chat",
    dock: "Your agent: status and look",
    noAgent: "This project has no AI agent",
    noAgentText: "This is where the agent is set up when the project is an AI agent that delivers the service. Pages for services done by people are set up in Store.",
    lookTitle: "How your customer sees it",
    lookNote: "A full-screen chat with your agent's name and identity, in Sevrii's black, white and green.",
    lookStatus: (b: string) => `${b}'s AI agent · replies instantly`,
    lookUser: "Hi, I want to get started",
    lookPlaceholder: "Write your message…",
    hello: "Hi! I'm an AI agent. How can I help?",
    chips: [
      { label: "Give it more information", text: "I want the agent to know this: " },
      { label: "Change what it does", text: "Change what the agent does: " },
      { label: "Change its greeting", text: "Change the agent's greeting to: " },
      { label: "Change its limits", text: "Change the agent's limits: " },
      { label: "Change its name", text: "Change the agent's name to: " },
    ] as ChatChip[],
  },
};

// Agente = where the owner sets up the AI agent itself (what it does, its
// method, limits, greeting, knowledge, on/off) and sees how its chat looks to
// customers. The sales page is set up in Store.
export default function AgentView({
  business,
  services,
  initialMessages,
  greeting,
  onUpdated,
  onMessages,
  onPayments,
  onStore,
}: {
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: { id: string; role: string; content: string }[];
  greeting: string;
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: { id: string; role: string; content: string }[]) => void;
  onPayments?: () => void;
  onStore?: () => void;
}) {
  const lang = useLang();
  const t = TEXT[lang];
  const a = business.serviceAgent;
  const isAgent = business.plan.mode === "agent" || Boolean(a.name);
  const room = `/site/${business.slug}/agente`;

  if (!isAgent)
    return (
      <div className="min-h-[calc(100dvh-var(--hdr))] md:min-h-screen flex items-center justify-center p-6" style={{ background: "#F5F5F3" }}>
        <div className="rounded-[24px] p-6 max-w-md flex flex-col gap-3" style={CARD}>
          <span className="text-[17px] font-semibold text-pfg">{t.noAgent}</span>
          <p className="text-[13.5px] text-pfg2 leading-relaxed">{t.noAgentText}</p>
          {onStore && (
            <button type="button" onClick={onStore} className="self-start text-[13px] font-semibold" style={{ color: ACCENT }}>
              Store →
            </button>
          )}
        </div>
      </div>
    );

  return (
    <div style={{ background: "#F5F5F3" }}>
      <section className="h-[calc(100dvh-var(--hdr))] md:h-screen flex flex-col">
        <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between gap-3">
          <span className="text-[17px] font-semibold text-pfg truncate min-w-0">
            {a.name || business.name} <span className="text-pmuted font-normal">· {t.area}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1 rounded-full font-medium"
              style={a.enabled ? { background: TINT, color: ACCENT } : { background: "rgba(10,10,10,0.068)", color: "#27272A" }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.enabled ? ACCENT : "#A1A1AA" }} />
              {a.enabled ? t.on : t.off}
            </span>
            <a href={room} target="_blank" rel="noopener noreferrer" className="tap text-[12px] px-3 py-1 rounded-full font-medium" style={{ background: "rgba(10,10,10,0.068)", color: "#27272A" }}>
              {t.open} ↗
            </a>
          </div>
        </div>
        <StoreChat
          area="agent"
          business={business}
          onBusiness={(b) => onUpdated(b, services)}
          greeting={greeting}
          chips={t.chips}
          dockLabel={t.dock}
          dock={
            <div className="flex flex-col gap-4 min-w-0">
              <div className="rounded-[24px] p-4 md:p-5 min-w-0" style={CARD}>
                <AgentRow business={business} onUpdated={(b) => onUpdated(b, services)} onPayments={onPayments} />
              </div>
              <AgentLook business={business} />
            </div>
          }
          initialMessages={initialMessages}
          onMessages={onMessages}
          onUpdated={onUpdated}
        />
      </section>
    </div>
  );
}

// A small picture of the customer's chat (the agent's room): the same layout,
// the agent's name and identity, Sevrii's black, white and green.
function AgentLook({ business }: { business: ClientBusiness }) {
  const lang = useLang();
  const t = TEXT[lang];
  const a = business.serviceAgent;
  const name = a.name || business.name;
  const logo = business.site.logoUrl;
  const initial = (name.trim()[0] || "A").toUpperCase();
  const hello = (a.greeting || t.hello).slice(0, 220);
  return (
    <div className="rounded-[24px] p-4 md:p-5 flex flex-col gap-3 min-w-0" style={CARD}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-pmuted">{t.lookTitle}</span>
        <a href={`/site/${business.slug}/agente`} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-semibold shrink-0" style={{ color: ACCENT }}>
          {t.open} ↗
        </a>
      </div>
      <div className="rounded-[18px] overflow-hidden" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,.08)" }} aria-hidden>
        <div className="flex items-center gap-2.5 px-3.5 py-3" style={{ borderBottom: "1px solid rgba(10,10,10,.07)" }}>
          <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: INK, color: "#fff", boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${GREEN}` }}>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="w-full h-full object-cover" />
            ) : (
              initial
            )}
          </span>
          <span className="min-w-0 flex flex-col">
            <span className="text-[13.5px] font-semibold truncate" style={{ color: INK }}>{name}</span>
            <span className="text-[11px] truncate flex items-center gap-1.5" style={{ color: "#52525B" }}>
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: GREEN }} />
              {t.lookStatus(business.name)}
            </span>
          </span>
        </div>
        <div className="px-3.5 py-3 flex flex-col gap-2.5">
          <p className="text-[12.5px] leading-relaxed line-clamp-4" style={{ color: INK }}>{hello}</p>
          <span className="self-end text-[12.5px] px-3 py-1.5 rounded-[16px]" style={{ background: INK, color: "#fff" }}>{t.lookUser}</span>
        </div>
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 h-10 pl-3.5 pr-1 rounded-full" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.12)" }}>
            <span className="grow text-[12px]" style={{ color: "#A1A1AA" }}>{t.lookPlaceholder}</span>
            <span className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: INK, color: "#fff" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </div>
        </div>
      </div>
      <p className="text-[12.5px] text-psub leading-relaxed">{t.lookNote}</p>
    </div>
  );
}
