"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { visitorChatPollAction, visitorChatSendAction, type ChatMsg } from "@/app/chatActions";

const TEXT = {
  es: {
    open: "Chatea con nosotros",
    teaser: "¿Tienes preguntas? Escríbenos 👋",
    title: (biz: string) => biz,
    status: "En línea · asistente que responde al instante",
    hello: (_biz: string) => `¡Hola! 👋 Gracias por escribirnos. ¿En qué te podemos ayudar?`,
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
    status: "Online · assistant that replies instantly",
    hello: (_biz: string) => `Hi! 👋 Thanks for reaching out. How can we help you?`,
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
  pick,
}: {
  pick?: string; // a service the visitor just picked above the chat
  slug: string;
  businessName: string;
  logoUrl: string;
  ownerName: string;
  ownerPhoto: string;
  lang: "es" | "en";
}) {
  const t = TEXT[lang];
  const key = `sevrii_chat_${slug}`;
  const rootRef = useRef<HTMLDivElement>(null);
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
  // The header shows the owner only while they're the one answering: if they
  // hand the chat back to the assistant, the assistant is shown again.
  const lastReply = [...msgs].reverse().find((m) => m.role !== "visitor");
  const ownerHere = ownerMsgs.length > 0 && lastReply?.role === "owner";
  const lastOwnerAt = ownerHere ? Date.parse(ownerMsgs[ownerMsgs.length - 1].at) : 0;
  const ownerRecent = ownerHere && Date.now() - lastOwnerAt < 10 * 60 * 1000;

  // Resume an earlier conversation on this device.
  useEffect(() => {
    const saved = storeGet(key);
    if (saved) setToken(saved);
    if (new URLSearchParams(window.location.search).get("chat") === "1") {
      setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }, [key]);

  // Picking a service above the chat writes it in the box (unless they typed something else).
  useEffect(() => {
    if (!pick) return;
    const prefix = t.interest("");
    setDraft((d) => (!d.trim() || d.startsWith(prefix) ? t.interest(pick) : d));
  }, [pick, t]);

  // Buttons on the page ("Chat", a service's chat button, the floating button)
  // bring the visitor to this chat with the service already written.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const svc = (e as CustomEvent<string>).detail;
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (svc) setDraft((d) => d || t.interest(svc));
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 450);
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

  // Check for the owner's replies while the page is open.
  useEffect(() => {
    if (!token) return;
    poll();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 6000);
    return () => clearInterval(id);
  }, [token, poll]);

  useEffect(() => {
    // After the new bubbles are laid out, show the newest one.
    const raf = requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }));
    return () => cancelAnimationFrame(raf);
  }, [msgs, sending, waiting]);

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

  return (
    <div className="cw-inline" ref={rootRef} aria-label={t.open}>
      <div className="cw-panel">
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
          </div>
          <div className="cw-list" ref={listRef}>
            <div className="cw-row cw-hello">
              <Avatar src={logoUrl} name={businessName} className="cw-mini" />
              <div className="cw-msg ai">{t.hello(businessName)}</div>
            </div>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const firstOwner = m.role === "owner" && !msgs.slice(0, i).some((x) => x.role === "owner");
              const showFrom = m.role !== "visitor" && (!prev || prev.role !== m.role);
              return (
                <div key={`${m.seq}-${i}`} className="cw-row">
                  {firstOwner && <div className="cw-joined">👋 {t.joined(ownerLabel)}</div>}

                  {showFrom && m.role === "owner" && (
                    <div className="cw-from owner">
                      <Avatar src={ownerPhoto} name={ownerLabel} className="cw-mini" />
                      <span>
                        <strong>{ownerLabel}</strong> · {t.ownerOf(businessName)}
                      </span>
                      <span className="cw-real">✓ {t.realPerson}</span>
                    </div>
                  )}
                  {showFrom && m.role === "ai" && msgs.slice(0, i).some((x) => x.role === "owner") && (
                    <div className="cw-from">
                      <Avatar src={logoUrl} name={businessName} className="cw-mini" />
                      <span>{t.assistant(businessName)}</span>
                    </div>
                  )}
                  <div className={`cw-msg ${m.role}`}>{m.content.replace(/\*\*(.+?)\*\*/g, "$1")}</div>
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
            {waiting && !sending && !ownerMsgs.length && <div className="cw-wait">{t.waiting(businessName)}</div>}
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
          {ownerHere && <div className="cw-note">{`${t.talkingWith(ownerLabel)} · ${t.ownerOf(businessName)}`}</div>}
      </div>
    </div>
  );
}

// Floating button: takes the visitor to the chat (hidden while the chat is on screen).
export function ChatJump({ lang }: { lang: "es" | "en" }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const target = document.getElementById("chat");
    if (!target) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && window.scrollY > 300), { threshold: 0.15 });
    io.observe(target);
    const onScroll = () => {
      const r = target.getBoundingClientRect();
      setShow(window.scrollY > 300 && (r.bottom < 0 || r.top > window.innerHeight * 0.85));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  if (!show) return null;
  return (
    <button type="button" className="cw-fab" onClick={() => window.dispatchEvent(new CustomEvent("sevrii:chat", { detail: "" }))}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z" />
      </svg>
      <span className="cw-fab-label">{TEXT[lang].open}</span>
    </button>
  );
}
