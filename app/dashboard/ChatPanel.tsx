"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { BRAND_BTN, GREEN as ACCENT } from "@/lib/panel";
import { upgradeText, type LimitInfo } from "@/lib/upgrade";
import { canListen, listenError, listenOnce, speakText, unlockSpeech } from "./speech";
import { Mark, chime, primeChime } from "./chatLook";
export type Msg = { id: string; role: string; content: string };

export type ChatTexts = {
  placeholder: string;
  emptyTitle: string;
  emptySub: string;
  disclaimer: string;
  seeBelow: string;
  seeBelowHref: string;
  thinking: string;
  attach: string;
  failed: string;
  // Only needed by chats that accept uploads (Store).
  uploadingPhoto?: string;
  uploadingVideo?: string;
  uploadFailed?: string;
};

const PHOTO = /^📷\s+(https:\/\/\S+)$/;
const VIDEO = /^🎥\s+(https:\/\/\S+)$/;
// Older saved replies may still carry a "[[card:x]]" token from a removed feature.
const OLD_CARD = /\[\[card:[a-z]+\]\]/g;
// A card token at the end of an assistant message ("[[part:service]]"); the
// chat that owns the cards draws them (Brain), the others just hide them.
const TOKEN = /\s*\[\[([a-z]+)(?::([A-Za-z0-9_-]+))?\]\]\s*$/;
const ANY_TOKEN = /\[\[[a-z]+(?::[A-Za-z0-9_-]+)?\]\]/g;

export type ChatToken = { kind: string; arg: string; msgId: string };
export type SendResult = { messages: Msg[]; limit?: LimitInfo | null; notice?: string };

// An internal error note an older version saved into the chat: never shown.
const DEBUG = /\n*\[debug\][\s\S]*$/;
// Error messages saved by older versions (raw API errors, "Tuve un problema
// para guardar eso…"): taken out of the history the owner sees.
const OLD_ERROR = /(credit balance|request_id|invalid_request_error|overloaded_error|rate_limit_error|authentication_error|"type"\s*:\s*"error"|^\s*\d{3}\s*[{[]|Tuve un problema para guardar eso|Llegaste al l[ií]mite de mensajes a la IA por hoy|Llegaste al l[ií]mite de IA de tu plan|You've reached today's limit of AI messages|You've reached your plan's AI limit|I had (a )?(problem|trouble) saving that|No pude guardar eso|I couldn't save that)/i;
// Today's error messages (lib/claude.ts aiErrorReply): only the latest one
// stays, while it's still the last thing in the chat; older ones go away.
const PAST_ERROR = /^(El Cerebro está en pausa por un problema de nuestro lado|The Brain is paused because of a problem on our side|Hay mucha demanda en este momento y no alcancé|It's very busy right now and I couldn't answer|No pude terminar eso por un error de mi lado|I couldn't finish that because of an error on my side|El asistente no está disponible en este momento|The assistant isn't available right now)/;
export function hiddenError(content: string, isLast: boolean): boolean {
  const t = content.replace(DEBUG, "").trim();
  if (OLD_ERROR.test(t)) return true;
  return !isLast && PAST_ERROR.test(t);
}
// The part of a message that is read (without its card token).
function visibleText(content: string): string {
  const raw = content.replace(OLD_CARD, "").replace(DEBUG, "");
  const tk = TOKEN.exec(raw);
  return (tk ? raw.slice(0, tk.index) : raw).trim();
}

// Quick actions above the composer: put a starter text in it, or open the
// photo/video picker.
// `send`: the chip is the answer itself and goes out right away.
export type ChatChip = { label: string; text?: string; upload?: boolean; send?: boolean };

// **bold** in assistant replies shows as bold (no stray asterisks).
function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*([^*\n][^*]*?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-white">{p}</strong> : p.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")))}
    </>
  );
}

const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(f.name);

// The chat lives on a dark green gradient (like an assistant side panel):
// white text, translucent bubbles and a dark composer. Cards from the Brain,
// Store or Marketing keep their own light surface.
const SOFT = "rgba(255,255,255,0.92)";
const DIM = "rgba(255,255,255,0.6)";
const GLASS = { background: "rgba(255,255,255,0.07)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)" } as const;
const LIVE = "#4ADE80";

// Sevrii's chat: a dark green gradient panel, Sevrii's mark beside each
// reply (turning while it thinks or writes, with a soft sound when a reply
// arrives), the owner's messages in a translucent bubble, a dark composer.
// Empty state = the mark and a question in the middle, suggestions and the
// composer at the bottom.
// Used by Brain, Store and Marketing.
export default function ChatPanel({
  greeting,
  initialMessages,
  texts,
  onSend,
  onPlans,
  onUpload,
  locked,
  sync,
  prefill,
  renderToken,
  tail,
  tailKey,
  head,
  dock,
  dockLabel,
  chips,
  // The microphone is in every chat (Brain, Store, Agent, Marketing).
  voice = true,
  context,
  pickKey,
  recover,
  composerInline = false,
}: {
  // The box to write goes under the last message (inside the list), never
  // pinned on top of cards the person is reading.
  composerInline?: boolean;
  greeting: string;
  initialMessages: Msg[];
  texts: ChatTexts;
  // A plain list of messages, or the messages plus a capacity limit (the
  // upgrade window) or a short notice; in both cases the text stays in the box.
  onSend: (text: string) => Promise<Msg[] | SendResult>;
  onPlans?: () => void;
  // Uploads a photo or video and returns the text to send for it, or an error
  // message. Videos report progress (0–100) while they upload.
  onUpload?: (file: File, onProgress: (percentage: number) => void) => Promise<{ send: string } | { error: string }>;
  // When set, the composer is replaced by this note (e.g. while researching).
  locked?: React.ReactNode;
  // Replace the messages from outside (new key = new messages).
  sync?: { key: number; messages: Msg[] };
  // Reads the saved conversation again: used when a reply takes too long, so
  // an answer that was saved but didn't come back still shows up by itself.
  recover?: () => Promise<Msg[] | null>;
  // Put text in the composer from outside (e.g. a "Change" button).
  prefill?: { key: number; text: string };
  // Draws the card a message's token asks for.
  renderToken?: (token: ChatToken) => React.ReactNode;
  // Shown after the last message (e.g. the part being reviewed); tailKey
  // changes when it does, to keep the chat scrolled to it.
  tail?: React.ReactNode;
  tailKey?: string;
  // Shown at the top of the conversation (e.g. a summary of the page). With a
  // head the chat never shows its empty "first question" screen.
  head?: React.ReactNode;
  // The project's card (see ProjectDock): beside the chat on wide screens,
  // behind a summary button above the composer on phones and tablets.
  dock?: React.ReactNode;
  dockLabel?: string;
  chips?: ChatChip[];
  // Microphone (dictate and send) and replies read aloud, when the browser supports them.
  voice?: boolean;
  // A pill above the composer: what the next message is about (e.g. a video), with ✕ to clear.
  context?: { label: string; onClear: () => void } | null;
  // A new value opens the photo/video picker (e.g. a "Upload photos" button elsewhere).
  pickKey?: number;
}) {
  const lang = useLang();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  // New replies appear little by little, like someone typing, instead of all
  // at once. Messages already there when the chat opens show whole.
  const seen = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));
  const [reveal, setReveal] = useState<Record<string, number>>({});
  const revealOrder = useRef<string[]>([]);
  const [calm, setCalm] = useState(false);
  useEffect(() => setCalm(Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)), []);
  // A reply that just arrived and hasn't started being written yet.
  const waitingToType = (m: Msg) => !calm && !seen.current.has(m.id) && m.role !== "user" && !m.id.startsWith("local-") && m.id !== "greeting" && m.content !== greeting && !(typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    const fresh: string[] = [];
    let arrived = false;
    for (const m of messages) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (m.role !== "user" && !m.id.startsWith("local-") && m.id !== "greeting" && m.content !== greeting) arrived = true;
      // The greeting, once saved, comes back with a new id: it was already
      // on screen, so it is never written again.
      if (m.role === "user" || m.id.startsWith("local-") || m.id === "greeting" || calm || m.content === greeting) continue;
      // A tab in the background doesn't type (the browser pauses its timers):
      // the reply is just there when the owner comes back.
      if (typeof document !== "undefined" && document.hidden) continue;
      fresh.push(m.id);
    }
    if (arrived && typeof document !== "undefined" && !document.hidden) chime();
    if (!fresh.length) return;
    revealOrder.current.push(...fresh);
    setReveal((r) => ({ ...r, ...Object.fromEntries(fresh.map((id) => [id, 0])) }));
  }, [messages, calm]);
  const revealing = Object.keys(reveal).length > 0;
  // Leaving the tab while a reply is being written: show it whole.
  useEffect(() => {
    if (!revealing) return;
    const done = () => {
      if (!document.hidden) return;
      revealOrder.current = [];
      setReveal({});
    };
    document.addEventListener("visibilitychange", done);
    return () => document.removeEventListener("visibilitychange", done);
  }, [revealing]);
  useEffect(() => {
    if (!revealing) return;
    const timer = setInterval(() => {
      setReveal((r) => {
        const id = revealOrder.current.find((x) => x in r);
        if (!id) return r;
        const msg = messages.find((m) => m.id === id);
        const full = msg ? visibleText(msg.content).length : 0;
        const shown = r[id] ?? 0;
        // About 2–4 seconds for any reply, word by word.
        const step = Math.max(3, Math.ceil(full / 160));
        let next = Math.min(full, shown + step);
        const space = msg ? visibleText(msg.content).indexOf(" ", next) : -1;
        if (space > 0 && space - next < 8) next = space;
        if (next >= full) {
          const { [id]: _done, ...rest } = r;
          void _done;
          revealOrder.current = revealOrder.current.filter((x) => x !== id);
          return rest;
        }
        return { ...r, [id]: next };
      });
    }, 30);
    return () => clearInterval(timer);
  }, [revealing, messages]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [limit, setLimit] = useState<LimitInfo | null>(null);
  // A photo or video on its way to storage (percentage only for videos).
  const [uploading, setUploading] = useState<{ video: boolean; pct: number } | null>(null);
  // A reply that takes long: a visible "still working" after 15 s, and the
  // saved chat is read again every few seconds so it shows up on its own
  // (never minutes of silence that only a "¿hola?" unlocks).
  const [slow, setSlow] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const waiting = pending && !recovered;
  useEffect(() => {
    if (!pending) {
      setSlow(false);
      setRecovered(false);
      return;
    }
    const sentAt = Date.now();
    let stop = false;
    const t1 = setTimeout(() => !stop && setSlow(true), 15_000);
    const iv = setInterval(async () => {
      if (stop || !recover || Date.now() - sentAt < 20_000) return;
      const saved = await recover().catch(() => null);
      if (stop || !saved || !saved.length) return;
      const last = saved[saved.length - 1];
      if (last.role !== "user") {
        setMessages(saved);
        setRecovered(true);
      }
    }, 6_000);
    // Nothing after 100 s: say so plainly and give the text back to resend.
    const t2 = setTimeout(() => {
      if (stop) return;
      setRecovered(true);
      setError(texts.failed);
    }, 100_000);
    return () => {
      stop = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
  const busy = waiting || uploading !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A visible reaction to "+": the file picker is the browser's own window,
  // so a short line under the box says what to do (and that it opened).
  const [pickHint, setPickHint] = useState(false);
  const openPicker = () => {
    setPickHint(true);
    setTimeout(() => setPickHint(false), 6000);
    fileRef.current?.click();
  };
  const empty = messages.length === 0 && !head && !dock;
  const [dockOpen, setDockOpen] = useState(false);
  useEffect(() => {
    if (!dockOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDockOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [dockOpen]);

  function pickChip(c: ChatChip) {
    if (busy) return;
    primeChime();
    if (c.upload) {
      openPicker();
      return;
    }
    const text = c.text ?? "";
    if (c.send) {
      send(text || c.label);
      return;
    }
    setInput(text);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    }, 0);
  }

  useEffect(() => {
    if (pickKey) {
      setDockOpen(false);
      openPicker();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickKey]);

  useEffect(() => {
    if (sync) setMessages(sync.messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync?.key]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    const el = inputRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(prefill.text.length, prefill.text.length);
      }, 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key]);

  // Always open on the latest message (instantly the first time, so a long
  // history isn't left showing its oldest part), then follow new ones.
  const firstScroll = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const first = firstScroll.current;
    firstScroll.current = false;
    const go = () => el.scrollTo({ top: el.scrollHeight, behavior: first ? "auto" : "smooth" });
    const raf = requestAnimationFrame(go);
    // Fonts and cards below can still shift the layout right after opening.
    const late = first ? setTimeout(() => el.scrollTo({ top: el.scrollHeight }), 400) : undefined;
    return () => {
      cancelAnimationFrame(raf);
      if (late) clearTimeout(late);
    };
  }, [messages, pending, uploading !== null, tailKey]);

  // While a reply is being written, keep it in view (unless they scrolled up to read).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !revealing) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [reveal, revealing]);

  // Grow the composer with the text.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function send(text: string) {
    if (busy || !text.trim()) return;
    primeChime();
    setInput("");
    post(text);
  }

  function post(text: string) {
    const value = text.trim();
    if (!value) return;
    setError("");
    setMessages((m) => [
      ...(m.length === 0 ? [{ id: "greeting", role: "ai", content: greeting }] : m),
      { id: `local-${Date.now()}`, role: "user", content: value },
    ]);
    start(async () => {
      try {
        const res = await onSend(value);
        window.dispatchEvent(new Event("sevrii:usage"));
        if (Array.isArray(res)) {
          setMessages(res);
          setLimit(null);
        } else {
          setMessages(res.messages);
          setLimit(res.limit ?? null);
          if (res.notice) setError(res.notice);
          // Not sent: the text goes back to the box so nothing is lost.
          if (res.limit || res.notice) setInput(value);
        }
      } catch {
        setError(texts.failed);
      }
    });
  }

  async function upload(file: File | undefined) {
    if (!file || busy || !onUpload) return;
    setError("");
    const video = isVideo(file);
    setUploading({ video, pct: 0 });
    let res: { send: string } | { error: string };
    try {
      res = await onUpload(file, (pct) => setUploading({ video, pct: Math.max(0, Math.min(100, Math.round(pct))) }));
    } catch {
      res = { error: texts.uploadFailed ?? texts.failed };
    } finally {
      setUploading(null);
    }
    if ("error" in res) setError(res.error);
    else post(res.send);
  }

  const canSend = !busy && input.trim().length > 0;

  // Voice: what they say goes in the box; a moment after they stop it is sent
  // (tapping the microphone again in that moment keeps the same message going).
  // With the speaker on, new replies are read aloud.
  const [can, setCan] = useState({ listen: false, speak: false });
  useEffect(() => {
    setCan({ listen: canListen(), speak: "speechSynthesis" in window });
  }, []);
  const [listening, setListening] = useState(false);
  const [sending, setSending] = useState(false);
  const [speakOn, setSpeakOn] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const spoken = useRef<Set<string>>(new Set());
  const sendRef = useRef(send);
  sendRef.current = send;
  const inputNow = useRef("");
  inputNow.current = input;
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      recRef.current?.stop();
    },
    []
  );
  function listen() {
    if (busy || recRef.current) return;
    // Keep talking on the same message if it hadn't been sent yet.
    const pending0 = sendTimer.current !== null;
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = null;
    setSending(false);
    setError("");
    const before = pending0 ? inputNow.current.trim() : "";
    if (speakOn) window.speechSynthesis.cancel();
    else if (can.speak) {
      // Spoken to, answers aloud (the speaker button turns it off).
      unlockSpeech();
      spoken.current = new Set(messages.map((m) => m.id));
      setSpeakOn(true);
    }
    const h = listenOnce(
      lang,
      (text) => setInput([before, text].filter(Boolean).join(" ")),
      (text, err) => {
        setListening(false);
        recRef.current = null;
        const full = [before, text].filter(Boolean).join(" ").trim();
        if (err && !full) {
          setError(listenError(err, lang));
          return;
        }
        if (!full) {
          setError(listenError("no-speech", lang));
          return;
        }
        setInput(full);
        setSending(true);
        sendTimer.current = setTimeout(() => {
          sendTimer.current = null;
          setSending(false);
          sendRef.current(inputNow.current);
        }, 1400);
      }
    );
    if (!h) {
      setError(listenError("start", lang));
      return;
    }
    recRef.current = h;
    setListening(true);
  }
  useEffect(() => {
    if (!voice || !speakOn || !("speechSynthesis" in window)) return;
    for (const m of messages) {
      if (spoken.current.has(m.id)) continue;
      spoken.current.add(m.id);
      if (m.role === "user" || m.id.startsWith("local-")) continue;
      const said = m.content.replace(ANY_TOKEN, "").replace(/https?:\/\/\S+/g, "").replace(/\*\*/g, "").replace(/[«»“”]/g, "").trim();
      if (!said) continue;
      speakText(said, lang);
    }
  }, [messages, speakOn, voice, lang]);
  const toggleSpeak = () => {
    spoken.current = new Set(messages.map((m) => m.id));
    if (speakOn) window.speechSynthesis.cancel();
    else unlockSpeech();
    setSpeakOn((v) => !v);
  };
  const micLabel = listening ? (lang === "es" ? "Dejar de escuchar" : "Stop listening") : lang === "es" ? "Hablar" : "Speak";
  const speakLabel = speakOn ? (lang === "es" ? "No leer respuestas en voz alta" : "Stop reading replies aloud") : lang === "es" ? "Leer respuestas en voz alta" : "Read replies aloud";

  // Shown while a photo or video uploads, also in an empty chat.
  const uploadRow = uploading && (
    <div className="flex justify-end" role="status" aria-live="polite">
      <div className="w-[240px] max-w-[78%] rounded-3xl px-5 py-3 flex flex-col gap-2" style={GLASS}>
        <div className="flex items-center justify-between gap-3 text-[14px]" style={{ color: SOFT }}>
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: ACCENT }} />
            {uploading.video ? texts.uploadingVideo ?? texts.attach : texts.uploadingPhoto ?? texts.attach}
          </span>
          {uploading.video && <span className="tabular-nums" style={{ color: DIM }}>{uploading.pct}%</span>}
        </div>
        {uploading.video && (
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.12)" }}>
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${uploading.pct}%`, background: ACCENT }} />
          </div>
        )}
      </div>
    </div>
  );

  const chipClass = "tap shrink-0 h-10 px-4 rounded-full text-[14px] text-white bg-white/[0.07] hover:bg-white/[0.14] transition disabled:opacity-40 whitespace-nowrap";
  const chipRow =
    chips && chips.length > 0 && !locked ? (
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => (
          <button key={c.label} type="button" disabled={busy} onClick={() => pickChip(c)} className={chipClass}>
            {c.label}
          </button>
        ))}
      </div>
    ) : null;
  // Empty chat: the suggestions stacked, like an assistant's first screen.
  const chipStack =
    chips && chips.length > 0 && !locked ? (
      <div className="flex flex-col items-start gap-2 pb-3">
        {chips.slice(0, 4).map((c) => (
          <button key={c.label} type="button" disabled={busy} onClick={() => pickChip(c)} className={chipClass}>
            {c.label}
          </button>
        ))}
      </div>
    ) : null;

  const composer = locked ? (
    <div className="w-full">
      <div
        className="chat-surface flex items-start gap-3 text-[15px] rounded-[24px]"
        style={{ ...GLASS, padding: "16px 20px", color: SOFT }}
      >
        <span className="mt-0.5"><Mark size={22} live /></span>
        {locked}
      </div>
    </div>
  ) : (
    <div className="w-full">
      {limit && (
        <div className="chat-glass">
          <UpgradeCard limit={limit} lang={lang} onPlans={onPlans} onLater={() => setLimit(null)} />
        </div>
      )}
      {error && <p className="text-[13px] mb-2 px-4" style={{ color: "#FCA5A5" }}>{error}</p>}
      {context && (
        <div className="flex mb-2">
          <span className="inline-flex items-center gap-2 h-8 pl-3.5 pr-1.5 rounded-full text-[13px] text-white max-w-full" style={GLASS}>
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: LIVE }} />
            <span className="truncate">{context.label}</span>
            <button type="button" onClick={context.onClear} className="h-6 w-6 rounded-full flex items-center justify-center text-white/60 hover:bg-white/10" aria-label={lang === "es" ? "Quitar" : "Remove"}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </span>
        </div>
      )}
      {voice && (listening || sending) && (
        <p className="text-[13px] mb-2 px-4 flex items-center gap-2" style={{ color: DIM }} role="status" aria-live="polite">
          <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: LIVE }} />
          {listening
            ? lang === "es"
              ? "Te escucho… habla y toca el micrófono cuando termines."
              : "Listening… talk and tap the microphone when you're done."
            : lang === "es"
              ? "Enviando… toca el micrófono si quieres seguir hablando."
              : "Sending… tap the microphone to keep talking."}
        </p>
      )}
      <form
        className="chat-composer flex items-end gap-1.5 rounded-[26px] md:rounded-[28px] px-2 md:px-2.5 py-2 md:py-2.5"
        style={{ background: "rgba(10,20,14,0.72)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1), 0 18px 40px -20px rgba(0,0,0,.7)", backdropFilter: "blur(12px)" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {onUpload ? (
        <>
          <button
            type="button"
            onClick={openPicker}
            disabled={busy}
            className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-white/80 hover:bg-white/10 active:bg-white/15 transition disabled:opacity-40"
            title={texts.attach}
            aria-label={texts.attach}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              setPickHint(false);
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </>
        ) : (
          <span className="w-2" />
        )}
        <textarea
          ref={inputRef}
          rows={1}
          autoFocus={empty}
          className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[16px] leading-[1.5] text-white placeholder:text-white/45 py-2 max-h-[200px]"
          placeholder={texts.placeholder}
          value={input}
          maxLength={2000}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          disabled={busy}
        />
        {voice && can.speak && (
          <button
            type="button"
            onClick={toggleSpeak}
            aria-pressed={speakOn}
            aria-label={speakLabel}
            title={speakLabel}
            className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full flex items-center justify-center transition hover:bg-white/10"
            style={speakOn ? { color: LIVE } : { color: "rgba(255,255,255,0.55)" }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 5 6 9H3v6h3l5 4z" />
              {speakOn ? <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /> : <path d="M16 9l5 6M21 9l-5 6" />}
            </svg>
          </button>
        )}
        {voice && can.listen && (
          <button
            type="button"
            onClick={() => (listening ? recRef.current?.stop() : listen())}
            disabled={busy && !listening}
            aria-pressed={listening}
            aria-label={micLabel}
            title={micLabel}
            className="h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full flex items-center justify-center transition disabled:opacity-40"
            style={listening ? { background: LIVE, color: "#052E16" } : { color: "rgba(255,255,255,0.8)" }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
        )}
        <button
          type="submit"
          aria-label={lang === "es" ? "Enviar" : "Send"}
          title={lang === "es" ? "Enviar" : "Send"}
          className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition"
          style={canSend ? { background: "#fff", color: "#0A0A0A" } : { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.35)" }}
          disabled={!canSend}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
      {pickHint && !uploading && (
        <p className="text-[12.5px] px-4 pt-2" style={{ color: DIM }} role="status" aria-live="polite">
          {lang === "es" ? "Elige una foto o un video en la ventana que se abrió. Se sube aquí y lo pongo en tu página." : "Pick a photo or video in the window that opened. It uploads here and I put it on your page."}
        </p>
      )}
    </div>
  );

  const footnote = (
    <p className="text-center text-[11.5px] md:text-[12px] pt-2 md:pt-2.5 px-2 md:px-4" style={{ color: "rgba(255,255,255,0.42)" }}>
      {texts.disclaimer}
      {texts.seeBelow && texts.seeBelowHref && (
        <>
          {" "}
          <a href={texts.seeBelowHref} className="underline underline-offset-2 hover:text-white">
            {texts.seeBelow}
          </a>
        </>
      )}
    </p>
  );

  if (empty) {
    return (
      <div className="dash-panel chat-dark flex-1 min-h-0 flex flex-col px-4 overflow-y-auto mx-2 md:mx-4 mb-2 md:mb-4">
        <div className="w-full max-w-[760px] mx-auto flex-1 flex flex-col">
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 py-10">
            <Mark size={52} />
            <h1 className="text-[26px] md:text-[34px] leading-tight font-normal tracking-[-0.02em] text-white">{texts.emptyTitle}</h1>
            <p className="text-[15px] max-w-[520px]" style={{ color: DIM }}>{texts.emptySub}</p>
          </div>
          <div className="pb-3 md:pb-4">
            {uploadRow && <div className="w-full px-1 pb-3">{uploadRow}</div>}
            {chipStack}
            {composer}
          </div>
        </div>
      </div>
    );
  }

  const label = dockLabel || (lang === "es" ? "Ver el resumen" : "See the summary");
  return (
    <div className="flex-1 min-h-0 flex">
    {/* The conversation is a white panel on the dark page */}
    <div className="dash-panel chat-dark flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden mx-2 md:ml-4 md:mr-3 mb-2 md:mb-4">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="max-w-[760px] mx-auto px-4 md:px-6 pt-4 md:pt-6 pb-10 md:pb-14 flex flex-col gap-6 md:gap-7">
          {head && <div className="chat-surface">{head}</div>}
          {messages.length === 0 && greeting && (
            <div className="min-w-0 flex flex-col gap-2.5">
              <Mark />
              <div className="min-w-0 text-[15px] md:text-[15.5px] leading-[1.65] md:leading-[1.7] whitespace-pre-line break-words" style={{ color: SOFT }}>
                {greeting}
              </div>
            </div>
          )}
          {messages.map((m, mi) => {
            if (m.role !== "user" && hiddenError(m.content, mi === messages.length - 1)) return null;
            const photo = PHOTO.exec(m.content);
            const video = VIDEO.exec(m.content);
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  {video ? (
                    <video src={video[1]} controls playsInline preload="metadata" className="max-w-[min(280px,85%)] md:max-w-[280px] rounded-3xl bg-black" />
                  ) : photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo[1]} alt="" className="max-w-[min(240px,85%)] md:max-w-[240px] rounded-3xl" />
                  ) : (
                    <div className="max-w-[85%] md:max-w-[78%] rounded-3xl rounded-tr-lg px-4 md:px-5 py-2.5 md:py-3 text-[15px] md:text-[15.5px] leading-[1.55] md:leading-[1.6] whitespace-pre-line break-words [overflow-wrap:anywhere]" style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}>
                      {m.content}
                    </div>
                  )}
                </div>
              );
            }
            const raw = m.content.replace(OLD_CARD, "").replace(DEBUG, "");
            const tk = TOKEN.exec(raw);
            const full = (tk ? raw.slice(0, tk.index) : raw).trim();
            // Being written: the text so far, and its card only once it's done.
            // Not shown whole for an instant before it starts being written.
            if (waitingToType(m)) return null;
            const typing = m.id in reveal;
            const firstTyping = typing && revealOrder.current.find((x) => x in reveal) === m.id;
            if (typing && !firstTyping) return null;
            const text = typing ? full.slice(0, reveal[m.id]) : full;
            const card = !typing && tk && renderToken ? renderToken({ kind: tk[1], arg: tk[2] ?? "", msgId: m.id }) : null;
            if (!text && !card && !typing) return null;
            return (
              <div key={m.id} className="min-w-0 flex flex-col gap-3.5" style={typing ? { animation: "dash-fade .3s ease both" } : undefined}>
                {(text || typing) && (
                  <div className="min-w-0 flex flex-col gap-2.5">
                    <Mark live={typing} />
                    <div className="min-w-0 text-[15px] md:text-[15.5px] leading-[1.65] md:leading-[1.7] whitespace-pre-line break-words [overflow-wrap:anywhere]" style={{ color: SOFT }} aria-busy={typing || undefined}>
                      <Rich text={text} />
                      {typing && <span className="inline-block w-[7px] h-[1.05em] ml-0.5 align-[-0.15em] rounded-sm animate-pulse" style={{ background: LIVE }} aria-hidden="true" />}
                    </div>
                  </div>
                )}
                {card && (
                  <div className="chat-surface" style={{ animation: "dash-fade .35s ease both" }}>
                    {card}
                  </div>
                )}
              </div>
            );
          })}
          {/* What follows a reply (e.g. the part to review) shows once the reply is written. */}
          {!revealing && tail && <div className="chat-surface">{tail}</div>}
          {uploadRow}
          {waiting && (
            <div className="flex items-center gap-3 min-h-6 text-[14px]" style={{ color: DIM }} role="status" aria-live="polite">
              <Mark size={28} live />
              {slow ? (lang === "es" ? "Está tardando un poco más de lo normal; sigo trabajando y te respondo aquí." : "This is taking a bit longer than usual; I'm still working and will answer here.") : texts.thinking}
            </div>
          )}
          {composerInline && (
            <div className="pt-2">
              {chipRow}
              {composer}
              {footnote}
            </div>
          )}
        </div>
      </div>
      {!composerInline && (
      <div className="shrink-0 px-4 md:px-6 pt-1 md:pt-0 pb-3">
        <div className="max-w-[760px] mx-auto">
          {dock && (
            <button
              type="button"
              onClick={() => setDockOpen(true)}
              className="lg:hidden w-full mb-2 h-12 px-4 rounded-full flex items-center gap-3 text-left"
              style={GLASS}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: LIVE }} />
              <span className="grow min-w-0 truncate text-[14.5px] font-medium text-white">{label}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60 shrink-0" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
          )}
          {chipRow}
          {composer}
          {footnote}
        </div>
      </div>
      )}
    </div>

    {/* Wide screens: the project's card stays beside the conversation */}
    {dock && (
      <aside className="chat-glass hidden lg:block w-[400px] xl:w-[440px] shrink-0 min-h-0 overflow-y-auto px-5 pt-4 pb-6" aria-label={label}>
        {dock}
      </aside>
    )}

    {/* Phones and tablets: the same card in a sheet, back to the chat in one tap */}
    {dock && dockOpen && (
      <div className="lg:hidden fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={label}>
        <button type="button" aria-label={lang === "es" ? "Cerrar" : "Close"} className="absolute inset-0 w-full bg-black/35" onClick={() => setDockOpen(false)} />
        <div className="chat-glass absolute left-0 right-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[28px] px-4 pt-3 pb-[calc(16px+env(safe-area-inset-bottom))]" style={{ background: "linear-gradient(180deg, #07130c 0%, #0a2716 100%)" }}>
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
          {dock}
          <button type="button" onClick={() => setDockOpen(false)} className="p-btn full mt-4">
            {lang === "es" ? "Volver al chat" : "Back to chat"}
          </button>
        </div>
      </div>
    )}
    </div>
  );
}

// The capacity window: which limit, what the next plan adds, its price, and
// "Mejorar plan" first; continuing later is only the second option.
function UpgradeCard({ limit, lang, onPlans, onLater }: { limit: LimitInfo; lang: "es" | "en"; onPlans?: () => void; onLater: () => void }) {
  const t = upgradeText(limit, lang);
  return (
    <div role="alert" className="mb-3 rounded-[24px] p-4 md:p-5 flex flex-col gap-3 bg-white" style={{ boxShadow: "0 0 0 1px rgba(10,10,10,.08), 0 10px 30px -14px rgba(10,10,10,.16)", animation: "dash-fade .35s ease both" }}>
      <div className="flex flex-col gap-1">
        <span className="text-[15.5px] font-semibold text-pfg leading-snug">{t.title}</span>
        <span className="text-[13.5px] text-psub leading-relaxed">{t.body}</span>
      </div>
      {t.gains.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-pfg">{t.gainsTitle}</span>
          <ul className="flex flex-col gap-1">
            {t.gains.map((g) => (
              <li key={g} className="text-[13.5px] text-pfg2 leading-relaxed flex gap-2">
                <span className="h-1.5 w-1.5 rounded-full shrink-0 mt-[8px]" style={{ background: ACCENT }} />
                <span className="min-w-0">{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.soon && <span className="text-[13px] text-psub">{t.soon}</span>}
      <div className="flex items-center gap-3 flex-wrap">
        {limit.canUpgrade && onPlans && (
          <button type="button" onClick={onPlans} className="h-10 px-5 rounded-full text-[14px] font-semibold" style={BRAND_BTN}>
            {t.cta}
            {t.price ? ` · ${t.price}` : ""}
          </button>
        )}
        <button type="button" onClick={onLater} className="text-[13px] text-psub underline underline-offset-2">
          {t.later}
        </button>
      </div>
    </div>
  );
}
