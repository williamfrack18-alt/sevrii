"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import {
  listInboxAction,
  openInboxConversationAction,
  ownerReplyAction,
  setConversationAiAction,
  getOwnerProfileAction,
  setOwnerNameAction,
  type ChatMsg,
  type InboxConversation,
} from "@/app/chatActions";
import { formatPhone } from "@/lib/site";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";
import StoreNotify from "./StoreNotify";

const TEXT = {
  es: {
    title: "Conversaciones",
    sub: "Lo que te escriben en el chat de tu página. La IA responde al instante con la info de tu tienda y te avisa por correo cuando alguien quiere agendar. Puedes contestar tú cuando quieras.",
    empty: "Todavía no hay conversaciones. Cuando alguien escriba en el chat de tu página, aparece aquí.",
    visitor: "Visitante",
    needsYou: "Te necesita",
    ai: "IA",
    you: "Tú",
    customer: "Cliente",
    aiOn: "La IA responde",
    aiOff: "Respondes tú",
    turnAiOn: "Dejar que la IA responda",
    turnAiOff: "Pausar IA",
    placeholder: "Escribe tu respuesta…",
    send: "Enviar",
    hint: "Al responder tú, la IA se pausa en esta conversación. Si el cliente ya no está en la página y dejó correo, le llega por email.",
    call: "Llamar",
    text: "Texto",
    email: "Correo",
    back: "← Conversaciones",
    pick: "Elige una conversación para verla aquí.",
    all: "Todas",
    needs: "Te necesitan",
    unreadF: "Sin leer",
    alerts: "Avisos",
    noneFilter: "No hay conversaciones en este filtro.",
    draft: "Tu página está en borrador: el chat solo lo ves tú. Publícala para que los clientes puedan escribirte.",
    goStore: "Ir a Store",
    legendAi: "✨ IA = respuesta automática",
    legendYou: "Tú = tu respuesta",
    seenAs: "Los clientes te ven como",
    change: "Cambiar",
    save: "Guardar",
    namePh: "Tu nombre, ej. Carlos",
    askName: "¿Cómo te llamas? Cuando respondas, el cliente verá tu nombre y tu foto con «Persona real», para que sepa que habla contigo.",
    photoHint: "Tu foto es la foto principal de tu tienda.",
  },
  en: {
    title: "Conversations",
    sub: "What people write in your page's chat. The AI answers instantly with your store info and emails you when someone wants to book. You can reply yourself any time.",
    empty: "No conversations yet. When someone writes in your page's chat, it shows up here.",
    visitor: "Visitor",
    needsYou: "Needs you",
    ai: "AI",
    you: "You",
    customer: "Customer",
    aiOn: "AI is answering",
    aiOff: "You're answering",
    turnAiOn: "Let the AI answer",
    turnAiOff: "Pause AI",
    placeholder: "Type your reply…",
    send: "Send",
    hint: "When you reply, the AI pauses in this conversation. If the customer left the page and gave an email, they get it by email.",
    call: "Call",
    text: "Text",
    email: "Email",
    back: "← Conversations",
    pick: "Pick a conversation to see it here.",
    all: "All",
    needs: "Needs you",
    unreadF: "Unread",
    alerts: "Alerts",
    noneFilter: "No conversations in this filter.",
    draft: "Your page is a draft: only you can see the chat. Publish it so customers can write to you.",
    goStore: "Go to Store",
    legendAi: "✨ AI = automatic answer",
    legendYou: "You = your reply",
    seenAs: "Customers see you as",
    change: "Change",
    save: "Save",
    namePh: "Your name, e.g. Carlos",
    askName: "What's your name? When you reply, the customer sees your name and photo with “Real person”, so they know they're talking with you.",
    photoHint: "Your photo is your store's main photo.",
  },
};

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
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh, businessId]);

  const load = useCallback(async (id: string) => {
    const res = await openInboxConversationAction(id);
    if (res.ok) setMsgs(res.messages);
  }, []);

  useEffect(() => {
    if (!openId) return;
    load(openId);
    const id = setInterval(() => load(openId), 5000);
    return () => clearInterval(id);
  }, [openId, load]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [msgs]);

  async function reply() {
    if (!openId || !draft.trim() || busy) return;
    setBusy(true);
    try {
      const res = await ownerReplyAction(openId, draft);
      if (res.ok) {
        setMsgs(res.messages);
        setDraft("");
        refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleAi() {
    if (!current) return;
    await setConversationAiAction(current.id, !current.aiEnabled);
    refresh();
  }

  const unread = (list ?? []).filter((c) => c.ownerUnread > 0).length;
  const needs = (list ?? []).filter((c) => c.handoff).length;
  const shown = (list ?? []).filter((c) => (filter === "needs" ? c.handoff : filter === "unread" ? c.ownerUnread > 0 : true));
  const pill = "h-8 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center";
  const tab = (on: boolean) => ({ background: on ? "rgba(255,255,255,.12)" : "transparent", color: on ? "#fff" : "#9a9a9a" });

  return (
    <div className="flex flex-col h-[calc(100dvh-118px)] md:h-screen" style={{ background: "#000" }}>
      {/* Header */}
      <div className="shrink-0 px-4 md:px-6 h-14 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
        <span className="text-[17px] font-semibold text-white">
          Sevrii <span className="text-[#8e8e8e] font-normal">· {t.title}</span>
          {unread > 0 && (
            <span className="ml-2 align-middle text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: ACCENT, color: "#04120a" }}>
              {unread}
            </span>
          )}
        </span>
        <button type="button" onClick={() => setShowAlerts((v) => !v)} className="text-[12.5px] px-3 py-1.5 rounded-full font-medium" style={{ background: showAlerts ? TINT : "rgba(255,255,255,.08)", color: showAlerts ? ACCENT : "#d4d4d4" }}>
          🔔 {t.alerts}
        </button>
      </div>

      {showAlerts && (
        <div className="shrink-0 px-4 md:px-6 pt-4 max-h-[50vh] overflow-y-auto">
          <StoreNotify />
        </div>
      )}
      {!published && (
        <div className="shrink-0 mx-4 md:mx-6 mt-3 rounded-xl px-4 py-3 text-[13px] flex flex-wrap items-center justify-between gap-2" style={{ background: "rgba(212,167,44,.12)", color: "#e8cf86", boxShadow: "0 0 0 1px rgba(212,167,44,.3)" }}>
          <span>{t.draft}</span>
          <button type="button" onClick={onStore} className="text-[12.5px] font-semibold underline">
            {t.goStore}
          </button>
        </div>
      )}

      {list === null ? (
        <div className="m-auto text-[13px] text-[#8e8e8e]">…</div>
      ) : list.length === 0 ? (
        <div className="m-auto max-w-[420px] text-center px-6">
          <div className="text-[34px]">💬</div>
          <p className="text-[14px] text-[#cfcfcf] mt-2">{t.empty}</p>
          <p className="text-[12.5px] text-[#8e8e8e] mt-2">{t.sub}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid md:grid-cols-[320px_minmax(0,1fr)]">
          {/* List */}
          <div className={`min-h-0 flex-col ${openId ? "hidden md:flex" : "flex"}`} style={{ borderRight: "1px solid rgba(255,255,255,.08)" }}>
            <div className="shrink-0 flex gap-1 p-3">
              <button type="button" className="h-8 px-3 rounded-full text-[12.5px] font-medium" style={tab(filter === "all")} onClick={() => setFilter("all")}>
                {t.all} {list.length}
              </button>
              <button type="button" className="h-8 px-3 rounded-full text-[12.5px] font-medium" style={tab(filter === "needs")} onClick={() => setFilter("needs")}>
                {t.needs} {needs || ""}
              </button>
              <button type="button" className="h-8 px-3 rounded-full text-[12.5px] font-medium" style={tab(filter === "unread")} onClick={() => setFilter("unread")}>
                {t.unreadF} {unread || ""}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1">
              {shown.length === 0 && <p className="text-[12.5px] text-[#8e8e8e] px-3 py-4">{t.noneFilter}</p>}
              {shown.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setOpenId(c.id)}
                  className="text-left rounded-xl px-3 py-3"
                  style={{ background: c.id === openId ? "#1a1a1a" : "transparent", boxShadow: c.id === openId ? `inset 3px 0 0 ${ACCENT}` : "none" }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0" style={{ background: "#262626", color: "#e5e5e5" }}>
                      {(c.name || t.visitor).slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[14px] truncate ${c.ownerUnread ? "text-white font-semibold" : "text-[#e5e5e5] font-medium"}`}>{c.name || t.visitor}</span>
                        <span className="text-[11px] text-[#8e8e8e] shrink-0">{when(c.lastMessageAt, lang)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {c.handoff && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0" style={{ background: "#ffd34d", color: "#3a2a00" }}>
                            {t.needsYou}
                          </span>
                        )}
                        <span className={`text-[12.5px] truncate ${c.ownerUnread ? "text-[#e5e5e5]" : "text-[#8e8e8e]"}`}>{c.lastMessage}</span>
                        {c.ownerUnread > 0 && <span className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: ACCENT }} />}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Thread */}
          <div className={`min-h-0 flex-col ${openId ? "flex" : "hidden md:flex"}`}>
            {!current ? (
              <div className="m-auto text-center px-6">
                <p className="text-[13.5px] text-[#8e8e8e]">{t.pick}</p>
                <p className="text-[12px] text-[#6e6e6e] mt-2">
                  {t.legendAi} · {t.legendYou}
                </p>
              </div>
            ) : (
              <>
                <div className="shrink-0 px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,.08)" }}>
                  <button type="button" className="md:hidden text-[13px] mr-1" style={{ color: ACCENT }} onClick={() => setOpenId(null)}>
                    {t.back}
                  </button>
                  <div className="min-w-0 mr-auto">
                    <div className="text-[15px] font-semibold text-white truncate">{current.name || t.visitor}</div>
                    <div className="text-[12px] text-[#9a9a9a] truncate">{[current.phone ? formatPhone(current.phone) : "", current.email].filter(Boolean).join(" · ")}</div>
                  </div>
                  {current.phone && (
                    <>
                      <a href={`tel:${current.phone}`} className={pill} style={{ background: TINT, color: ACCENT }}>
                        📞 {t.call}
                      </a>
                      <a href={`sms:${current.phone}`} className={pill} style={{ background: "rgba(255,255,255,.08)", color: "#e5e5e5" }}>
                        💬 {t.text}
                      </a>
                    </>
                  )}
                  {current.email && (
                    <a href={`mailto:${current.email}`} className={pill} style={{ background: "rgba(255,255,255,.08)", color: "#e5e5e5" }}>
                      ✉️ {t.email}
                    </a>
                  )}
                  <button type="button" onClick={toggleAi} className={pill} style={{ background: "rgba(255,255,255,.08)", color: "#e5e5e5" }}>
                    {current.aiEnabled ? `⏸ ${t.turnAiOff}` : `✨ ${t.turnAiOn}`}
                  </button>
                </div>
                <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-4 flex flex-col gap-2.5">
                  {msgs.map((m) => (
                    <div
                      key={m.seq}
                      className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${m.role === "visitor" ? "self-start" : "self-end"}`}
                      style={
                        m.role === "visitor"
                          ? { background: "#232323", color: "#f1f1f1", borderBottomLeftRadius: 6 }
                          : m.role === "owner"
                            ? { background: ACCENT, color: "#04120a", borderBottomRightRadius: 6 }
                            : { background: "rgba(46,122,85,.2)", color: "#e8f5ee", boxShadow: "inset 0 0 0 1px rgba(46,122,85,.45)", borderBottomRightRadius: 6 }
                      }
                    >
                      <div className="text-[10.5px] font-semibold opacity-70 mb-0.5">{m.role === "visitor" ? current.name || t.customer : m.role === "owner" ? `${t.you}${me?.name ? ` (${me.name})` : ""}` : `✨ ${t.ai}`}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
                <div className="shrink-0 px-3 md:px-6 pb-4 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-[11.5px]" style={{ color: current.aiEnabled ? ACCENT : "#d4a72c" }}>
                      {current.aiEnabled ? `✨ ${t.aiOn}` : `👤 ${t.aiOff}`}
                    </span>
                    {me && !editName && me.name && (
                      <span className="flex items-center gap-2 text-[12px] text-[#a1a1a1]">
                        {t.seenAs}:
                        <span className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[11px] font-bold" style={{ background: "#262626", color: "#e5e5e5" }}>
                          {me.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={me.photo} alt="" className="w-full h-full object-cover" />
                          ) : (
                            me.name.slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <strong className="text-white">{me.name}</strong>
                        <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: TINT, color: ACCENT }}>
                          ✓ {lang === "es" ? "Persona real" : "Real person"}
                        </span>
                        <button
                          type="button"
                          className="underline"
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
                  {me && editName && (
                    <div className="rounded-xl p-3 mb-2" style={{ background: "#161616", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}>
                      <p className="text-[12.5px] text-[#cfcfcf]">{t.askName}</p>
                      <div className="flex gap-2 mt-2">
                        <input
                          value={nameDraft}
                          onChange={(e) => setNameDraft(e.target.value)}
                          placeholder={t.namePh}
                          maxLength={40}
                          className="flex-1 h-9 rounded-full px-3 text-[13.5px] text-white outline-none"
                          style={{ background: "#1f1f1f", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}
                        />
                        <button type="button" onClick={saveName} disabled={nameDraft.trim().length < 2} className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-50" style={BRAND_BTN}>
                          {t.save}
                        </button>
                      </div>
                      <p className="text-[11.5px] text-[#7a7a7a] mt-1.5">{t.photoHint}</p>
                    </div>
                  )}
                  <form
                    className="flex gap-2"
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
                      className="flex-1 h-11 rounded-full px-4 text-[14px] text-white outline-none"
                      style={{ background: "#1a1a1a", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}
                    />
                    <button type="submit" disabled={busy || !draft.trim()} className="h-11 px-5 rounded-full text-[14px] font-semibold disabled:opacity-50" style={BRAND_BTN}>
                      {t.send}
                    </button>
                  </form>
                  <p className="text-[11.5px] text-[#7a7a7a] mt-1.5">{t.hint}</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
