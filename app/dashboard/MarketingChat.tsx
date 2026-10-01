"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { sendMarketingMessageAction } from "@/app/actions";
import type { ClientCampaign } from "./DashboardTabs";

type Msg = { id: string; role: string; content: string };

export default function MarketingChat({
  initialMessages,
  onCampaignsUpdated,
}: {
  initialMessages: Msg[];
  onCampaignsUpdated: (campaigns: ClientCampaign[]) => void;
}) {
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
      const result = await sendMarketingMessageAction(value);
      setMessages(result.messages.map((m) => ({ id: m.id, role: m.role, content: m.content })));
      onCampaignsUpdated(
        result.campaigns.map((c) => ({
          id: c.id,
          title: c.title,
          goal: c.goal,
          status: c.status,
          adCopy: c.adCopy,
          budgetNote: c.budgetNote,
          audience: c.audience,
          platforms: c.platforms,
          variations: c.variations,
        }))
      );
    });
  }

  return (
    <div className="card flex flex-col gap-3 min-h-[420px]">
      <div className="flex items-center gap-2.5 pb-3 border-b border-border">
        <div className="w-7 h-7 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-semibold">
          S
        </div>
        <div>
          <div className="text-[13px] font-semibold">Sevrii AI</div>
          <div className="text-[11px] text-mutedLight">Your marketing agent</div>
        </div>
      </div>
      <div className="flex flex-col gap-2.5 flex-1">
        {messages.length === 0 && (
          <p className="text-[13.5px] text-muted">
            Tell me what you want more of this month — bookings, calls, visits — and I&rsquo;ll draft a
            campaign.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] bg-ink text-white rounded-[12px_12px_3px_12px] px-3.5 py-2.5 text-[13.5px] whitespace-pre-line"
                  : "max-w-[85%] bg-mint text-ink rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px] whitespace-pre-line"
              }
            >
              {m.content}
            </div>
          </div>
        ))}
        {isPending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-mint text-muted rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px]">
              Drafting…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2.5 pt-2 border-t border-border">
        <input
          className="input flex-1"
          placeholder="e.g. Get more weekend bookings"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isPending}
        />
        <button type="submit" className="btn-primary" disabled={isPending}>
          Send
        </button>
      </form>
    </div>
  );
}
