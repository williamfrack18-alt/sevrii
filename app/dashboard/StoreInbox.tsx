"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@/components/LangProvider";
import {
  listInboxAction,
  openInboxConversationAction,
  ownerReplyAction,
  setConversationAiAction,
  type ChatMsg,
  type InboxConversation,
} from "@/app/chatActions";
import { formatPhone } from "@/lib/site";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

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
    pick: "Elige una conversación",
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
    pick: "Pick a conversation",
  },
};

function when(iso: string, lang: "es" | "en") {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(lang === "es" ? "es-US" : "en-US", today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric" });
}

export default function StoreInbox({ businessId }: { businessId: string }) {
  const lang = useLang();
  const t = TEXT[lang];
  const [list, setList] = useState<InboxConversation[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
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

  if (list === null) return null;
  const unread = list.filter((c) => c.ownerUnread > 0).length;
  const pill = "h-8 px-3 rounded-full text-[12.5px] font-medium inline-flex items-center";

  return (
    <div id="inbox" className="rounded-2xl p-4 md:p-5 mb-5 scroll-mt-4" style={{ background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}>
      <div className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold text-white">💬 {t.title}</h3>
        {unread > 0 && (
          <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: ACCENT, color: "#04120a" }}>
            {unread}
          </span>
        )}
      </div>
      <p className="text-[13px] text-[#9a9a9a] mt-1">{t.sub}</p>

      {list.length === 0 ? (
        <p className="text-[13px] text-[#8e8e8e] mt-3 rounded-xl p-4" style={{ border: "1px dashed rgba(255,255,255,.15)" }}>
          {t.empty}
        </p>
      ) : (
        <div className="grid md:grid-cols-[280px_minmax(0,1fr)] gap-3 mt-4">
          {/* List */}
          <div className={`flex flex-col gap-1.5 max-h-[460px] overflow-y-auto ${openId ? "hidden md:flex" : ""}`}>
            {list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setOpenId(c.id)}
                className="text-left rounded-xl px-3 py-2.5"
                style={{ background: c.id === openId ? "#1d1d1d" : "#161616", boxShadow: c.id === openId ? `0 0 0 1px ${ACCENT}` : "0 0 0 1px rgba(255,255,255,.06)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-white truncate">{c.name || t.visitor}</span>
                  <span className="text-[11px] text-[#8e8e8e] shrink-0">{when(c.lastMessageAt, lang)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {c.handoff && (
                    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#ffd34d", color: "#3a2a00" }}>
                      {t.needsYou}
                    </span>
                  )}
                  <span className={`text-[12.5px] truncate ${c.ownerUnread ? "text-white font-medium" : "text-[#9a9a9a]"}`}>{c.lastMessage}</span>
                  {c.ownerUnread > 0 && <span className="ml-auto w-2 h-2 rounded-full shrink-0" style={{ background: ACCENT }} />}
                </div>
              </button>
            ))}
          </div>

          {/* Thread */}
          <div className={`rounded-xl flex flex-col min-h-[360px] ${openId ? "" : "hidden md:flex"}`} style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,.07)" }}>
            {!current ? (
              <div className="m-auto text-[13px] text-[#8e8e8e]">{t.pick}</div>
            ) : (
              <>
                <div className="px-4 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                  <button type="button" className="md:hidden text-[13px] mr-1" style={{ color: ACCENT }} onClick={() => setOpenId(null)}>
                    {t.back}
                  </button>
                  <div className="min-w-0 mr-auto">
                    <div className="text-[14.5px] font-semibold text-white truncate">{current.name || t.visitor}</div>
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
                <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 max-h-[340px]">
                  {msgs.map((m) => (
                    <div
                      key={m.seq}
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap break-words ${m.role === "visitor" ? "self-start" : "self-end"}`}
                      style={
                        m.role === "visitor"
                          ? { background: "#262626", color: "#f1f1f1" }
                          : m.role === "owner"
                            ? { background: ACCENT, color: "#04120a" }
                            : { background: "rgba(46,122,85,.22)", color: "#e8f5ee" }
                      }
                    >
                      <div className="text-[10.5px] font-semibold opacity-70 mb-0.5">{m.role === "visitor" ? t.customer : m.role === "owner" ? t.you : `✨ ${t.ai}`}</div>
                      {m.content}
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,.07)" }}>
                  <div className="text-[11.5px] mb-1.5" style={{ color: current.aiEnabled ? ACCENT : "#d4a72c" }}>
                    {current.aiEnabled ? `✨ ${t.aiOn}` : `👤 ${t.aiOff}`}
                  </div>
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
                      className="flex-1 h-10 rounded-full px-4 text-[14px] text-white outline-none"
                      style={{ background: "#1f1f1f", boxShadow: "0 0 0 1px rgba(255,255,255,.1)" }}
                    />
                    <button type="submit" disabled={busy || !draft.trim()} className="h-10 px-4 rounded-full text-[13.5px] font-semibold disabled:opacity-50" style={BRAND_BTN}>
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
