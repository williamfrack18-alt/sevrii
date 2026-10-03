"use client";

import { useState, useTransition } from "react";
import { reportPageAction } from "@/app/actions";
import { STORE_TEXT } from "@/lib/storeI18n";

export default function ReportForm({ slug, lang }: { slug: string; lang: "es" | "en" }) {
  const t = STORE_TEXT[lang].report;
  const [reason, setReason] = useState("fraud");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "done" | "rate">("idle");
  const [pending, start] = useTransition();

  if (state === "done") return <p className="text-[15px]">{t.thanks}</p>;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await reportPageAction(slug, reason, details);
          setState(res.ok ? "done" : res.error === "rate" ? "rate" : "idle");
        });
      }}
    >
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">
        {t.reason}
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 rounded-lg border border-[#d9d9d9] px-3 text-[15px]">
          {Object.entries(t.reasons).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[14px] font-medium">
        {t.details}
        <textarea value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} className="min-h-[120px] rounded-lg border border-[#d9d9d9] p-3 text-[15px]" />
      </label>
      {state === "rate" && <p className="text-[14px] text-[#b42318]">{t.tooMany}</p>}
      <button type="submit" disabled={pending} className="h-11 rounded-full bg-[#111] text-white text-[15px] font-semibold disabled:opacity-60">
        {t.send}
      </button>
    </form>
  );
}
