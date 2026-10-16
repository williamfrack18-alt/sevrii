"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { visitorChatPollAction, visitorChatSendAction, type ChatMsg } from "@/app/chatActions";

const TEXT = {
  es: {
    open: "Chatea con nosotros",
    teaser: "¿Tienes preguntas? Escríbenos 👋",
    title: (biz: string) => biz,
    status: "Responde al instante",
    hello: (biz: string) => `¡Hola! 👋 Soy el asistente de ${biz}. Pregúntame por precios, servicios o disponibilidad.`,
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    interest: (svc: string) => `Hola, me interesa: ${svc}`,
    note: (biz: string) => `Asistente con IA. ${biz} confirma precios y citas.`,
    waiting: (biz: string) => `${biz} verá tu mensaje y te responderá aquí o por el medio que dejaste.`,
    owner: "Dueño",
    realPerson: "Persona real",
    assistant: (biz: string) => `Asistente virtual de ${biz}`,
    joined: (who: string) => `${who} se unió a la conversación`,
    talkingWith: (who: string) => `Hablas con ${who}`,
    ownerOf: (biz: string) => `Dueño de ${biz}`,
    online: "En línea ahora",
    errors: { closed: "El chat no está disponible ahora.", rate: "Vas muy rápido. Espera un momento.", long: "El mensaje es muy largo.", empty: "", failed: "No se pudo enviar. Inténtalo de nuevo." },
    close: "Cerrar",
  },
  en: {
    open: "Chat with us",
    teaser: "Got questions? Message us 👋",
    title: (biz: string) => biz,
    status: "Replies instantly",
    hello: (biz: string) => `Hi! 👋 I'm ${biz}'s assistant. Ask me about prices, services or availability.`,
    placeholder: "Type your message…",
    send: "Send",
    interest: (svc: string) => `Hi, I'm interested in: ${svc}`,
    note: (biz: string) => `AI assistant. ${biz} confirms prices and appointments.`,
    waiting: (biz: string) => `${biz} will see your message and reply here or using the contact you left.`,
    owner: "Owner",
    realPerson: "Real person",
    assistant: (biz: string) => `${biz}'s virtual assistant`,
    joined: (who: string) => `${who} joined the conversation`,
    talkingWith: (who: string) => `You're talking with ${who}`,
    ownerOf: (biz: string) => `Owner of ${biz}`,
    online: "Online now",
    errors: { closed: "Chat isn't available right now.", rate: "You're going fast. Wait a moment.", long: "That message is too long.", empty: "", failed: "Couldn't send. Please try again." },
    close: "Close",
  },
};

function storeGet(k: string): string {
  try {
    return localStorage.getItem(k) || "";
  } catch {
    return "";
  }
}
function storeSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    // private mode: the chat still works for this visit
  }
}

function Avatar({ src, name, className }: { src: string; name: string; className: string }) {
  return (
    <span className={className}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export default function ChatWidget({
  slug,
  businessName,
  logoUrl,
  ownerName,
  ownerPhoto,
  lang,
}: {
  slug: string;
  businessName: string;
  logoUrl: string;
  ownerName: string;
  ownerPhoto: string;
  lang: "es" | "en";
}) {
  const t = TEXT[lang];
  const key = `sevrii_chat_${slug}`;
  const [open, setOpen] = useState(false);
  const [teaser, setTeaser] = useState(false);
  const [token, setToken] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSeq = msgs.length ? msgs[msgs.length - 1].seq : 0;
  // Once the owner answers, the chat shows the real person (name + photo).
  const ownerLabel = ownerName || (lang === "es" ? "El dueño" : "The owner");
  const ownerMsgs = msgs.filter((m) => m.role === "owner");
  const ownerHere = ownerMsgs.length > 0;
  const lastOwnerAt = ownerHere ? Date.parse(ownerMsgs[ownerMsgs.length - 1].at) : 0;
  const ownerRecent = ownerHere && Date.now() - lastOwnerAt < 10 * 60 * 1000;

  // Resume an earlier conversation on this device.
  useEffect(() => {
    const saved = storeGet(key);
    if (saved) setToken(saved);
    if (new URLSearchParams(window.location.search).get("chat") === "1") setOpen(true);
    const timer = setTimeout(() => {
      if (!storeGet(`${key}_teased`)) setTeaser(true);
    }, 9000);
    return () => clearTimeout(timer);
  }, [key]);

  // Buttons on the page ("Chat now", a service's chat button) open the chat.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const svc = (e as CustomEvent<string>).detail;
      setOpen(true);
      setTeaser(false);
      if (svc) setDraft((d) => d || t.interest(svc));
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    window.addEventListener("sevrii:chat", onOpen);
    return () => window.removeEventListener("sevrii:chat", onOpen);
  }, [t]);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const res = await visitorChatPollAction({ slug, token, after: lastSeq });
      if (res.ok && res.messages.length) {
        setMsgs((cur) => {
          const seen = new Set(cur.map((m) => m.seq));
          return [...cur, ...res.messages.filter((m) => !seen.has(m.seq))];
        });
        if (res.messages.some((m) => m.role === "owner")) setWaiting(false);
      }
    } catch {
      // try again on the next tick
    }
  }, [slug, token, lastSeq]);

  // While the window is open, check for the owner's replies.
  useEffect(() => {
    if (!open || !token) return;
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [open, token, poll]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open, sending]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    setDraft("");
    setMsgs((cur) => [...cur, { seq: Number.MAX_SAFE_INTEGER, role: "visitor", content: text, at: new Date().toISOString() }]);
    try {
      const res = await visitorChatSendAction({ slug, token: token || undefined, text });
      if (res.ok) {
        if (res.token !== token) {
          setToken(res.token);
          storeSet(key, res.token);
        }
        setMsgs(res.messages);
        setWaiting(res.waiting);
      } else {
        setMsgs((cur) => cur.filter((m) => m.seq !== Number.MAX_SAFE_INTEGER));
        setDraft(text);
        setError(t.errors[res.error] || t.errors.failed);
      }
    } catch {
      setMsgs((cur) => cur.filter((m) => m.seq !== Number.MAX_SAFE_INTEGER));
      setDraft(text);
      setError(t.errors.failed);
    } finally {
      setSending(false);
    }
  }

  function toggle() {
    setOpen((o) => !o);
    setTeaser(false);
    storeSet(`${key}_teased`, "1");
  }

  return (
    <div className="cw">
      {open && (
        <div className="cw-panel" role="dialog" aria-label={t.open}>
          <div className={`cw-head ${ownerHere ? "owner" : ""}`}>
            {ownerHere ? (
              <Avatar src={ownerPhoto} name={ownerLabel} className="cw-avatar" />
            ) : (
              <Avatar src={logoUrl} name={businessName} className="cw-avatar" />
            )}
            <div className="cw-head-text">
              <div className="cw-name">{ownerHere ? `${ownerLabel} · ${businessName}` : t.title(businessName)}</div>
              <div className="cw-status">
                <span className="cw-dot" /> {ownerHere ? (ownerRecent ? t.online : t.talkingWith(ownerLabel)) : t.status}
              </div>
            </div>
            <button type="button" className="cw-x" aria-label={t.close} onClick={toggle}>
              ×
            </button>
          </div>
          <div className="cw-list" ref={listRef}>
            <div className="cw-from">✨ {t.assistant(businessName)}</div>
            <div className="cw-msg ai">{t.hello(businessName)}</div>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const firstOwner = m.role === "owner" && !msgs.slice(0, i).some((x) => x.role === "owner");
              const showFrom = m.role !== "visitor" && (!prev || prev.role !== m.role);
              return (
                <div key={`${m.seq}-${i}`} className="cw-row">
                  {firstOwner && <div className="cw-joined">👋 {t.joined(ownerLabel)}</div>}
                  {showFrom && m.role === "ai" && <div className="cw-from">✨ {t.assistant(businessName)}</div>}
                  {showFrom && m.role === "owner" && (
                    <div className="cw-from owner">
                      <Avatar src={ownerPhoto} name={ownerLabel} className="cw-mini" />
                      <span>
                        <strong>{ownerLabel}</strong> · {t.ownerOf(businessName)}
                      </span>
                      <span className="cw-real">✓ {t.realPerson}</span>
                    </div>
                  )}
                  <div className={`cw-msg ${m.role}`}>{m.content}</div>
                </div>
              );
            })}
            {sending && (
              <div className="cw-msg ai cw-typing" aria-label="…">
                <span />
                <span />
                <span />
              </div>
            )}
            {waiting && !sending && !ownerHere && <div className="cw-wait">{t.waiting(businessName)}</div>}
          </div>
          {error && <div className="cw-error">{error}</div>}
          <form
            className="cw-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <textarea
              ref={inputRef}
              value={draft}
              rows={1}
              maxLength={600}
              placeholder={t.placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <button type="submit" disabled={sending || !draft.trim()} aria-label={t.send}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
          <div className="cw-note">{t.note(businessName)}</div>
        </div>
      )}
      {!open && teaser && (
        <button type="button" className="cw-teaser" onClick={toggle}>
          {t.teaser}
        </button>
      )}
      <button type="button" className={`cw-fab ${open ? "on" : ""}`} onClick={toggle} aria-label={t.open}>
        {open ? (
          <span className="cw-fab-x">×</span>
        ) : (
          <>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z" />
            </svg>
            <span className="cw-fab-label">{t.open}</span>
          </>
        )}
      </button>
    </div>
  );
}
