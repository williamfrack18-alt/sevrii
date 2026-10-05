"use client";

import { useT, useLang } from "@/components/LangProvider";
import { PLANS_TEXT } from "@/lib/plansI18n";

// Payments and Capital don't exist yet. This screen explains what each one
// will do and shows an illustrative preview — it never pretends to work.
export default function ComingSoonView({
  pillar,
  onBack,
  onPlans,
}: {
  pillar: "payments" | "capital";
  onBack: () => void;
  onPlans?: () => void;
}) {
  const t = useT();
  const lk = PLANS_TEXT[useLang()].lock;
  const d = t.dashboard;
  const copy = pillar === "payments" ? d.payments : d.capital;
  const n = pillar === "payments" ? "04" : "05";
  const name = pillar === "payments" ? "Payments" : "Capital";

  return (
    <div className="px-5 md:px-10 py-8 md:py-12 max-w-[1180px]">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 lg:gap-16 items-center">
        <div>
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[15px] font-medium" style={{ color: "#3ddc84" }}>
              {n} · {name}
            </span>
            <span className="dash-soon">{d.soon}</span>
          </div>
          <h1 className="font-serif text-[36px] md:text-[48px] leading-[1.05] mb-4">{copy.title}</h1>
          <p className="text-muted text-[16px] leading-relaxed max-w-[520px]">{copy.lead}</p>
          <ul className="mt-8 border-t border-border">
            {copy.points.map(([title, text]) => (
              <li key={title} className="py-4 border-b border-border">
                <div className="text-[16px] font-[450] mb-1">{title}</div>
                <div className="text-[14px] text-muted">{text}</div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4 mt-8">
            <button type="button" onClick={onBack} className="btn-ghost">
              {d.backHome}
            </button>
            <span className="text-[13px] text-mutedLight">{d.notReady}</span>
          </div>
          {pillar === "payments" && onPlans && (
            <button type="button" onClick={onPlans} className="mt-5 text-[13.5px] underline underline-offset-4" style={{ color: "#3ddc84" }}>
              {lk.paymentsPro} {lk.seePlans} →
            </button>
          )}
        </div>

        <div className="soon-stage">
          <span className="soon-preview-tag">{d.preview}</span>
          {pillar === "payments" ? (
            <div className="soon-mock">
              <div className="soon-toast">
                <b>✓</b>
                {d.payments.mockReceived}
              </div>
              <div className="soon-card">
                <div className="lbl">{d.payments.mockLabel}</div>
                <div className="svc">{d.payments.mockService}</div>
                <div className="amt">$120.00</div>
                <div className="pay">{d.payments.mockPay}</div>
                <div className="url">sevrii.com/pay</div>
              </div>
            </div>
          ) : (
            <div className="soon-mock">
              <div className="soon-card wide">
                <div className="lbl">{d.capital.mockLabel}</div>
                <div className="svc">{d.capital.mockTitle}</div>
                <div className="bars">
                  {[30, 42, 38, 55, 70, 92].map((h, i) => (
                    <span key={i} className={i === 5 ? "on" : ""} style={{ height: `${h}%` }} />
                  ))}
                </div>
                <div className="offer">
                  {d.capital.mockOffer}
                  <em>{d.soon}</em>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
