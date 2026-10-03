"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import {
  nextDiscoveryPrompt,
  generateAnalysis,
  generateIdeas,
  type DiscoveryStep,
  type DiscoveryAnswers,
  type Idea,
  type Cluster,
} from "@/lib/ai";
import { completeDiscoveryAction, type DiscoveryDetailAnswers } from "@/app/actions";
import { useLang, useT } from "@/components/LangProvider";

type Msg = { role: "ai" | "user"; text: string };

const DISCOVERY_STEPS: DiscoveryStep[] = ["ask_location", "ask_background", "ask_license", "ask_capacity", "done"];

type Phase = "chat1" | "analysis" | "ideas" | "chat2" | "proposal";

function ChatCard({
  title,
  subtitle,
  messages,
  input,
  setInput,
  onSubmit,
  disabled,
}: {
  title: string;
  subtitle: string;
  messages: Msg[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  disabled: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = useT();
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="w-full max-w-[680px] mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-ink flex items-center justify-center text-white text-[12px] font-semibold">
          S
        </div>
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="text-[12px] text-mutedLight">{subtitle}</div>
        </div>
      </div>
      <div className="card flex flex-col gap-3 min-h-[420px]">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] bg-ink text-white rounded-[14px_14px_4px_14px] px-4 py-3 text-[14px]"
                  : "max-w-[80%] bg-mint text-ink rounded-[14px_14px_14px_4px] px-4 py-3 text-[14px]"
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {!disabled && (
        <form onSubmit={onSubmit} className="flex gap-2.5">
          <input
            className="input flex-1"
            placeholder={t.common.typeAnswer}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary">
            {t.common.send}
          </button>
        </form>
      )}
    </div>
  );
}

export default function DiscoveryFlow({ newProject = false }: { newProject?: boolean }) {
  const lang = useLang();
  const t = useT();
  const DETAIL_PROMPTS = t.discover.detailPrompts;
  const [phase, setPhase] = useState<Phase>("chat1");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // --- Phase 1: discovery chat ---
  const [step1, setStep1] = useState(0);
  const [messages1, setMessages1] = useState<Msg[]>([{ role: "ai", text: nextDiscoveryPrompt("ask_location", lang) }]);
  const [input1, setInput1] = useState("");
  const [discovery, setDiscovery] = useState<DiscoveryAnswers>({
    location: "",
    background: "",
    license: "",
    capacity: "",
  });

  function submitChat1(e: React.FormEvent) {
    e.preventDefault();
    const value = input1.trim();
    if (!value) return;
    const key = (["location", "background", "license", "capacity"] as const)[step1];
    const updated = { ...discovery, [key]: value };
    setDiscovery(updated);
    setMessages1((m) => [...m, { role: "user", text: value }]);
    setInput1("");

    const next = DISCOVERY_STEPS[step1 + 1];
    if (next === "done") {
      setMessages1((m) => [...m, { role: "ai", text: nextDiscoveryPrompt("done", lang) }]);
      setTimeout(() => setPhase("analysis"), 500);
    } else {
      setMessages1((m) => [...m, { role: "ai", text: nextDiscoveryPrompt(next, lang) }]);
      setStep1(step1 + 1);
    }
  }

  // --- Phase 2: analysis (derived) ---
  const analysis = phase !== "chat1" ? generateAnalysis(discovery, lang) : null;

  // --- Phase 3: ideas ---
  const [altSet, setAltSet] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const ideas = analysis ? generateIdeas(analysis.cluster as Cluster, altSet, analysis.hasLicense, lang) : [];

  // --- Phase 4: detail chat ---
  const [step2, setStep2] = useState(0);
  const [messages2, setMessages2] = useState<Msg[]>([]);
  const [input2, setInput2] = useState("");
  const [details, setDetails] = useState<DiscoveryDetailAnswers>({
    businessName: "",
    pricing: "",
    travelContact: "",
    photos: "",
  });

  function enterChat2(idea: Idea) {
    setSelectedIdea(idea);
    setMessages2([{ role: "ai", text: `${t.discover.goodChoice(idea.title)} ${DETAIL_PROMPTS[0]}` }]);
    setStep2(0);
    setPhase("chat2");
  }

  function submitChat2(e: React.FormEvent) {
    e.preventDefault();
    const value = input2.trim();
    if (!value) return;
    const key = (["businessName", "pricing", "travelContact", "photos"] as const)[step2];
    const updated = { ...details, [key]: value };
    setDetails(updated);
    setMessages2((m) => [...m, { role: "user", text: value }]);
    setInput2("");

    if (step2 + 1 >= DETAIL_PROMPTS.length) {
      setMessages2((m) => [
        ...m,
        { role: "ai", text: t.discover.enough },
      ]);
      setTimeout(() => setPhase("proposal"), 500);
    } else {
      setMessages2((m) => [...m, { role: "ai", text: DETAIL_PROMPTS[step2 + 1] }]);
      setStep2(step2 + 1);
    }
  }

  // --- Phase 5: proposal ---
  const [whatsapp, setWhatsapp] = useState("");

  function submitProposal() {
    if (!selectedIdea) return;
    setError(null);
    startTransition(async () => {
      try {
        await completeDiscoveryAction({ discovery, idea: selectedIdea, details, whatsapp, newProject });
      } catch (err: any) {
        if (err?.digest?.startsWith?.("NEXT_REDIRECT")) throw err;
        setError(t.common.buildError);
      }
    });
  }

  return (
    <div className="min-h-screen bg-cream flex flex-col items-center py-10 px-6">
      <div className="flex items-center gap-2.5 mb-8">
        {["chat1", "analysis", "ideas", "chat2"].map((p, i) => {
          const order = ["chat1", "analysis", "ideas", "chat2", "proposal"];
          const filled = order.indexOf(phase) >= i;
          return <div key={p} className={`w-[34px] h-[6px] rounded-full ${filled ? "bg-ink" : "bg-borderStrong"}`} />;
        })}
      </div>

      {phase === "chat1" && (
        <ChatCard
          title={t.common.aiName}
          subtitle={t.discover.chat1Subtitle}
          messages={messages1}
          input={input1}
          setInput={setInput1}
          onSubmit={submitChat1}
          disabled={false}
        />
      )}

      {phase === "analysis" && analysis && (
        <div className="w-full max-w-[960px] flex flex-col items-center gap-7">
          <div className="flex flex-col items-center gap-2.5 text-center max-w-[640px]">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink flex items-center gap-2">
              {t.discover.analysisEyebrow}
            </span>
            <h1 className="font-serif text-[40px] leading-[1.08]">{t.discover.analysisTitle}</h1>
            <p className="text-muted text-[15px] leading-relaxed">{t.discover.analysisText}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5 w-full">
            <div className="card flex flex-col gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mutedLight">{t.discover.localDemand}</div>
              <p className="text-[13.5px] leading-relaxed">{analysis.localDemand}</p>
            </div>
            <div className="card flex flex-col gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mutedLight">{t.discover.yourFit}</div>
              <p className="text-[13.5px] leading-relaxed">{analysis.yourFit}</p>
            </div>
            <div className="card flex flex-col gap-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-mutedLight">{t.discover.startupCost}</div>
              <p className="text-[13.5px] leading-relaxed">{analysis.startupCost}</p>
            </div>
          </div>
          {analysis.ruledOut.length > 0 && (
            <div className="card w-full flex flex-col gap-2.5">
              <div className="text-[13px] font-semibold">{t.discover.ruledOut}</div>
              {analysis.ruledOut.map((r) => (
                <div key={r.title} className="flex gap-2.5 items-start">
                  <span className="w-[5px] h-[5px] rounded-full bg-mutedLight mt-2 flex-shrink-0" />
                  <p className="text-[13px] text-muted leading-relaxed">
                    <span className="font-medium text-ink">{r.title}</span> — {r.reason}
                  </p>
                </div>
              ))}
            </div>
          )}
          <button type="button" className="btn-primary w-[280px] h-[48px]" onClick={() => setPhase("ideas")}>
            {t.discover.seeIdeas}
          </button>
        </div>
      )}

      {phase === "ideas" && (
        <div className="w-full max-w-[960px] flex flex-col items-center gap-6">
          <div className="flex flex-col items-center gap-2.5 text-center max-w-[600px]">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink">
              {altSet ? t.discover.moreIdeasEyebrow : t.discover.ideasEyebrow}
            </span>
            <h1 className="font-serif text-[40px] leading-[1.08]">{t.discover.ideasTitle}</h1>
            <p className="text-muted text-[15px]">{t.discover.ideasText}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-5 w-full">
            {ideas.map((idea) => (
              <button
                key={idea.title}
                type="button"
                onClick={() => setSelectedIdea(idea)}
                className={`text-left rounded-2xl p-6 flex flex-col gap-3.5 border-2 transition ${
                  selectedIdea?.title === idea.title ? "border-ink bg-mint" : "border-border bg-white"
                }`}
              >
                <span className="self-start px-2.5 py-1 rounded-full bg-mint text-[12px] font-medium">{idea.tag}</span>
                <h3 className="text-[17px] font-semibold leading-snug">{idea.title}</h3>
                <p className="text-[13px] text-muted leading-relaxed">{idea.desc}</p>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setAltSet(!altSet);
              setSelectedIdea(null);
            }}
            className="flex items-center gap-2 text-[14px] font-medium text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2v6h-6M3 22v-6h6" />
              <path d="M3.5 14A9 9 0 0 0 20 17.5M20.5 10A9 9 0 0 0 4 6.5" />
            </svg>
            {altSet ? t.discover.backToFirst : t.discover.showOther}
          </button>
          <button
            type="button"
            disabled={!selectedIdea}
            onClick={() => selectedIdea && enterChat2(selectedIdea)}
            className={`w-[280px] h-[48px] rounded-[10px] text-[15px] font-semibold ${
              selectedIdea ? "btn-primary" : "bg-borderStrong text-mutedLight cursor-not-allowed"
            }`}
          >
            {t.discover.useIdea}
          </button>
        </div>
      )}

      {phase === "chat2" && selectedIdea && (
        <ChatCard
          title={t.common.aiName}
          subtitle={t.discover.chat2Subtitle(selectedIdea.title)}
          messages={messages2}
          input={input2}
          setInput={setInput2}
          onSubmit={submitChat2}
          disabled={false}
        />
      )}

      {phase === "proposal" && selectedIdea && (
        <div className="w-full max-w-[640px] flex flex-col items-center gap-7">
          <div className="card w-full flex flex-col gap-5">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-ink">{t.discover.proposalEyebrow}</span>
            <div className="flex flex-col gap-1.5">
              <h1 className="font-serif text-3xl font-semibold">{details.businessName}</h1>
              <p className="text-ink font-medium text-[16px]">{selectedIdea.tagline}</p>
            </div>
            <p className="text-muted text-[15px] leading-relaxed">{selectedIdea.desc}</p>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2.5 text-[14px]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                {details.pricing}
              </div>
              <div className="flex items-center gap-2.5 text-[14px]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                {details.travelContact}
              </div>
              <div className="flex items-center gap-2.5 text-[14px]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                {details.photos}
              </div>
            </div>
            {discovery.location.trim() && (
              <span className="self-start px-3.5 py-1.5 rounded-full bg-mint text-[13px] font-medium">
                {t.discover.serving(discovery.location)}
              </span>
            )}
            <div className="flex flex-col gap-1.5 pt-2 border-t border-border">
              <label htmlFor="whatsapp" className="text-[13px] font-medium">
                {t.discover.whatsappLabel}
              </label>
              <input
                id="whatsapp"
                className="input"
                placeholder={t.discover.whatsappPlaceholder}
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <button type="button" className="btn-primary w-[280px] h-[48px]" onClick={submitProposal} disabled={isPending}>
            {isPending ? t.common.buildingPage : t.discover.continueToPage}
          </button>
        </div>
      )}
    </div>
  );
}
