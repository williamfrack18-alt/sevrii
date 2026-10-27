"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import {
  listInboxAction,
  openInboxConversationAction,
  ownerReplyAction,
  setConversationAiAction,
  resolveConversationAction,
  getOwnerProfileAction,
  setOwnerNameAction,
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
  const [list, setList] = useState<InboxConversation[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("c");
  });
  const [filter, setFilter] = useState<"all" | "needs" | "unread">("all");
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
  const threadRef = useRef<HTMLDivElement>(null);
  const current = list?.find((c) => c.id === openId) ?? null;

  const refresh = useCallback(async () => {
    try {
      setList(await listInboxAction());
    } catch {
      setList((l) => l ?? []);
    }
  }, []);

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
  const shown = (list ?? []).filter((c) => (filter === "needs" ? c.handoff : filter === "unread" ? c.ownerUnread > 0 : true));
  const line = "1px solid rgba(10,10,10,0.068)";
  const quiet = "h-10 md:h-8 px-3 rounded-lg text-[13px] text-psub hover:text-pfg hover:bg-black/[0.06] inline-flex items-center gap-1.5 transition-colors";
  const initial = (n: string) => (n || "?").trim().slice(0, 1).toUpperCase();

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--hdr))] md:h-screen bg-pbg text-pfg">
      {/* Header */}
      <div className="shrink-0 h-14 px-4 md:px-6 flex items-center justify-between gap-3" style={{ borderBottom: line }}>
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-[15px] font-medium tracking-[-0.01em] text-pfg">{t.title}</h1>
          {unread > 0 && <span className="text-[13px] text-pmuted">{unread}</span>}
        </div>
        <button type="button" onClick={() => setShowAlerts((v) => !v)} className={`${quiet} -mr-2 md:mr-0 shrink-0`} style={showAlerts ? { color: "#0A0A0A", background: "rgba(10,10,10,0.051)" } : undefined}>
          <Icon d={I.bell} size={15} /> {t.alerts}
        </button>
      </div>

      {showAlerts && (
        <div className="shrink-0 px-4 md:px-6 pt-4 max-h-[50vh] overflow-y-auto" style={{ borderBottom: line }}>
          <StoreNotify />
        </div>
      )}
      {!published && (
        <div className="shrink-0 px-4 md:px-6 py-2.5 text-[13px] text-psub flex flex-wrap items-center gap-x-3 gap-y-1" style={{ borderBottom: line }}>
          <span>{t.draft}</span>
          <button type="button" onClick={onStore} className="text-pfg underline underline-offset-4 decoration-white/30 hover:decoration-white">
            {t.goStore}
          </button>
        </div>
      )}

      {list === null ? (
        <div className="flex-1" />
      ) : list.length === 0 ? (
        <div className="m-auto text-center px-6">
          <p className="text-[15px] text-pfg">{t.empty}</p>
          <p className="text-[13.5px] text-pmuted mt-1.5">{t.emptySub}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[300px_minmax(0,1fr)]">
          {/* List */}
          <div className={`min-h-0 min-w-0 flex-col ${openId ? "hidden md:flex" : "flex"}`} style={{ borderRight: line }}>
            <div className="shrink-0 flex gap-5 px-4 md:px-5 h-11 items-end" style={{ borderBottom: line }}>
              {(
                [
                  ["all", t.all, list.length],
                  ["needs", t.needs, needs],
                  ["unread", t.unreadF, unread],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setFilter(k)}
                  className="pb-2.5 pt-3 md:pt-0 text-[13px] -mb-px transition-colors whitespace-nowrap"
                  style={filter === k ? { color: "#0A0A0A", borderBottom: "1.5px solid #0A0A0A" } : { color: "#8a8a8a", borderBottom: "1.5px solid transparent" }}
                >
                  {label}
                  {n ? <span className="ml-1.5 text-pfaint">{n}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto">
              {shown.length === 0 && <p className="text-[13px] text-pfaint px-4 md:px-5 py-5">{t.noneFilter}</p>}
              {shown.map((c) => {
                const on = c.id === openId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpenId(c.id)}
                    className="w-full min-w-0 text-left px-4 md:px-5 py-3.5 flex items-center md:items-stretch gap-3 transition-colors hover:bg-black/[0.03] active:bg-black/[0.05]"
                    style={{ background: on ? "rgba(10,10,10,0.043)" : undefined, borderBottom: "1px solid rgba(10,10,10,0.034)" }}
                  >
                    <div className="w-11 h-11 md:w-9 md:h-9 rounded-full flex items-center justify-center text-[14px] md:text-[13px] font-medium shrink-0 text-pfg2" style={{ background: "#FFFFFF" }}>
                      {initial(c.name || t.visitor)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`min-w-0 text-[15px] md:text-[14px] truncate ${c.ownerUnread ? "text-pfg font-medium" : "text-pfg2"}`}>{c.name || t.visitor}</span>
                        <span className="text-[11.5px] text-pfaint shrink-0">{when(c.lastMessageAt, lang)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 min-w-0">
                        <span className={`min-w-0 text-[13.5px] md:text-[13px] truncate ${c.ownerUnread ? "text-pfg2" : "text-pfaint"}`}>{c.lastMessage.replace(/\s*\[\[(pay|case:[A-Za-z0-9_-]+)\]\]\s*$/, "").replace(/^📷\s+https:\/\/\S+$/, lang === "es" ? "📷 Foto" : "📷 Photo")}</span>
                        {c.handoff && <span className="ml-auto shrink-0 text-[11px] text-[#e0b54a]">{t.needsYou}</span>}
                        {!c.handoff && c.ownerUnread > 0 && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-white shrink-0" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thread */}
          <div className={`min-h-0 min-w-0 flex-col ${openId ? "flex max-md:fixed max-md:inset-0 max-md:z-50 max-md:bg-pbg max-md:pt-[env(safe-area-inset-top)]" : "hidden md:flex"}`}>
            {!current ? (
              <div className="m-auto text-[13.5px] text-pfaint">{t.pick}</div>
            ) : (
              <>
                <div className="shrink-0 h-14 md:h-16 px-4 md:px-6 flex items-center gap-1 md:gap-3" style={{ borderBottom: line }}>
                  <button type="button" className="md:hidden -ml-2 h-10 w-10 shrink-0 flex items-center justify-center text-pfg" onClick={() => setOpenId(null)} aria-label={t.back}>
                    <Icon d={I.back} size={20} />
                  </button>
                  <div className="min-w-0 mr-auto">
                    <div className="text-[15px] md:text-[14.5px] font-medium text-pfg truncate">{current.name || t.visitor}</div>
                    <div className="text-[12.5px] text-pfaint truncate">
                      {[current.phone ? formatPhone(current.phone) : "", current.email].filter(Boolean).join("  ·  ") || (current.aiEnabled ? t.aiOn : t.aiOff)}
                    </div>
                  </div>
                  {current.phone && (
                    <a href={`tel:${current.phone}`} className={`${quiet} max-md:w-10 max-md:px-0 justify-center shrink-0`} aria-label={t.call}>
                      <Icon d={I.phone} size={14} /> <span className="hidden sm:inline">{t.call}</span>
                    </a>
                  )}
                  {current.email && (
                    <a href={`mailto:${current.email}`} className={`${quiet} max-md:w-10 max-md:px-0 justify-center shrink-0`} aria-label={t.email}>
                      <Icon d={I.mail} size={15} /> <span className="hidden sm:inline">{t.email}</span>
                    </a>
                  )}
                  {current.handoff && (
                    <button type="button" onClick={resolve} className={`${quiet} hidden md:inline-flex`}>
                      {t.resolve}
                    </button>
                  )}
                  <button type="button" onClick={toggleAi} className="hidden md:inline-flex h-8 px-3 rounded-lg text-[13px] text-pfg items-center transition-colors" style={{ border: "1px solid rgba(10,10,10,0.119)" }}>
                    {current.aiEnabled ? t.turnAiOff : t.turnAiOn}
                  </button>
                </div>
                {/* Mobile: the thread actions get their own row so the header never overflows */}
                <div className="md:hidden shrink-0 px-4 py-2 flex items-center gap-2 overflow-x-auto no-scrollbar" style={{ borderBottom: line }}>
                  <button type="button" onClick={toggleAi} className="h-10 px-4 rounded-full text-[13.5px] text-pfg inline-flex items-center shrink-0 whitespace-nowrap" style={{ border: "1px solid rgba(10,10,10,0.119)" }}>
                    {current.aiEnabled ? t.turnAiOff : t.turnAiOn}
                  </button>
                  {current.handoff && (
                    <button type="button" onClick={resolve} className="h-10 px-4 rounded-full text-[13.5px] text-pfg2 inline-flex items-center shrink-0 whitespace-nowrap" style={{ background: "rgba(10,10,10,0.051)" }}>
                      {t.resolve}
                    </button>
                  )}
                </div>

                <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto">
                  <div className="max-w-[720px] mx-auto px-4 md:px-8 py-4 md:py-6 flex flex-col gap-1">
                    {msgs.map((m, i) => {
                      const prev = msgs[i - 1];
                      const mine = m.role !== "visitor";
                      const head = !prev || prev.role !== m.role;
                      return (
                        <div key={m.seq} className={`flex flex-col ${mine ? "items-end" : "items-start"} ${head ? "mt-4" : ""}`}>
                          {head && (
                            <span className="text-[11.5px] text-pfaint mb-1 px-1">
                              {m.role === "visitor" ? current.name || t.visitor : m.role === "owner" ? (me?.name ? `${t.you} · ${me.name}` : t.you) : t.ai}
                            </span>
                          )}
                          <div
                            className="max-w-[85%] md:max-w-[78%] px-3.5 py-2 text-[15px] md:text-[14px] leading-[1.5] md:leading-[1.55] whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                            style={
                              m.role === "visitor"
                                ? { background: "#FFFFFF", color: "#0A0A0A", borderRadius: 14, boxShadow: "0 0 0 1px rgba(10,10,10,.06)" }
                                : m.role === "owner"
                                  ? { background: "#052E16", color: "#fff", borderRadius: 14 }
                                  : { background: "transparent", color: "#27272A", borderRadius: 14, border: "1px solid rgba(10,10,10,0.102)" }
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

                <div className="shrink-0 px-4 md:px-6 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] md:pb-4" style={{ borderTop: line }}>
                  <div className="max-w-[720px] mx-auto">
                    {me && editName ? (
                      <div className="mb-3">
                        <p className="text-[12.5px] text-psub mb-2">{t.askName}</p>
                        <div className="flex gap-2">
                          <input
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            placeholder={t.namePh}
                            maxLength={40}
                            className="flex-1 min-w-0 h-10 md:h-9 rounded-lg px-3 text-[16px] md:text-[13.5px] text-pfg outline-none bg-transparent placeholder:text-pfaint"
                            style={{ border: "1px solid rgba(10,10,10,0.119)" }}
                          />
                          <button type="button" onClick={saveName} disabled={nameDraft.trim().length < 2} className="h-10 md:h-9 px-4 rounded-lg text-[13px] font-medium bg-pfg text-pfg disabled:opacity-40 shrink-0">
                            {t.save}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-md:flex-wrap items-center justify-between gap-x-3 gap-y-1 md:gap-3 mb-2 text-[12px] text-pfaint min-w-0">
                        <span>{current.aiEnabled ? t.aiOn : t.aiOff}</span>
                        {me?.name && (
                          <span className="min-w-0 break-words">
                            {t.seenAs} <span className="text-pfg2">{me.name}</span> ·{" "}
                            <button
                              type="button"
                              className="hover:text-pfg tap"
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
                      className="flex items-end gap-2 rounded-xl px-3 py-1.5 md:py-2"
                      style={{ background: "#FFFFFF", border: "1px solid rgba(10,10,10,0.068)" }}
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
                        className="flex-1 min-w-0 h-10 md:h-9 bg-transparent text-[16px] md:text-[14px] text-pfg outline-none placeholder:text-pfaint"
                      />
                      <button
                        type="submit"
                        disabled={busy || !draft.trim()}
                        aria-label={t.send}
                        className="h-10 w-10 md:h-8 md:w-8 shrink-0 rounded-lg flex items-center justify-center bg-pfg text-pfg disabled:bg-psoft disabled:text-pfaint transition-colors"
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
