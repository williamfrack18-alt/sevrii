"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { ACCENT, BRAND_BTN } from "@/lib/brand";
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

const isVideo = (f: File) => f.type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(f.name);

// Clean, ChatGPT-style chat in Sevrii's colors: black canvas, assistant text
// without bubbles, the owner's messages in a soft gray bubble, one rounded
// composer. Empty state = a centered question with the composer in the middle.
// Used by Brain, Store and Marketing.
export default function ChatPanel({
  greeting,
  initialMessages,
  texts,
  onSend,
  onUpload,
  locked,
  sync,
  prefill,
}: {
  greeting: string;
  initialMessages: Msg[];
  texts: ChatTexts;
  onSend: (text: string) => Promise<Msg[]>;
  // Uploads a photo or video and returns the text to send for it, or an error
  // message. Videos report progress (0–100) while they upload.
  onUpload?: (file: File, onProgress: (percentage: number) => void) => Promise<{ send: string } | { error: string }>;
  // When set, the composer is replaced by this note (e.g. while researching).
  locked?: React.ReactNode;
  // Replace the messages from outside (new key = new messages).
  sync?: { key: number; messages: Msg[] };
  // Put text in the composer from outside (e.g. a "Change" button).
  prefill?: { key: number; text: string };
}) {
  const lang = useLang();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  // A photo or video on its way to storage (percentage only for videos).
  const [uploading, setUploading] = useState<{ video: boolean; pct: number } | null>(null);
  const busy = pending || uploading !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const empty = messages.length === 0;

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
  }, [messages, pending, uploading !== null]);

  // Grow the composer with the text.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function send(text: string) {
    if (busy || !text.trim()) return;
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
        setMessages(await onSend(value));
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

  // Shown while a photo or video uploads, also in an empty chat.
  const uploadRow = uploading && (
    <div className="flex justify-end" role="status" aria-live="polite">
      <div className="w-[240px] max-w-[78%] rounded-3xl px-5 py-3 flex flex-col gap-2" style={{ background: "#2a2a2a" }}>
        <div className="flex items-center justify-between gap-3 text-[14px] text-[#d4d4d4]">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full animate-pulse shrink-0" style={{ background: ACCENT }} />
            {uploading.video ? texts.uploadingVideo ?? texts.attach : texts.uploadingPhoto ?? texts.attach}
          </span>
          {uploading.video && <span className="tabular-nums text-[#a1a1aa]">{uploading.pct}%</span>}
        </div>
        {uploading.video && (
          <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${uploading.pct}%`, background: ACCENT }} />
          </div>
        )}
      </div>
    </div>
  );

  const composer = locked ? (
    <div className="w-full">
      <div
        className="flex items-start gap-3 rounded-[24px] px-5 py-4 text-[15px] text-[#d4d4d4]"
        style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}
      >
        <span className="h-2.5 w-2.5 mt-[7px] rounded-full animate-pulse shrink-0" style={{ background: ACCENT }} />
        {locked}
      </div>
    </div>
  ) : (
    <div className="w-full">
      {error && <p className="text-[13px] text-[#ff6b6b] mb-2 px-4">{error}</p>}
      <form
        className="flex items-end gap-1.5 rounded-[26px] md:rounded-[28px] px-2 md:px-2.5 py-2 md:py-2.5"
        style={{ background: "#1f1f1f", boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {onUpload ? (
        <label
          className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-[#d4d4d4] hover:bg-white/10 cursor-pointer transition ${busy ? "opacity-40 pointer-events-none" : ""}`}
          title={texts.attach}
          aria-label={texts.attach}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <input
            type="file"
            accept="image/*,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        ) : (
          <span className="w-2" />
        )}
        <textarea
          ref={inputRef}
          rows={1}
          autoFocus={empty}
          className="flex-1 min-w-0 bg-transparent outline-none resize-none text-[16px] leading-[1.5] text-white placeholder:text-[#8e8e8e] py-2 max-h-[200px]"
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
        <button
          type="submit"
          aria-label={lang === "es" ? "Enviar" : "Send"}
          title={lang === "es" ? "Enviar" : "Send"}
          className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center transition"
          style={canSend ? BRAND_BTN : { background: "#3a3a3a", color: "#8e8e8e" }}
          disabled={!canSend}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );

  const footnote = (
    <p className="text-center text-[11.5px] md:text-[12px] text-[#8e8e8e] pt-2 md:pt-2.5 px-2 md:px-4">
      {texts.disclaimer}{" "}
      <a href={texts.seeBelowHref} className="underline underline-offset-2 hover:text-white">
        {texts.seeBelow}
      </a>
    </p>
  );

  if (empty) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center px-4 overflow-y-auto">
        <div className="w-full max-w-[760px] my-auto py-4 md:py-0 flex flex-col items-center gap-6 md:gap-8">
          <div className="text-center flex flex-col gap-3">
            <h1 className="text-[24px] md:text-[32px] leading-tight font-medium tracking-[-0.02em] text-white">{texts.emptyTitle}</h1>
            <p className="text-[15px] text-[#a1a1aa] max-w-[560px]">{texts.emptySub}</p>
          </div>
          {uploadRow && <div className="w-full px-1">{uploadRow}</div>}
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div className="max-w-[760px] mx-auto px-4 md:px-6 pt-4 md:pt-6 pb-6 md:pb-8 flex flex-col gap-6 md:gap-7">
          {messages.map((m) => {
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
                    <div className="max-w-[85%] md:max-w-[78%] rounded-3xl px-4 md:px-5 py-2.5 md:py-3 text-[15px] md:text-[15.5px] leading-[1.55] md:leading-[1.6] whitespace-pre-line break-words [overflow-wrap:anywhere]" style={{ background: "#2a2a2a", color: "#fff" }}>
                      {m.content}
                    </div>
                  )}
                </div>
              );
            }
            const text = m.content.replace(OLD_CARD, "").trim();
            if (!text) return null;
            return (
              <div key={m.id} className="min-w-0 text-[15px] md:text-[15.5px] leading-[1.65] md:leading-[1.7] whitespace-pre-line break-words [overflow-wrap:anywhere]" style={{ color: "#e8e8e8" }}>
                {text}
              </div>
            );
          })}
          {uploadRow}
          {pending && (
            <div className="flex items-center gap-1.5 h-6" aria-label={texts.thinking}>
              <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: ACCENT }} />
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-4 md:px-6 pt-1 md:pt-0 pb-3">
        <div className="max-w-[760px] mx-auto">
          {composer}
          {footnote}
        </div>
      </div>
    </div>
  );
}
