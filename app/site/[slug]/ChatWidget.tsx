"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { agentCheckoutAction, agentClaimAction, agentReviewAction, agentReviewStateAction, visitorChatPollAction, visitorChatSendAction, type ChatMsg, type MyReview } from "@/app/chatActions";

// The page chat as the owner's service agent (see lib/serviceAgent.ts).
export type ChatAgent = { name: string; greeting: string; offers: { id: string; title: string; detail: string; label: string; welcome?: string }[] };
const PAY = /\s*\[\[pay\]\]\s*$/;
// Official links the agent cites (and the owner's WhatsApp) open in a new tab.
const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?¿¡"'])/g;
function Linked({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <a key={i} href={p} target="_blank" rel="noopener noreferrer nofollow" className="cw-link">
            {p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
          </a>
        ) : (
          p
        )
      )}
    </>
  );
}

const TEXT = {
  es: {
    open: "Chatea con nosotros",
    title: (biz: string) => biz,
    status: "En línea · asistente que responde al instante",
    hello: (_biz: string) => `¡Hola! 👋 Gracias por escribirnos. ¿En qué te podemos ayudar?`,
    placeholder: "Escribe tu mensaje…",
    send: "Enviar",
    interest: (svc: string) => `Hola, me interesa: ${svc}`,
    waiting: (biz: string) => `${biz} verá tu mensaje y te responderá aquí o por el medio que dejaste.`,
    realPerson: "Persona real",
    assistant: (biz: string) => `Asistente virtual de ${biz}`,
    joined: (who: string) => `${who} se unió a la conversación`,
    talkingWith: (who: string) => `Hablas con ${who}`,
    ownerOf: (biz: string) => `Dueño de ${biz}`,
    online: "En línea ahora",
    errors: { closed: "El chat no está disponible ahora.", rate: "Vas muy rápido. Espera un momento.", long: "El mensaje es muy largo.", empty: "", failed: "No se pudo enviar. Inténtalo de nuevo." },
    message: "Tu mensaje",
    typing: "Escribiendo…",
    agentStatus: (biz: string) => `Agente de IA de ${biz} · responde al instante`,
    agentHello: "¡Hola! Cuéntame qué necesitas y empezamos.",
    paying: "Abriendo el pago…",
    payFailed: "No se pudo abrir el pago. Inténtalo de nuevo.",
    securePay: "Pago seguro con tarjeta. Al terminar vuelves a este chat.",
    rate: (name: string) => `Califica a ${name}`,
    myRating: "Tu reseña",
    edit: "Cambiar",
    reviewText: "¿Qué tal te ayudó? (opcional)",
    reviewName: "Tu nombre (opcional)",
    reviewSend: "Publicar reseña",
    reviewThanks: "Gracias, tu reseña ya está en la página.",
    star: (n: number) => `${n} de 5`,
  },
  en: {
    open: "Chat with us",
    title: (biz: string) => biz,
    status: "Online · assistant that replies instantly",
    hello: (_biz: string) => `Hi! 👋 Thanks for reaching out. How can we help you?`,
    placeholder: "Type your message…",
    send: "Send",
    interest: (svc: string) => `Hi, I'm interested in: ${svc}`,
    waiting: (biz: string) => `${biz} will see your message and reply here or using the contact you left.`,
    realPerson: "Real person",
    assistant: (biz: string) => `${biz}'s virtual assistant`,
    joined: (who: string) => `${who} joined the conversation`,
    talkingWith: (who: string) => `You're talking with ${who}`,
    ownerOf: (biz: string) => `Owner of ${biz}`,
    online: "Online now",
    errors: { closed: "Chat isn't available right now.", rate: "You're going fast. Wait a moment.", long: "That message is too long.", empty: "", failed: "Couldn't send. Please try again." },
    message: "Your message",
    typing: "Typing…",
    agentStatus: (biz: string) => `${biz}'s AI agent · replies instantly`,
    agentHello: "Hi! Tell me what you need and we'll get started.",
    paying: "Opening checkout…",
    payFailed: "Couldn't open checkout. Please try again.",
    securePay: "Secure card payment. You'll come back to this chat when done.",
    rate: (name: string) => `Rate ${name}`,
    myRating: "Your review",
    edit: "Edit",
    reviewText: "How did it help you? (optional)",
    reviewName: "Your name (optional)",
    reviewSend: "Post review",
    reviewThanks: "Thanks, your review is on the page now.",
    star: (n: number) => `${n} of 5`,
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

// The campaign (ad link) that brought this visitor, kept 30 days on this device
// so a chat started later still counts for it.
const REF_DAYS = 30;
function refGet(k: string): string {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return "";
    const v = JSON.parse(raw) as { c?: unknown; at?: unknown };
    if (typeof v?.c !== "string" || typeof v?.at !== "number") return "";
    if (Date.now() - v.at > REF_DAYS * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(k);
      return "";
    }
    return /^[A-Za-z0-9_-]{1,64}$/.test(v.c) ? v.c : "";
  } catch {
    return "";
  }
}
function refSet(k: string, c: string) {
  try {
    localStorage.setItem(k, JSON.stringify({ c, at: Date.now() }));
  } catch {
    // private mode: the visit still counts, just not a later chat
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
  campaign,
  agent,
}: {
  agent?: ChatAgent | null;
  pick?: string; // a service the visitor just picked above the chat
  campaign?: string; // the campaign whose link brought the visitor (already checked by the page)
  slug: string;
  businessName: string;
  logoUrl: string;
  ownerName: string;
  ownerPhoto: string;
  lang: "es" | "en";
}) {
  const t = TEXT[lang];
  const key = `sevrii_chat_${slug}`;
  const refKey = `sevrii_ref_${slug}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [token, setToken] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledOnce = useRef(false);
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
  // Only the newest "pay" message shows the buttons.
  const payAt = agent ? msgs.reduce((at, m, i) => (m.role === "ai" && PAY.test(m.content) ? i : at), -1) : -1;
  const [paying, setPaying] = useState("");

  async function buy(offerId: string) {
    if (!token || paying) return;
    setError("");
    setPaying(offerId);
    try {
      const res = await agentCheckoutAction({ slug, token, offerId });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setError(t.payFailed);
    } catch {
      setError(t.payFailed);
    }
    setPaying("");
  }

  // Back from Stripe: confirm the payment (checked with Stripe on the server).
  useEffect(() => {
    if (!agent) return;
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("agent_paid");
    const saved = storeGet(key);
    if (!sessionId || !saved) return;
    params.delete("agent_paid");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    agentClaimAction({ slug, token: saved, sessionId })
      .then((res) => {
        if (res.ok) setMsgs(res.messages);
      })
      .catch(() => {});
  }, [agent, key, slug]);

  // Resume an earlier conversation on this device.
  useEffect(() => {
    const saved = storeGet(key);
    if (saved) setToken(saved);
    if (new URLSearchParams(window.location.search).get("chat") === "1") {
      setTimeout(() => rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
    }
  }, [key]);

  // Remember the campaign that brought them (the latest ad link wins).
  useEffect(() => {
    if (campaign) refSet(refKey, campaign);
  }, [campaign, refKey]);

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
    // After the new bubbles are laid out, show the newest one (instantly the
    // first time, so a resumed chat doesn't open on its oldest messages).
    const el = listRef.current;
    if (!el) return;
    const first = !scrolledOnce.current;
    if (msgs.length) scrolledOnce.current = true;
    const raf = requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" }));
    const late = first ? setTimeout(() => el.scrollTo({ top: el.scrollHeight }), 400) : undefined;
    return () => {
      cancelAnimationFrame(raf);
      if (late) clearTimeout(late);
    };
  }, [msgs, sending, waiting]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    setDraft("");
    setMsgs((cur) => [...cur, { seq: Number.MAX_SAFE_INTEGER, role: "visitor", content: text, at: new Date().toISOString() }]);
    try {
      // The campaign only counts for the message that starts a conversation (the
      // server ignores it on later ones; sent anyway in case the old chat expired).
      const ref = campaign || refGet(refKey) || undefined;
      const res = await visitorChatSendAction({ slug, token: token || undefined, text, campaign: ref });
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
    <div className="cw-inline" ref={rootRef} role="region" aria-label={t.open}>
      <div className={`cw-panel${agent ? " agent" : ""}`}>
          <div className={`cw-head ${ownerHere ? "owner" : ""}`}>
            {ownerHere ? (
              <Avatar src={ownerPhoto} name={ownerLabel} className="cw-avatar" />
            ) : (
              <Avatar src={logoUrl} name={businessName} className="cw-avatar" />
            )}
            <div className="cw-head-text">
              <div className="cw-name">{ownerHere ? `${ownerLabel} · ${businessName}` : agent ? agent.name : t.title(businessName)}</div>
              <div className="cw-status">
                <span className="cw-dot" /> {ownerHere ? (ownerRecent ? t.online : t.talkingWith(ownerLabel)) : agent ? t.agentStatus(businessName) : t.status}
              </div>
            </div>
          </div>
          <div className="cw-list" ref={listRef} aria-live="polite">
            <div className="cw-row cw-hello">
              <Avatar src={logoUrl} name={businessName} className="cw-mini" />
              <div className="cw-msg ai">{agent ? agent.greeting || t.agentHello : t.hello(businessName)}</div>
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
                      <span>{agent ? agent.name : t.assistant(businessName)}</span>
                    </div>
                  )}
                  <div className={`cw-msg ${m.role}`}>{m.role === "visitor" ? m.content : <Linked text={m.content.replace(PAY, "").replace(/\*\*(.+?)\*\*/g, "$1")} />}</div>
                  {i === payAt && agent && agent.offers.length > 0 && (
                    <div className="cw-offers">
                      {agent.offers.map((o) => (
                        <button key={o.id} type="button" className="cw-offer" disabled={Boolean(paying)} onClick={() => buy(o.id)}>
                          <span className="cw-offer-title">{o.title}</span>
                          {o.detail && <span className="cw-offer-detail">{o.detail}</span>}
                          <span className="cw-offer-price">{paying === o.id ? t.paying : o.label}</span>
                          {o.welcome && <span className="cw-offer-welcome">{o.welcome}</span>}
                        </button>
                      ))}
                      <span className="cw-offer-note">{t.securePay}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {sending && (
              <div className="cw-msg ai cw-typing" role="img" aria-label={t.typing}>
                <span aria-hidden />
                <span aria-hidden />
                <span aria-hidden />
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
              maxLength={agent ? 2000 : 600}
              placeholder={t.placeholder}
              aria-label={t.message}
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
          {agent && token && <AgentReview slug={slug} token={token} name={agent.name} lang={lang} refreshKey={msgs.length} />}
      </div>
    </div>
  );
}

// Floating button: takes the visitor to the chat (hidden while the chat is on screen).
export function ChatJump({ lang, label }: { lang: "es" | "en"; label?: string }) {
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
    <button type="button" className="cw-fab" aria-label={label || TEXT[lang].open} onClick={() => window.dispatchEvent(new CustomEvent("sevrii:chat", { detail: "" }))}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z" />
      </svg>
      <span className="cw-fab-label" aria-hidden>{label || TEXT[lang].open}</span>
    </button>
  );
}

// Customers who paid for the agent can rate it (one review per chat, editable).
function AgentReview({ slug, token, name, lang, refreshKey }: { slug: string; token: string; name: string; lang: "es" | "en"; refreshKey: number }) {
  const t = TEXT[lang];
  const [state, setState] = useState<MyReview | null>(null);
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const paidCheck = state?.canReview ? 1 : refreshKey;

  useEffect(() => {
    let alive = true;
    agentReviewStateAction({ slug, token })
      .then((r) => {
        if (!alive) return;
        setState(r);
        setRating(r.rating);
        setText(r.text);
        setWho(r.name);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slug, token, paidCheck]);

  if (!state?.canReview) return null;
  if (!open)
    return done ? (
      <div className="cw-rate done">{t.reviewThanks}</div>
    ) : (
      <button type="button" className="cw-rate" onClick={() => setOpen(true)}>
        {state.rating ? `${t.myRating}: ${"★".repeat(state.rating)} · ${t.edit}` : `★ ${t.rate(name)}`}
      </button>
    );
  return (
    <form
      className="cw-review"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!rating || busy) return;
        setBusy(true);
        const res = await agentReviewAction({ slug, token, rating, text, name: who }).catch(() => ({ ok: false }));
        setBusy(false);
        if (res.ok) {
          setState({ canReview: true, rating, text, name: who });
          setDone(true);
          setOpen(false);
        }
      }}
    >
      <div className="cw-stars" role="radiogroup" aria-label={t.rate(name)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t.star(n)} className={n <= rating ? "on" : ""} onClick={() => setRating(n)}>
            ★
          </button>
        ))}
      </div>
      <textarea value={text} maxLength={600} rows={2} placeholder={t.reviewText} onChange={(e) => setText(e.target.value)} />
      <input value={who} maxLength={40} placeholder={t.reviewName} onChange={(e) => setWho(e.target.value)} />
      <button type="submit" disabled={!rating || busy}>
        {t.reviewSend}
      </button>
    </form>
  );
}
