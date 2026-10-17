"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
};

const PHOTO = /^📷\s+(https:\/\/\S+)$/;
const VIDEO = /^🎥\s+(https:\/\/\S+)$/;
// An assistant message can carry interactive boxes: "[[card:media]]".
const CARD = /\[\[card:([a-z]+)\]\]/g;

export type ChatTool = { key: string; label: string };
const GREEN = ACCENT;

// Clean, ChatGPT-style chat in Sevrii's colors: black canvas, assistant text
// without bubbles, the owner's messages in a soft gray bubble, one rounded
// composer. Empty state = a centered question with the composer in the middle.
// Used by Store and Marketing.
export default function ChatPanel({
  greeting,
  initialMessages,
  texts,
  onSend,
  onUpload,
  locked,
  sync,
  prefill,
  tools,
  renderCard,
}: {
  // Buttons above the composer that open a box inside the chat (photos, area…).
  tools?: ChatTool[];
  // Draws an interactive box (from a tool button or a "[[card:x]]" in a reply).
  renderCard?: (key: string) => React.ReactNode;
  greeting: string;
  initialMessages: Msg[];
  texts: ChatTexts;
  onSend: (text: string) => Promise<Msg[]>;
  // Uploads a photo and returns the text to send for it, or an error message.
  onUpload?: (file: File) => Promise<{ send: string } | { error: string }>;
  // When set, the composer is replaced by this note (e.g. while researching).
  locked?: React.ReactNode;
  // Replace the messages from outside (new key = new messages).
  sync?: { key: number; messages: Msg[] };
  // Put text in the composer from outside (e.g. a "Change" button).
  prefill?: { key: number; text: string };
}) {
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [openTool, setOpenTool] = useState<string | null>(null);
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
  }, [messages, pending]);

  // Grow the composer with the text.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  function send(text: string) {
    const value = text.trim();
    if (!value || pending) return;
    setError("");
    setMessages((m) => [
      ...(m.length === 0 ? [{ id: "greeting", role: "ai", content: greeting }] : m),
      { id: `local-${Date.now()}`, role: "user", content: value },
    ]);
    setInput("");
    start(async () => {
      try {
        setMessages(await onSend(value));
      } catch {
        setError(texts.failed);
      }
    });
  }

  function upload(file: File | undefined) {
    if (!file || pending || !onUpload) return;
    setError("");
    start(async () => {
      const res = await onUpload(file);
      if ("error" in res) setError(res.error);
      else send(res.send);
    });
  }

  const canSend = !pending && input.trim().length > 0;
  const lastCard: Record<string, number> = {};
  messages.forEach((m, i) => {
    if (m.role !== "user") for (const x of m.content.matchAll(CARD)) lastCard[x[1]] = i;
  });

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
      {openTool && renderCard && (
        <div className="relative mb-2 max-h-[52vh] overflow-y-auto rounded-2xl">
          <button
            type="button"
            onClick={() => setOpenTool(null)}
            aria-label="close"
            className="absolute top-3 right-3 z-10 h-7 w-7 rounded-full text-[#d4d4d4] hover:bg-white/10 text-[18px] leading-none"
          >
            ×
          </button>
          {renderCard(openTool)}
        </div>
      )}
      {tools && tools.length > 0 && renderCard && (
        <div className="flex flex-wrap gap-2 mb-2 px-1">
          {tools.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setOpenTool((o) => (o === t.key ? null : t.key))}
              className="h-8 px-3.5 rounded-full text-[13px] font-medium transition"
              style={openTool === t.key ? { background: "rgba(46,122,85,.25)", color: "#fff", boxShadow: `0 0 0 1px ${ACCENT}` } : { background: "#1a1a1a", color: "#d4d4d4", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex items-end gap-1.5 rounded-[28px] px-2.5 py-2.5"
        style={{ background: "#1f1f1f", boxShadow: "0 0 0 1px rgba(255,255,255,0.06)" }}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {onUpload ? (
        <label
          className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-[#d4d4d4] hover:bg-white/10 cursor-pointer transition ${pending ? "opacity-40 pointer-events-none" : ""}`}
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
          className="flex-1 bg-transparent outline-none resize-none text-[16px] leading-[1.5] text-white placeholder:text-[#8e8e8e] py-2 max-h-[200px]"
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
          disabled={pending}
        />
        <button
          type="submit"
          aria-label="Enviar"
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
    <p className="text-center text-[12px] text-[#8e8e8e] pt-2.5 px-4">
      {texts.disclaimer}{" "}
      <a href={texts.seeBelowHref} className="underline underline-offset-2 hover:text-white">
        {texts.seeBelow}
      </a>
    </p>
  );

  if (empty) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-[760px] flex flex-col items-center gap-8">
          <div className="text-center flex flex-col gap-3">
            <h1 className="text-[28px] md:text-[32px] font-medium tracking-[-0.02em] text-white">{texts.emptyTitle}</h1>
            <p className="text-[15px] text-[#a1a1aa] max-w-[560px]">{texts.emptySub}</p>
          </div>
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-4 md:px-6 pt-6 pb-8 flex flex-col gap-7">
          {messages.map((m, idx) => {
            const photo = PHOTO.exec(m.content);
            const video = VIDEO.exec(m.content);
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  {video ? (
                    <video src={video[1]} controls playsInline preload="metadata" className="max-w-[280px] rounded-3xl bg-black" />
                  ) : photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo[1]} alt="" className="max-w-[240px] rounded-3xl" />
                  ) : (
                    <div className="max-w-[78%] rounded-3xl px-5 py-3 text-[15.5px] leading-[1.6] whitespace-pre-line" style={{ background: "#2a2a2a", color: "#fff" }}>
                      {m.content}
                    </div>
                  )}
                </div>
              );
            }
            const cards = renderCard ? [...m.content.matchAll(CARD)].map((x) => x[1]) : [];
            const text = m.content.replace(CARD, "").trim();
            return (
              <div key={m.id} className="flex flex-col gap-3">
                {text && (
                  <div className="text-[15.5px] leading-[1.7] whitespace-pre-line" style={{ color: "#e8e8e8" }}>
                    {text}
                  </div>
                )}
                {cards.map((c, i) =>
                  // Only the latest mention shows the full box; older ones become a button.
                  lastCard[c] === idx ? (
                    <div key={`${c}-${i}`}>{renderCard!(c)}</div>
                  ) : (
                    <button
                      key={`${c}-${i}`}
                      type="button"
                      onClick={() => setOpenTool(c)}
                      className="self-start h-8 px-3.5 rounded-full text-[13px] font-medium"
                      style={{ background: "#1a1a1a", color: "#d4d4d4", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" }}
                    >
                      {tools?.find((t) => t.key === c)?.label ?? c}
                    </button>
                  )
                )}
              </div>
            );
          })}
          {pending && (
            <div className="flex items-center gap-1.5 h-6" aria-label={texts.thinking}>
              <span className="h-2.5 w-2.5 rounded-full animate-pulse" style={{ background: ACCENT }} />
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 px-4 md:px-6 pb-3">
        <div className="max-w-[760px] mx-auto">
          {composer}
          {footnote}
        </div>
      </div>
    </div>
  );
}
