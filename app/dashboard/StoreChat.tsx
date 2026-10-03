"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { sendStoreChatAction, uploadStoreImageAction } from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

type Msg = { id: string; role: string; content: string };

const PHOTO = /^📷\s+(https:\/\/\S+)$/;

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

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
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-5 flex flex-col gap-3">
        {messages.map((m) => {
          const photo = PHOTO.exec(m.content);
          const mine = m.role === "user";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo[1]} alt="" className="max-w-[220px] rounded-2xl border border-border" />
              ) : (
                <div
                  className={
                    mine
                      ? "max-w-[85%] bg-ink text-white rounded-[16px_16px_4px_16px] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-line"
                      : "max-w-[85%] bg-mint text-ink rounded-[16px_16px_16px_4px] px-4 py-2.5 text-[14.5px] leading-relaxed whitespace-pre-line"
                  }
                >
                  {m.content}
                </div>
              )}
            </div>
          );
        })}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-mint text-muted rounded-[16px_16px_16px_4px] px-4 py-2.5 text-[14px]">{t.thinking}</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-border px-3 md:px-5 py-3">
        {error && <p className="text-[13px] text-[#ff6b6b] mb-2">{error}</p>}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label className={`dash-chip !h-[46px] !px-3 cursor-pointer shrink-0 ${pending ? "opacity-50 pointer-events-none" : ""}`} title={t.attach} aria-label={t.attach}>
            📎
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
            className="input flex-1 !h-auto min-h-[46px] max-h-[160px] py-3 resize-none"
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
          <button type="submit" className="btn-primary !h-[46px] px-5 shrink-0" disabled={pending || !input.trim()}>
            ↑
          </button>
        </form>
      </div>
    </div>
  );
}
