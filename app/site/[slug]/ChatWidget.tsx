"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { advanceCaseAction, agentCheckoutAction, agentClaimAction, agentReviewAction, agentReviewStateAction, caseReplyAction, getCaseAction, visitorChatPhotoAction, visitorChatPollAction, visitorChatSendAction, type ChatMsg, type MyReview, type PublicCase } from "@/app/chatActions";
import { prepareImage } from "@/lib/clientImage";

// A photo the customer sent ("📷 <url>").
const PHOTO = /^📷\s+(https:\/\/\S+)$/;

// The page chat as the owner's service agent (see lib/serviceAgent.ts).
export type ChatAgent = { name: string; greeting: string; offers: { id: string; title: string; detail: string; label: string; welcome?: string }[]; does?: string };
const PAY = /\s*\[\[pay\]\]\s*$/;
// The file of a task the agent is doing ("[[case:<id>]]" at the end of its message).
const CASE = /\s*\[\[case:([A-Za-z0-9_-]{6,64})\]\]\s*$/;
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
    attach: "Enviar una foto",
    uploading: "Subiendo la foto…",
    photoErrors: { type: "Envía una foto (JPG, PNG o HEIC).", big: "La foto es muy grande. Prueba con otra.", rate: "Enviaste muchas fotos. Espera un momento.", closed: "El chat no está disponible ahora.", failed: "No se pudo subir la foto. Inténtalo de nuevo." } as Record<string, string>,
    photoTip: "Tapa tu número de licencia u otros datos personales antes de enviarla.",
    mic: "Hablar",
    micStop: "Detener",
    listening: "Te escucho…",
    speak: "Leer respuestas en voz alta",
    caseStatus: { working: "Trabajando en la página oficial…", needs_input: "Te necesito un momento", needs_ok: "Necesita tu OK", blocked: "Bloqueado: falta un paso tuyo", done: "Listo · verificado", pending: "Pendiente" } as Record<string, string>,
    caseTest: "Modo de prueba: opera una oficina de práctica, nada se envía de verdad.",
    caseFile: "Expediente",
    caseOk: "Sí, hazlo",
    caseFix: "Corregir algo",
    caseFixPh: "¿Qué cambio?",
    caseFixSend: "Enviar corrección",
    caseTypeHere: (what: string) => `Escribe tu ${what} directamente aquí, en la página oficial. Ni Sevrii ni la IA lo ven ni lo guardan.`,
    caseTyped: "Listo, ya lo escribí",
    caseDidIt: "Ya lo hice",
    caseOpen: "Abrir la página oficial",
    caseAnswer: "Responde aquí en el chat.",
    caseResult: "Resultado verificado",
    caseDocs: "Documentos",
    caseReminders: "Recordatorios",
    casePendingNext: "Siguiente paso",
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
    attach: "Send a photo",
    uploading: "Uploading the photo…",
    photoErrors: { type: "Send a photo (JPG, PNG or HEIC).", big: "That photo is too big. Try another one.", rate: "You sent many photos. Wait a moment.", closed: "Chat isn't available right now.", failed: "Couldn't upload the photo. Please try again." } as Record<string, string>,
    photoTip: "Cover your license number or other personal data before sending it.",
    mic: "Speak",
    micStop: "Stop",
    listening: "Listening…",
    speak: "Read replies aloud",
    caseStatus: { working: "Working on the official page…", needs_input: "I need you for a moment", needs_ok: "Needs your OK", blocked: "Blocked: a step is missing", done: "Done · verified", pending: "Pending" } as Record<string, string>,
    caseTest: "Test mode: it operates a practice office, nothing real is sent.",
    caseFile: "Case file",
    caseOk: "Yes, do it",
    caseFix: "Change something",
    caseFixPh: "What should change?",
    caseFixSend: "Send correction",
    caseTypeHere: (what: string) => `Type your ${what} right here, on the official page. Neither Sevrii nor the AI sees or stores it.`,
    caseTyped: "Done, I typed it",
    caseDidIt: "I did it",
    caseOpen: "Open the official page",
    caseAnswer: "Answer here in the chat.",
    caseResult: "Verified result",
    caseDocs: "Documents",
    caseReminders: "Reminders",
    casePendingNext: "Next step",
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
  room = false,
}: {
  room?: boolean; // the agent's own full-screen room (/site/<slug>/agente)
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
  // Only the newest file card in the chat is the live one (it drives the work).
  const caseAt = agent ? msgs.reduce((at, m, i) => (m.role === "ai" && CASE.test(m.content) ? i : at), -1) : -1;
  // Voice: dictate (and send) with the microphone; optionally hear the replies.
  const [listening, setListening] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const spokenRef = useRef(0);
  // Known only in the browser (after the first render, so server and client match).
  const [voice, setVoice] = useState({ listen: false, speak: false });
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setVoice({ listen: Boolean(w.SpeechRecognition || w.webkitSpeechRecognition), speak: "speechSynthesis" in window });
  }, []);
  const canListen = voice.listen;

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

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // The customer attaches a photo: it's stored, then sent as a message.
  async function sendPhoto(file: File | undefined) {
    if (!file || sending || uploading) return;
    setError("");
    setUploading(true);
    try {
      const ready = await prepareImage(file);
      const form = new FormData();
      form.set("slug", slug);
      form.set("file", ready);
      const res = await visitorChatPhotoAction(form);
      if (!res.ok) {
        setError(t.photoErrors[res.error] || t.photoErrors.failed);
        return;
      }
      await send(`📷 ${res.url}`);
    } catch {
      setError(t.photoErrors.failed);
    } finally {
      setUploading(false);
    }
  }

  async function send(direct?: string) {
    const text = (direct ?? draft).trim();
    if (!text || sending) return;
    setError("");
    setSending(true);
    if (direct === undefined) setDraft("");
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
        if (direct === undefined) setDraft(text);
        setError(t.errors[res.error] || t.errors.failed);
      }
    } catch {
      setMsgs((cur) => cur.filter((m) => m.seq !== Number.MAX_SAFE_INTEGER));
      if (direct === undefined) setDraft(text);
      setError(t.errors.failed);
    } finally {
      setSending(false);
    }
  }

  // Dictation: what they say goes in the box and is sent when they stop talking.
  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Rec = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Rec) return;
    const rec = new Rec();
    rec.lang = lang === "es" ? "es-US" : "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setDraft((finalText + interim).trim());
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (finalText.trim()) send(finalText.trim());
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  // Read the agent's new replies aloud (when they turned it on).
  useEffect(() => {
    if (!speakOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const fresh = msgs.slice(spokenRef.current).filter((m) => m.role !== "visitor");
    spokenRef.current = msgs.length;
    for (const m of fresh) {
      const said = m.content.replace(CASE, "").replace(PAY, "").replace(URL_RE, "").replace(/\*\*/g, "").trim();
      if (!said) continue;
      const u = new SpeechSynthesisUtterance(said);
      u.lang = lang === "es" ? "es-US" : "en-US";
      window.speechSynthesis.speak(u);
    }
  }, [msgs, speakOn, lang]);

  return (
    <div className={`cw-inline${room ? " cw-room" : ""}`} ref={rootRef} role="region" aria-label={t.open}>
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
            {agent && voice.speak && (
              <button type="button" className={`cw-speak${speakOn ? " on" : ""}`} aria-pressed={speakOn} aria-label={t.speak} title={t.speak} onClick={() => {
                spokenRef.current = msgs.length;
                setSpeakOn((v) => !v);
                if (speakOn) window.speechSynthesis.cancel();
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M11 5 6 9H3v6h3l5 4z" />
                  {speakOn && <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
                </svg>
              </button>
            )}
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
                  {m.role === "visitor" && PHOTO.test(m.content) ? (
                    <a className="cw-photo" href={PHOTO.exec(m.content)![1]} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={PHOTO.exec(m.content)![1]} alt="" loading="lazy" />
                    </a>
                  ) : (
                  <>
                    {m.content.replace(CASE, "").replace(PAY, "").trim() && (
                      <div className={`cw-msg ${m.role}`}>{m.role === "visitor" ? m.content : <Linked text={m.content.replace(CASE, "").replace(PAY, "").replace(/\*\*(.+?)\*\*/g, "$1")} />}</div>
                    )}
                    {m.role === "ai" && token && CASE.test(m.content) && (
                      <CaseCard slug={slug} token={token} id={CASE.exec(m.content)![1]} lang={lang} live={i === caseAt} onChange={poll} />
                    )}
                  </>
                  )}
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
          {listening && <div className="cw-wait">🎙 {t.listening}</div>}
          {uploading && <div className="cw-wait">{t.uploading} {t.photoTip}</div>}
          <form
            className="cw-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <button type="button" className="cw-attach" disabled={sending || uploading} onClick={() => fileRef.current?.click()} aria-label={t.attach} title={`${t.attach}. ${t.photoTip}`}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                sendPhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
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
            {agent && canListen && (
              <button type="button" className={`cw-mic${listening ? " on" : ""}`} disabled={sending} aria-label={listening ? t.micStop : t.mic} title={listening ? t.micStop : t.mic} onClick={() => (listening ? recRef.current?.stop() : listen())}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </button>
            )}
            <button type="submit" disabled={sending || uploading || !draft.trim()} aria-label={t.send}>
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

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

// The case file, inside the chat: steps, what the agent needs from the customer
// right now (an OK, something to type on the official page, an answer), the
// documents and the verified result. The newest card keeps the work going.
function CaseCard({ slug, token, id, lang, live, onChange }: { slug: string; token: string; id: string; lang: "es" | "en"; live: boolean; onChange: () => void }) {
  const t = TEXT[lang];
  const [c, setC] = useState<PublicCase | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const driving = useRef(false);

  const load = useCallback(async () => {
    const r = await getCaseAction({ slug, token, id }).catch(() => null);
    if (r) setC(r);
    return r;
  }, [slug, token, id]);

  useEffect(() => {
    load();
  }, [load]);

  // While it works, the newest card asks the server to keep going.
  useEffect(() => {
    if (!live || !c || c.status !== "working" || driving.current) return;
    driving.current = true;
    let alive = true;
    (async () => {
      for (let i = 0; i < 40 && alive; i++) {
        const r = await advanceCaseAction({ slug, token, id }).catch(() => null);
        if (!alive) break;
        if (r?.case) setC(r.case);
        onChange();
        if (!r || !r.more) break;
        await new Promise((ok) => setTimeout(ok, 1500));
      }
      driving.current = false;
      if (alive) {
        await load();
        onChange();
      }
    })();
    return () => {
      alive = false;
    };
  }, [live, c, slug, token, id, onChange, load]);

  // Something to do on the official page (or an answer pending elsewhere): refresh now and then.
  useEffect(() => {
    if (!live || !c || c.status === "done") return;
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 8000);
    return () => clearInterval(iv);
  }, [live, c, load]);

  async function reply(kind: "ok" | "fix" | "done") {
    if (busy) return;
    setBusy(true);
    const r = await caseReplyAction({ slug, token, id, kind, note: kind === "fix" ? note : undefined }).catch(() => null);
    setBusy(false);
    if (r) setC(r);
    setFixing(false);
    setNote("");
    onChange();
  }

  if (!c) return null;
  if (!live)
    return (
      <div className="cw-case mini">
        <span>{t.caseFile}: {c.title}</span>
        <b>{t.caseStatus[c.status]}</b>
      </div>
    );
  const w = c.waiting;
  return (
    <div className={`cw-case ${c.status}`}>
      <div className="cw-case-head">
        <span className="cw-case-title">{c.title}</span>
        <span className="cw-case-chip">{c.status === "working" && <span className="cw-dot" />}{t.caseStatus[c.status]}</span>
      </div>
      {c.mode === "test" && <div className="cw-case-test">{t.caseTest}</div>}
      {c.steps.length > 0 && (
        <ol className="cw-case-steps">
          {c.steps.map((s, i) => (
            <li key={i} className={s.status}>
              <span aria-hidden>{s.status === "done" ? "✓" : s.status === "doing" ? "…" : s.status === "failed" ? "!" : "·"}</span>
              {s.label}
            </li>
          ))}
        </ol>
      )}
      {w && c.status === "needs_ok" && (
        <div className="cw-case-wait">
          <p>{w.label}</p>
          {fixing ? (
            <div className="cw-case-fix">
              <textarea rows={2} maxLength={600} value={note} placeholder={t.caseFixPh} onChange={(e) => setNote(e.target.value)} />
              <button type="button" disabled={busy || !note.trim()} onClick={() => reply("fix")}>{t.caseFixSend}</button>
            </div>
          ) : (
            <div className="cw-case-btns">
              <button type="button" className="ok" disabled={busy} onClick={() => reply("ok")}>{t.caseOk}</button>
              <button type="button" disabled={busy} onClick={() => setFixing(true)}>{t.caseFix}</button>
            </div>
          )}
        </div>
      )}
      {w && (w.kind === "sensitive" || w.kind === "captcha") && (c.status === "needs_input" || c.status === "blocked") && (
        <div className="cw-case-wait">
          <p>{w.kind === "sensitive" ? t.caseTypeHere(w.label) : w.label}</p>
          {w.detail && <p className="cw-case-detail">{w.detail}</p>}
          {w.url && (/browserbase|\/api\/agent-case\/live/.test(w.url) ? (
            <iframe className="cw-case-live" src={w.url} title={w.label} sandbox="allow-same-origin allow-scripts allow-forms allow-popups" allow="clipboard-read; clipboard-write" />
          ) : (
            <a className="cw-link" href={w.url} target="_blank" rel="noopener noreferrer">{t.caseOpen}</a>
          ))}
          <div className="cw-case-btns">
            <button type="button" className="ok" disabled={busy} onClick={() => reply("done")}>{w.kind === "sensitive" ? t.caseTyped : t.caseDidIt}</button>
          </div>
        </div>
      )}
      {w && w.kind === "info" && c.status === "needs_input" && (
        <div className="cw-case-wait">
          <p>{w.label}</p>
          <p className="cw-case-detail">{t.caseAnswer}</p>
        </div>
      )}
      {w && c.status === "pending" && (
        <div className="cw-case-wait">
          <p>{w.label}</p>
          {w.detail && <p className="cw-case-detail">{t.casePendingNext}: {w.detail}</p>}
        </div>
      )}
      {c.result && (
        <div className="cw-case-result">
          <span>✓ {t.caseResult}{c.result.test ? " (prueba)" : ""}</span>
          <b>{c.result.kind}: {c.result.value}</b>
          {c.result.url && <a className="cw-link" href={c.result.url} target="_blank" rel="noopener noreferrer">{c.result.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>}
        </div>
      )}
      {c.docs.length > 0 && (
        <div className="cw-case-docs">
          <span>{t.caseDocs}</span>
          {c.docs.map((d, i) => (
            <a key={i} className="cw-link" href={d.url} target="_blank" rel="noopener noreferrer">{d.name}</a>
          ))}
        </div>
      )}
      {c.reminders.length > 0 && (
        <div className="cw-case-docs">
          <span>{t.caseReminders}</span>
          {c.reminders.map((r, i) => (
            <em key={i}>{r.dueAt.slice(0, 10)} · {r.text}</em>
          ))}
        </div>
      )}
    </div>
  );
}
