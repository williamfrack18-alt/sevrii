"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { sendPageEditCommand } from "@/app/actions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { useT } from "@/components/LangProvider";

type Msg = { id: string; role: string; content: string };

export default function EditorChat({
  business,
  services,
  initialMessages,
  onUpdated,
}: {
  business: ClientBusiness;
  services: ClientService[];
  initialMessages: Msg[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = input.trim();
    if (!value || isPending) return;
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", content: value }]);
    setInput("");
    startTransition(async () => {
      const result = await sendPageEditCommand(value);
      setMessages(result.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
      onUpdated(
        toClientBusiness(result.business),
        result.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2.5 pb-3 border-b border-border">
        <div className="w-7 h-7 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-semibold">
          S
        </div>
        <div>
          <div className="text-[13px] font-semibold">{t.common.aiName}</div>
          <div className="text-[11px] text-mutedLight">{t.dashboard.editorSubtitle}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-[13.5px] text-muted">{t.dashboard.editorEmpty}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[90%] bg-ink text-white rounded-[12px_12px_3px_12px] px-3.5 py-2.5 text-[13.5px] whitespace-pre-line"
                  : "max-w-[90%] bg-mint text-ink rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px] whitespace-pre-line"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {isPending && (
          <div className="flex justify-start">
            <div className="max-w-[90%] bg-mint text-muted rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px]">
              {t.common.thinking}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2 pt-2 border-t border-border">
        <input
          className="input flex-1"
          placeholder={t.dashboard.editorPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isPending}
        />
        <button type="submit" className="btn-primary px-4" disabled={isPending}>
          {t.common.send}
        </button>
      </form>
    </div>
  );
}
