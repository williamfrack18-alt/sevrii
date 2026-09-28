"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PathPicker() {
  const [selected, setSelected] = useState<"existing" | "new" | null>(null);
  const router = useRouter();

  function cardStyle(active: boolean) {
    return `text-left rounded-2xl p-8 flex flex-col gap-4 border-2 transition ${
      active ? "border-ink bg-mint" : "border-border bg-white hover:border-borderStrong"
    }`;
  }

  return (
    <div className="flex flex-col items-center gap-7">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-[820px]">
        <button type="button" onClick={() => setSelected("existing")} className={cardStyle(selected === "existing")}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="13" rx="2" />
            <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M3 12h18" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[18px] font-semibold">I already offer a service</h3>
            <p className="text-[14px] text-muted leading-relaxed">
              I have an active business and want to present it better to get more customers.
            </p>
          </div>
        </button>
        <button type="button" onClick={() => setSelected("new")} className={cardStyle(selected === "new")}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#122118" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18h6M10 21h4" />
            <path d="M12 3a6 6 0 0 0-4 10.4c.6.55 1 1.36 1 2.2v.4h6v-.4c0-.84.4-1.65 1-2.2A6 6 0 0 0 12 3z" />
          </svg>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[18px] font-semibold">I want to offer one, but I&rsquo;m not sure what</h3>
            <p className="text-[14px] text-muted leading-relaxed">
              Help me figure out, based on my background, a good and profitable service to offer.
            </p>
          </div>
        </button>
      </div>

      <p className="text-[13px] text-mutedLight italic">The next step is put together by Sevri AI based on what you choose here.</p>

      <button
        type="button"
        disabled={!selected}
        onClick={() => router.push(selected === "existing" ? "/onboarding" : "/discover")}
        className={`w-[220px] h-[48px] rounded-[10px] text-[15px] font-semibold ${
          selected ? "btn-primary" : "bg-borderStrong text-mutedLight cursor-not-allowed"
        }`}
      >
        Continue
      </button>
    </div>
  );
}
