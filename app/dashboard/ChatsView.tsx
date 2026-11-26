"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cachedView, loadView } from "./viewCache";
import { useLang } from "@/components/LangProvider";
import Dictate from "./Dictate";
import {
  listInboxAction,
  openInboxConversationAction,
  ownerReplyAction,
  setConversationAiAction,
  resolveConversationAction,
  getOwnerProfileAction,
  setOwnerNameAction,
  chatPayLinkAction,
  type ChatMsg,
  type InboxConversation,
} from "@/app/chatActions";
import { formatPhone } from "@/lib/site";
import StoreNotify from "./StoreNotify";

const TEXT = {
  es: {
    title: "Conversaciones",
    empty: "Aún no tienes conversaciones",
    emptySub: "Cuando un cliente te escriba desde tu página, aparecerá aquí.",
    visitor: "Cliente",
    needsYou: "Pendiente",
    ai: "Asistente",
    you: "Tú",
    aiOn: "El asistente está respondiendo",
    aiOff: "Estás respondiendo tú",
    turnAiOn: "Devolver al asistente",
    turnAiOff: "Responder yo",
    resolve: "Marcar atendido",
    placeholder: "Escribe un mensaje",
    send: "Enviar",
    call: "Llamar",
    email: "Correo",
    back: "Volver",
    pick: "Selecciona una conversación",
    all: "Todas",
    needs: "Pendientes",
    unreadF: "Sin leer",
    alerts: "Avisos",
    noneFilter: "Nada por aquí.",
    draft: "Tu página está en borrador. Publícala para que los clientes puedan escribirte.",
    goStore: "Ir a Store",
    seenAs: "Te ven como",
    change: "Cambiar",
    save: "Guardar",
    namePh: "Tu nombre",
    askName: "¿Cómo te llamas? Los clientes verán tu nombre y tu foto cuando respondas.",
    charge: "Cobrar",
    affTag: "Afiliado",
    affLine: (code: string, p: number) => `Llegó con el link del afiliado «${code}». Si le cobras con un link de pago desde aquí, el afiliado gana el ${p}% de comisión.`,
    affOld: (code: string) => `Llegó con el link del afiliado «${code}», pero ya pasaron los 30 días: un cobro nuevo no lleva comisión.`,
    payTitle: "Cobrar a este cliente",
    payConcept: "Qué cobras (ej. Limpieza de seccional)",
    payAmount: "Monto en US$",
    paySend: "Enviar link en el chat",
    payCopyOnly: "Solo crear el link",
    payWorking: "Creando…",
    payDone: "Link de pago listo. También lo puedes mandar por WhatsApp o mensaje de texto:",
    payDoneAff: "Este cobro lleva la comisión del afiliado.",
    copy: "Copiar",
    copied: "Copiado",
    close: "Cerrar",
    payErr: {
      plan: "Cobrar con links es parte del plan Starter. Míralo en Planes.",
      not_ready: "Primero conecta Payments para poder cobrar.",
      title: "Escribe qué estás cobrando.",
      amount: "El monto debe ser entre $15 y $10,000.",
      rate: "Creaste muchos links seguidos. Espera un rato.",
      limit: "Este chat ya tiene muchos links de pago.",
      failed: "No se pudo crear el link. Inténtalo de nuevo.",
    } as Record<string, string>,
  },
  en: {
    title: "Conversations",
    empty: "No conversations yet",
    emptySub: "When a customer writes to you from your page, it shows up here.",
    visitor: "Customer",
    needsYou: "Pending",
    ai: "Assistant",
    you: "You",
    aiOn: "The assistant is replying",
    aiOff: "You're replying",
    turnAiOn: "Hand back to assistant",
    turnAiOff: "Reply myself",
    resolve: "Mark as done",
    placeholder: "Write a message",
    send: "Send",
    call: "Call",
    email: "Email",
    back: "Back",
    pick: "Select a conversation",
    all: "All",
    needs: "Pending",
    unreadF: "Unread",
    alerts: "Alerts",
    noneFilter: "Nothing here.",
    draft: "Your page is a draft. Publish it so customers can write to you.",
    goStore: "Go to Store",
    seenAs: "Customers see you as",
    change: "Change",
    save: "Save",
    namePh: "Your name",
    askName: "What's your name? Customers see your name and photo when you reply.",
    charge: "Charge",
    affTag: "Affiliate",
    affLine: (code: string, p: number) => `Came through affiliate «${code}»'s link. If you charge them with a payment link from here, the affiliate earns a ${p}% commission.`,
    affOld: (code: string) => `Came through affiliate «${code}»'s link, but the 30 days are over: a new charge carries no commission.`,
    payTitle: "Charge this customer",
    payConcept: "What you're charging for (e.g. Sectional cleaning)",
    payAmount: "Amount in US$",
    paySend: "Send link in the chat",
    payCopyOnly: "Just create the link",
    payWorking: "Creating…",
    payDone: "Payment link ready. You can also send it by WhatsApp or text:",
    payDoneAff: "This charge carries the affiliate's commission.",
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    payErr: {
      plan: "Charging with links is part of the Starter plan. See Plans.",
      not_ready: "Connect Payments first to be able to charge.",
      title: "Write what you're charging for.",
      amount: "The amount must be between $15 and $10,000.",
      rate: "You created many links in a row. Wait a bit.",
      limit: "This chat already has many payment links.",
      failed: "Couldn't create the link. Try again.",
    } as Record<string, string>,
  },
};

const I = {
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  bell: <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  back: <path d="M15 18l-6-6 6-6" />,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
};
function Icon({ d, size = 16 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

function when(iso: string, lang: "es" | "en") {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(lang === "es" ? "es-US" : "en-US", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
}

export default function ChatsView({ businessId, published, onStore }: { businessId: string; published: boolean; onStore: () => void }) {
  const lang = useLang();
  const t = TEXT[lang];
  const [list, setList] = useState<InboxConversation[] | null>(() => cachedView<InboxConversation[]>(`chats:${businessId}`));
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("c");
  });
  const [filter, setFilter] = useState<"all" | "needs" | "unread">("all");
  const [q, setQ] = useState("");
  const [showAlerts, setShowAlerts] = useState(false);
  const [me, setMe] = useState<{ name: string; photo: string } | null>(null);
  const [editName, setEditName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  useEffect(() => {
    getOwnerProfileAction()
      .then((p) => {
        setMe(p);
        if (p && !p.name) setEditName(true);
      })
      .catch(() => {});
  }, [businessId]);
  async function saveName() {
    const v = await setOwnerNameAction(nameDraft);
    if (v) {
      setMe((m) => ({ name: v, photo: m?.photo ?? "" }));
      setEditName(false);
    }
  }
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // "Cobrar": a payment link for this customer, made and sent from the chat.
  const [pay, setPay] = useState<{ title: string; amount: string; busy: boolean; error: string; url: string; aff: boolean; copied: boolean } | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const current = list?.find((c) => c.id === openId) ?? null;

  const refresh = useCallback(async () => {
    try {
      setList(await loadView(`chats:${businessId}`, listInboxAction));
    } catch {
      setList((l) => l ?? []);
    }
  }, [businessId]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [refresh, businessId]);

  // Only the chat that is open right now may fill the thread (a slow answer
  // for the previous chat is ignored), and only new messages are fetched.
  const openRef = useRef(openId);
  openRef.current = openId;
  const lastSeq = useRef(0);
  const load = useCallback(async (id: string, full = false) => {
    const looking = document.visibilityState === "visible";
    const after = full ? 0 : lastSeq.current;
    const res = await openInboxConversationAction(id, after, looking);
    if (!res.ok || openRef.current !== id) return;
    setMsgs((cur) => {
      const base = full ? [] : cur;
      const seen = new Set(base.map((m) => m.seq));
      const next = [...base, ...res.messages.filter((m) => !seen.has(m.seq))].sort((a, b) => a.seq - b.seq);
      lastSeq.current = next.length ? next[next.length - 1].seq : 0;
      return next;
    });
  }, []);

  useEffect(() => {
    setPay(null);
    if (!openId) return;
    setMsgs([]);
    lastSeq.current = 0;
    load(openId, true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load(openId);
    }, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load(openId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [openId, load]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [msgs]);

  async function reply() {
    if (!openId || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await ownerReplyAction(openId, draft);
      if (res.ok && openRef.current === openId) {
        setMsgs(res.messages);
        lastSeq.current = res.messages.length ? res.messages[res.messages.length - 1].seq : 0;
        setDraft("");
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function charge(send: boolean) {
    if (!openId || !pay || pay.busy) return;
    const id = openId;
    setPay({ ...pay, busy: true, error: "" });
    try {
      const res = await chatPayLinkAction({ id, title: pay.title, amount: pay.amount, send });
      if (openRef.current !== id) return;
      if (!res.ok) {
        setPay((p) => (p ? { ...p, busy: false, error: t.payErr[res.error] || t.payErr.failed } : p));
        return;
      }
      setMsgs(res.messages);
      lastSeq.current = res.messages.length ? res.messages[res.messages.length - 1].seq : 0;
      setPay((p) => (p ? { ...p, busy: false, url: res.url, aff: res.affiliate } : p));
      refresh();
    } catch {
      setPay((p) => (p ? { ...p, busy: false, error: t.payErr.failed } : p));
    }
  }

  async function resolve() {
    if (!current) return;
    await resolveConversationAction(current.id);
    refresh();
  }

  async function toggleAi() {
    if (!current) return;
    await setConversationAiAction(current.id, !current.aiEnabled);
    refresh();
  }

  const unread = (list ?? []).filter((c) => c.ownerUnread > 0).length;
  const needs = (list ?? []).filter((c) => c.handoff).length;
  const query = q.trim().toLowerCase();
  const shown = (list ?? [])
    .filter((c) => (filter === "needs" ? c.handoff : filter === "unread" ? c.ownerUnread > 0 : true))
    .filter((c) => !query || `${c.name} ${c.phone} ${c.email} ${c.lastMessage}`.toLowerCase().includes(query));
  const line = "1px solid rgba(40,32,16,0.08)";
  const initial = (n: string) => (n || "?").trim().slice(0, 1).toUpperCase();
  const clean = (m: string) => m.replace(/\s*\[\[(pay|case:[A-Za-z0-9_-]+)\]\]\s*$/, "").replace(/^📷\s+https:\/\/\S+$/, lang === "es" ? "📷 Foto" : "📷 Photo");
  // A soft color per person, always the same for the same name.
  const tone = (n: string) => {
    const tones = [
      ["#E7F4EC", "#14532D"],
      ["#FDF0E1", "#7C4A12"],
      ["#E8EFFB", "#1E3A8A"],
      ["#F6E8F1", "#831843"],
      ["#EEEAF9", "#4C1D95"],
      ["#EFEFEA", "#3F3F46"],
    ];
    let h = 0;
    for (const ch of n || "?") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return tones[h % tones.length];
  };
  const Avatar = ({ name, size = 40 }: { name: string; size?: number }) => {
    const [bg, fg] = tone(name);
    return (
      <span className="rounded-full flex items-center justify-center font-semibold shrink-0" style={{ width: size, height: size, background: bg, color: fg, fontSize: size * 0.38 }}>
        {initial(name)}
      </span>
    );
  };

  return (
    <div className="pearl-page flex flex-col h-[calc(100dvh-var(--hdr))] md:h-[calc(100vh-16px)] text-pfg">
      {/* Header */}
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-7 pb-3 md:pb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[24px] md:text-[30px] font-semibold tracking-[-0.02em] text-pfg leading-tight">{t.title}</h1>
          <p className="text-[13.5px] text-psub mt-1">
            {list === null
              ? " "
              : lang === "es"
                ? `${list.length} ${list.length === 1 ? "conversación" : "conversaciones"}${unread ? ` · ${unread} sin leer` : ""}${needs ? ` · ${needs} te ${needs === 1 ? "necesita" : "necesitan"}` : ""}`
                : `${list.length} ${list.length === 1 ? "conversation" : "conversations"}${unread ? ` · ${unread} unread` : ""}${needs ? ` · ${needs} need you` : ""}`}
          </p>
        </div>
        <button type="button" onClick={() => setShowAlerts((v) => !v)} className={`pearl-btn shrink-0 ${showAlerts ? "dark" : ""}`}>
          <Icon d={I.bell} size={15} /> {t.alerts}
        </button>
      </div>

      {showAlerts && (
        <div className="shrink-0 mx-3 md:mx-8 mb-3 pearl-card px-4 md:px-6 pt-4 max-h-[50vh] overflow-y-auto">
          <StoreNotify />
        </div>
      )}
      {!published && (
        <div className="shrink-0 mx-3 md:mx-8 mb-3 rounded-2xl px-4 py-3 text-[13px] text-pfg2 flex flex-wrap items-center gap-x-3 gap-y-1" style={{ background: "#FDF6E7", boxShadow: "0 0 0 1px rgba(180,120,20,.15)" }}>
          <span>{t.draft}</span>
          <button type="button" onClick={onStore} className="font-medium text-pfg underline underline-offset-4">
            {t.goStore}
          </button>
        </div>
      )}

      {list === null ? (
        <div className="flex-1" />
      ) : list.length === 0 ? (
        <div className="flex-1 mx-3 md:mx-8 mb-3 md:mb-8 pearl-card flex">
          <div className="m-auto text-center px-6 py-16 flex flex-col items-center gap-3">
            <span className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "#E7F4EC", color: "#15803D" }}>
              <Icon d={I.bell} size={24} />
            </span>
            <p className="text-[16px] font-medium text-pfg">{t.empty}</p>
            <p className="text-[13.5px] text-psub max-w-[360px] leading-relaxed">{t.emptySub}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 px-3 md:px-8 pb-3 md:pb-8 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[320px_minmax(0,1fr)] gap-3 md:gap-4">
          {/* List */}
          <div className={`pearl-card min-h-0 min-w-0 flex-col overflow-hidden ${openId ? "hidden md:flex" : "flex"}`}>
            <div className="shrink-0 p-3 flex flex-col gap-2.5" style={{ borderBottom: line }}>
              <label className="flex items-center gap-2 h-10 px-3 rounded-full pearl-soft text-pfaint" style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.08)" }}>
                <Icon d={I.search} size={15} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lang === "es" ? "Buscar por nombre o mensaje" : "Search by name or message"} className="flex-1 min-w-0 bg-transparent outline-none text-[16px] md:text-[13.5px] text-pfg placeholder:text-pfaint" />
              </label>
              <div className="flex gap-1 overflow-x-auto no-scrollbar">
                {(
                  [
                    ["all", t.all, list.length],
                    ["needs", t.needs, needs],
                    ["unread", t.unreadF, unread],
                  ] as const
                ).map(([k, label, n]) => (
                  <button key={k} type="button" onClick={() => setFilter(k)} className={`pearl-pill shrink-0 ${filter === k ? "on" : ""}`}>
                    {label}
                    {n ? <span className="n">{n}</span> : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {shown.length === 0 && <p className="text-[13px] text-pfaint px-3 py-5">{t.noneFilter}</p>}
              {shown.map((c) => {
                const on = c.id === openId;
                const nm = c.name || t.visitor;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="w-full min-w-0 text-left px-3 py-3 rounded-2xl flex items-center gap-3 transition-colors hover:bg-[#F8F6F1]"
                    style={on ? { background: "#F3F0E8" } : undefined}
                  >
                    <span className="relative">
                      <Avatar name={nm} size={42} />
                      {c.ownerUnread > 0 && <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full" style={{ background: "#16A34A", boxShadow: "0 0 0 2px #fff" }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`min-w-0 text-[14.5px] truncate ${c.ownerUnread ? "font-semibold text-pfg" : "font-medium text-pfg2"}`}>{nm}</span>
                        <span className="text-[11.5px] text-pfaint shrink-0">{when(c.lastMessageAt, lang)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                        <span className={`min-w-0 text-[13px] truncate ${c.ownerUnread ? "text-pfg2" : "text-pmuted"}`}>{clean(c.lastMessage)}</span>
                        {c.affiliate && <span className="shrink-0 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md" style={{ color: "#137a3d", background: "#E7F4EC" }}>{t.affTag}</span>}
                        {c.handoff && <span className="shrink-0 text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md" style={{ color: "#92400E", background: "#FDF0E1" }}>{t.needsYou}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thread */}
          <div className={`pearl-card min-h-0 min-w-0 flex-col overflow-hidden ${openId ? "flex max-md:fixed max-md:inset-0 max-md:z-50 max-md:rounded-none max-md:pt-[env(safe-area-inset-top)]" : "hidden md:flex"}`}>
            {!current ? (
              <div className="m-auto text-center px-6 flex flex-col items-center gap-3">
                <span className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "#F3F0E8", color: "#52525B" }}>
                  <Icon d={I.send} size={22} />
                </span>
                <p className="text-[15px] font-medium text-pfg">{t.pick}</p>
                <p className="text-[13px] text-pmuted max-w-[300px]">{lang === "es" ? "Aquí ves lo que escribió tu cliente y lo que respondió la IA. Puedes contestar tú cuando quieras." : "Here you see what your customer wrote and what the AI answered. You can reply yourself any time."}</p>
              </div>
            ) : (
              <>
                <div className="shrink-0 px-3 md:px-5 py-3 flex items-center gap-2 md:gap-3" style={{ borderBottom: line }}>
                  <button type="button" className="md:hidden -ml-1 h-10 w-10 shrink-0 flex items-center justify-center text-pfg" onClick={() => setOpenId(null)} aria-label={t.back}>
                    <Icon d={I.back} size={20} />
                  </button>
                  <Avatar name={current.name || t.visitor} size={40} />
                  <div className="min-w-0 mr-auto">
                    <div className="text-[15px] font-semibold text-pfg truncate">{current.name || t.visitor}</div>
                    <div className="text-[12.5px] text-pmuted truncate flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: current.aiEnabled ? "#16A34A" : "#A1A1AA" }} />
                      {[current.phone ? formatPhone(current.phone) : "", current.email].filter(Boolean).join("  ·  ") || (current.aiEnabled ? t.aiOn : t.aiOff)}
                    </div>
                  </div>
                  {current.phone && (
                    <a href={`tel:${current.phone}`} className="pearl-btn max-md:w-9 max-md:px-0 justify-center shrink-0" aria-label={t.call}>
                      <Icon d={I.phone} size={14} /> <span className="hidden lg:inline">{t.call}</span>
                    </a>
                  )}
                  {current.email && (
                    <a href={`mailto:${current.email}`} className="pearl-btn max-md:w-9 max-md:px-0 justify-center shrink-0" aria-label={t.email}>
                      <Icon d={I.mail} size={15} /> <span className="hidden lg:inline">{t.email}</span>
                    </a>
                  )}
                  {current.handoff && (
                    <button type="button" onClick={resolve} className="pearl-btn hidden md:inline-flex">
                      {t.resolve}
                    </button>
                  )}
                  <button type="button" onClick={() => setPay((p) => (p ? null : { title: "", amount: "", busy: false, error: "", url: "", aff: false, copied: false }))} className={`pearl-btn hidden md:inline-flex ${pay ? "dark" : ""}`}>
                    {t.charge}
                  </button>
                  <button type="button" onClick={toggleAi} className="pearl-btn hidden md:inline-flex">
                    {current.aiEnabled ? t.turnAiOff : t.turnAiOn}
                  </button>
                </div>
                {/* Mobile: the thread actions get their own row so the header never overflows */}
                <div className="md:hidden shrink-0 px-3 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ borderBottom: line }}>
                  <button type="button" onClick={toggleAi} className="pearl-btn shrink-0 whitespace-nowrap">
                    {current.aiEnabled ? t.turnAiOff : t.turnAiOn}
                  </button>
                  {current.handoff && (
                    <button type="button" onClick={resolve} className="pearl-btn shrink-0 whitespace-nowrap">
                      {t.resolve}
                    </button>
                  )}
                  <button type="button" onClick={() => setPay((p) => (p ? null : { title: "", amount: "", busy: false, error: "", url: "", aff: false, copied: false }))} className={`pearl-btn shrink-0 whitespace-nowrap ${pay ? "dark" : ""}`}>
                    {t.charge}
                  </button>
                </div>
                {current.affiliate && (
                  <div className="shrink-0 px-4 md:px-6 py-2 text-[12.5px] leading-[1.45]" style={{ borderBottom: line, background: current.affiliate.open ? "#F1FAF5" : "#FBFAF7", color: current.affiliate.open ? "#0b5130" : "#6b6b6b" }}>
                    {current.affiliate.open ? t.affLine(current.affiliate.code, current.affiliate.percent) : t.affOld(current.affiliate.code)}
                  </div>
                )}

                <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto pearl-soft">
                  <div className="max-w-[720px] mx-auto px-4 md:px-8 py-4 md:py-6 flex flex-col gap-1">
                    {msgs.map((m, i) => {
                      const prev = msgs[i - 1];
                      const mine = m.role !== "visitor";
                      const head = !prev || prev.role !== m.role;
                      return (
                        <div key={m.seq} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${head ? "mt-4" : ""}`}>
                          {head && (
                            <span className="text-[11.5px] text-pmuted mb-1 px-1 flex items-center gap-1.5">
                              {m.role === "ai" && <span className="text-[10px] font-semibold px-1.5 py-[1px] rounded" style={{ background: "#E7F4EC", color: "#15803D" }}>IA</span>}
                              {m.role === "visitor" ? current.name || t.visitor : m.role === "owner" ? (me?.name ? `${t.you} · ${me.name}` : t.you) : t.ai}
                            </span>
                          )}
                          <div
                            className="max-w-[85%] md:max-w-[78%] px-3.5 py-2.5 text-[15px] md:text-[14px] leading-[1.5] md:leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                            style={
                              m.role === "visitor"
                                ? { background: "#FFFFFF", color: "#0A0A0A", borderRadius: "18px 18px 18px 6px", boxShadow: "0 0 0 1px rgba(40,32,16,.07)" }
                                : m.role === "owner"
                                  ? { background: "#0A0A0A", color: "#fff", borderRadius: "18px 18px 6px 18px" }
                                  : { background: "#EAF5EE", color: "#14532D", borderRadius: "18px 18px 6px 18px" }
                            }
                          >
                            {/^📷\s+https:\/\/\S+$/.test(m.content) ? (
                              <a href={m.content.replace(/^📷\s+/, "")} target="_blank" rel="noopener noreferrer" className="block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={m.content.replace(/^📷\s+/, "")} alt="" loading="lazy" className="max-w-[240px] max-h-[300px] rounded-[10px] object-cover" />
                              </a>
                            ) : (
                              m.content.replace(/\s*\[\[(pay|case:[A-Za-z0-9_-]+)\]\]\s*$/, "").replace(/\*\*(.+?)\*\*/g, "$1")
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="shrink-0 px-3 md:px-6 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-4 bg-white" style={{ borderTop: line }}>
                  <div className="max-w-[720px] mx-auto">
                    {pay && (
                      <div className="mb-3 rounded-2xl p-3.5 pearl-soft" style={{ boxShadow: "0 0 0 1px rgba(40,32,16,.08)" }}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-[13.5px] font-semibold text-pfg">{t.payTitle}</span>
                          <button type="button" onClick={() => setPay(null)} className="text-[12.5px] text-pmuted hover:text-pfg tap">
                            {t.close}
                          </button>
                        </div>
                        {pay.url ? (
                          <div className="flex flex-col gap-2">
                            <p className="text-[12.5px] text-psub">{t.payDone}</p>
                            <div className="flex gap-2 items-center">
                              <input readOnly value={pay.url} className="flex-1 min-w-0 h-10 rounded-full px-4 text-[13px] text-pfg bg-white outline-none" style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.12)" }} onFocus={(e) => e.currentTarget.select()} />
                              <button
                                type="button"
                                className="pearl-btn dark h-10 shrink-0"
                                onClick={() => {
                                  navigator.clipboard?.writeText(pay.url).then(() => setPay((p) => (p ? { ...p, copied: true } : p))).catch(() => {});
                                }}
                              >
                                {pay.copied ? t.copied : t.copy}
                              </button>
                            </div>
                            {pay.aff && <p className="text-[12px] text-[#137a3d]">{t.payDoneAff}</p>}
                          </div>
                        ) : (
                          <form
                            className="flex flex-col gap-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              charge(true);
                            }}
                          >
                            <div className="flex max-md:flex-col gap-2">
                              <input value={pay.title} onChange={(e) => setPay({ ...pay, title: e.target.value })} placeholder={t.payConcept} maxLength={80} className="flex-1 min-w-0 h-10 rounded-full px-4 text-[16px] md:text-[13.5px] text-pfg outline-none bg-white placeholder:text-pfaint" style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.12)" }} />
                              <input value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} placeholder={t.payAmount} inputMode="decimal" maxLength={10} className="md:w-[130px] min-w-0 h-10 rounded-full px-4 text-[16px] md:text-[13.5px] text-pfg outline-none bg-white placeholder:text-pfaint" style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.12)" }} />
                            </div>
                            {pay.error && <p className="text-[12.5px] text-[#b42318]">{pay.error}</p>}
                            <div className="flex flex-wrap gap-2">
                              <button type="submit" disabled={pay.busy} className="pearl-btn dark disabled:opacity-40">
                                {pay.busy ? t.payWorking : t.paySend}
                              </button>
                              <button type="button" disabled={pay.busy} onClick={() => charge(false)} className="pearl-btn disabled:opacity-40">
                                {t.payCopyOnly}
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                    {me && editName ? (
                      <div className="mb-3">
                        <p className="text-[12.5px] text-psub mb-2">{t.askName}</p>
                        <div className="flex gap-2">
                          <input
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            placeholder={t.namePh}
                            maxLength={40}
                            className="flex-1 min-w-0 h-10 rounded-full px-4 text-[16px] md:text-[13.5px] text-pfg outline-none bg-white placeholder:text-pfaint"
                            style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.12)" }}
                          />
                          <button type="button" onClick={saveName} disabled={nameDraft.trim().length < 2} className="pearl-btn dark h-10 disabled:opacity-40 shrink-0">
                            {t.save}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-md:flex-wrap items-center justify-between gap-x-3 gap-y-1 md:gap-3 mb-2 text-[12px] text-pmuted min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: current.aiEnabled ? "#16A34A" : "#A1A1AA" }} />
                          {current.aiEnabled ? t.aiOn : t.aiOff}
                        </span>
                        {me?.name && (
                          <span className="min-w-0 break-words">
                            {t.seenAs} <span className="text-pfg2 font-medium">{me.name}</span> ·{" "}
                            <button
                              type="button"
                              className="hover:text-pfg tap underline underline-offset-2"
                              onClick={() => {
                                setNameDraft(me.name);
                                setEditName(true);
                              }}
                            >
                              {t.change}
                            </button>
                          </span>
                        )}
                      </div>
                    )}
                    <form
                      className="flex items-center gap-2 rounded-full pl-4 pr-1.5 py-1.5 pearl-soft"
                      style={{ boxShadow: "inset 0 0 0 1px rgba(40,32,16,.1)" }}
                      onSubmit={(e) => {
                        e.preventDefault();
                        reply();
                      }}
                    >
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={t.placeholder}
                        maxLength={2000}
                        className="flex-1 min-w-0 h-9 bg-transparent text-[16px] md:text-[14px] text-pfg outline-none placeholder:text-pfaint"
                      />
                      {/* Dictate the reply: it goes in the box to read before sending. */}
                      <Dictate lang={lang} base={draft} onText={(x) => setDraft(x.slice(0, 2000))} disabled={busy} />
                      <button
                        type="submit"
                        disabled={busy || !draft.trim()}
                        aria-label={t.send}
                        className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-colors disabled:opacity-35"
                        style={{ background: "#0A0A0A", color: "#fff" }}
                      >
                        <Icon d={I.send} size={16} />
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Hovering "Conversaciones" in the menu starts loading the list.
export function warmChats(businessId: string): void {
  if (!cachedView(`chats:${businessId}`)) loadView(`chats:${businessId}`, listInboxAction).catch(() => {});
}
