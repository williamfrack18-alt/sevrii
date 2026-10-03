"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { sendStoreChatAction, uploadStoreImageAction } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

type Msg = { id: string; role: string; content: string };

const PHOTO = /^📷\s+(https:\/\/\S+)$/;

// A clean, ChatGPT-style chat: assistant text without bubbles, the owner's
// messages in a soft bubble, one rounded composer at the bottom.
export default function StoreChat({
  greeting,
  initialMessages,
  onUpdated,
  onMessages,
}: {
  greeting: string;
  initialMessages: Msg[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: Msg[]) => void;
}) {
  const t = STORE_TEXT[useLang()].editor;
  const [messages, setMessages] = useState<Msg[]>(initialMessages.length ? initialMessages : [{ id: "greeting", role: "ai", content: greeting }]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  // Grow the composer with the text, like ChatGPT.
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
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: value }]);
    setInput("");
    start(async () => {
      try {
        const res = await sendStoreChatAction(value);
        setMessages(res.messages);
        onMessages?.(res.messages);
        onUpdated(
          toClientBusiness(res.business),
          res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))
        );
      } catch {
        setError(t.saveFailed);
      }
    });
  }

  function upload(file: File | undefined) {
    if (!file || pending) return;
    if (file.size > 4 * 1024 * 1024) return setError(t.photos.tooBig);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setError(t.photos.badType);
    setError("");
    const fd = new FormData();
    fd.set("kind", "gallery");
    fd.set("file", file);
    start(async () => {
      const res = await uploadStoreImageAction(fd);
      if (!res.ok) {
        setError(t.photos[res.error === "rate" ? "failed" : res.error]);
        return;
      }
      const url = res.business.site.gallery[res.business.site.gallery.length - 1];
      if (url) send(`📷 ${url}`);
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[760px] mx-auto px-4 md:px-6 pt-10 pb-6 flex flex-col gap-6">
          {messages.map((m) => {
            const photo = PHOTO.exec(m.content);
            if (m.role === "user") {
              return (
                <div key={m.id} className="flex justify-end">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo[1]} alt="" className="max-w-[240px] rounded-2xl" />
                  ) : (
                    <div className="max-w-[80%] rounded-[22px] px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-line" style={{ background: "#2a2b2a", color: "#fff" }}>
                      {m.content}
                    </div>
                  )}
                </div>
              );
            }
            return (
              <div key={m.id} className="flex gap-3">
                <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold text-black" style={{ background: "#3ddc84" }}>
                  S
                </span>
                <div className="text-ink text-[15.5px] leading-[1.7] whitespace-pre-line pt-0.5">{m.content}</div>
              </div>
            );
          })}
          {pending && (
            <div className="flex gap-3 items-center">
              <span className="h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold text-black" style={{ background: "#3ddc84" }}>
                S
              </span>
              <span className="flex gap-1" aria-label={t.thinking}>
                <span className="h-2 w-2 rounded-full bg-muted animate-bounce [animation-delay:-0.3s]" />
                <span className="h-2 w-2 rounded-full bg-muted animate-bounce [animation-delay:-0.15s]" />
                <span className="h-2 w-2 rounded-full bg-muted animate-bounce" />
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 md:px-6 pb-4 pt-2">
        <div className="max-w-[760px] mx-auto">
          {error && <p className="text-[13px] text-[#ff6b6b] mb-2 px-2">{error}</p>}
          <form
            className="flex items-end gap-2 rounded-[28px] border border-borderStrong bg-white px-2.5 py-2 focus-within:border-[#3ddc84] transition"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <label
              className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-mint cursor-pointer ${pending ? "opacity-40 pointer-events-none" : ""}`}
              title={t.attach}
              aria-label={t.attach}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.4 11.1l-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />
              </svg>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  upload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <textarea
              ref={inputRef}
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[15.5px] text-ink placeholder:text-mutedLight py-2 max-h-[200px]"
              placeholder={t.chatPlaceholder}
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
              className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center bg-ink disabled:opacity-30 transition"
              disabled={pending || !input.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
          <div className="flex justify-between gap-3 px-3 pt-2 text-[11.5px] text-mutedLight">
            <span className="hidden sm:inline">{t.disclaimer}</span>
            <a href="#store-page" className="hover:text-ink whitespace-nowrap">
              {t.seePageBelow}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
