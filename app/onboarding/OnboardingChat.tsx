"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { completeOnboardingAction, type OnboardingAnswers } from "@/app/actions";
import { nextOnboardingPrompt, type OnboardingStep } from "@/lib/ai";
import { useLang, useT } from "@/components/LangProvider";

type Msg = { role: "ai" | "user"; text: string };

const STEP_ORDER: OnboardingStep[] = ["ask_name", "ask_category", "ask_city", "ask_description", "done"];

export default function OnboardingChat() {
  const lang = useLang();
  const t = useT();
  const [step, setStep] = useState<OnboardingStep>("ask_name");
  const [messages, setMessages] = useState<Msg[]>([{ role: "ai", text: nextOnboardingPrompt("ask_name", lang) }]);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = input.trim();
    if (!value || step === "done" || isPending) return;

    const updatedAnswers = { ...answers };
    if (step === "ask_name") updatedAnswers.name = value;
    if (step === "ask_category") updatedAnswers.categoryRaw = value;
    if (step === "ask_city") updatedAnswers.city = value;
    if (step === "ask_description") updatedAnswers.description = value;

    const currentIndex = STEP_ORDER.indexOf(step);
    const nextStep = STEP_ORDER[currentIndex + 1];

    setMessages((m) => [...m, { role: "user", text: value }]);
    setAnswers(updatedAnswers);
    setInput("");
    setError(null);

    if (nextStep === "done") {
      setMessages((m) => [...m, { role: "ai", text: nextOnboardingPrompt("done", lang) }]);
      setStep("done");
      startTransition(async () => {
        try {
          await completeOnboardingAction(updatedAnswers as OnboardingAnswers);
        } catch (err: any) {
          if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
          setError(t.common.buildError);
          setStep("ask_description");
        }
      });
    } else {
      setMessages((m) => [...m, { role: "ai", text: nextOnboardingPrompt(nextStep, lang) }]);
      setStep(nextStep);
    }
  }

  return (
    <div className="w-full max-w-[560px] mx-auto flex flex-col gap-4">
      <div className="card flex flex-col gap-3 min-h-[420px]">
        <div className="flex items-center gap-2.5 pb-3 border-b border-border">
          <div className="w-7 h-7 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-semibold">
            S
          </div>
          <span className="text-[13px] font-semibold">{t.common.aiName}</span>
        </div>
        <div className="flex flex-col gap-2.5 flex-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[80%] bg-ink text-white rounded-[12px_12px_3px_12px] px-3.5 py-2.5 text-[13.5px]"
                    : "max-w-[80%] bg-mint text-ink rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px] whitespace-pre-line"
                }
              >
                {m.text}
              </div>
            </div>
          ))}
          {isPending && (
            <div className="flex justify-start">
              <div className="max-w-[80%] bg-mint text-muted rounded-[12px_12px_12px_3px] px-3.5 py-2.5 text-[13.5px]">
                {t.common.buildingPage}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <form onSubmit={handleSubmit} className="flex gap-2.5">
        <input
          className="input flex-1"
          placeholder={step === "done" ? "…" : t.common.typeAnswer}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={step === "done" || isPending}
          autoFocus
        />
        <button type="submit" className="btn-primary" disabled={step === "done" || isPending}>
          {t.common.send}
        </button>
      </form>
    </div>
  );
}
