"use client";

import { useT, useLang } from "@/components/LangProvider";
import { PLANS_TEXT } from "@/lib/plansI18n";
import { ACCENT } from "@/lib/panel";

// Payments and Capital don't exist yet. This screen explains what each one
// will do and shows an illustrative preview — it never pretends to work.
export default function ComingSoonView({
  pillar,
  onBack,
  onPlans,
  payReady,
  onPayments,
}: {
  pillar: "payments" | "capital";
  onBack: () => void;
  onPlans?: () => void;
  // Capital: where this business stands on the way to it.
  payReady?: boolean;
  onPayments?: () => void;
}) {
  const es = useLang() === "es";
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
            <span className="text-[15px] font-medium" style={{ color: ACCENT }}>
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
          {pillar === "capital" && (
            <div className="mt-8 rounded-2xl p-5 flex flex-col gap-3" style={{ background: "#FFFFFF", boxShadow: "0 0 0 1px rgba(10,10,10,.08)" }}>
              <div className="text-[15px] font-[450]">{es ? "Qué te falta para activarlo" : "What you need to unlock it"}</div>
              {[
                [payReady, es ? "Activa Payments para cobrar con tarjeta desde Sevrii" : "Turn on Payments to get paid by card through Sevrii"],
                [false, es ? "Cobra con Sevrii Payments durante al menos 3 meses" : "Get paid with Sevrii Payments for at least 3 months"],
                [false, es ? "Te avisamos cuando el socio financiero abra las solicitudes" : "We'll let you know when the financial partner opens applications"],
              ].map(([done, text], i) => (
                <div key={i} className="flex items-start gap-3 text-[14px]">
                  <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-[1px]" style={done ? { background: ACCENT, color: "#fff" } : { boxShadow: "inset 0 0 0 1.5px rgba(10,10,10,.25)", color: "#52525B" }}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span className={done ? "text-muted line-through" : ""}>{text as string}</span>
                </div>
              ))}
              {!payReady && onPayments && (
                <button type="button" onClick={onPayments} className="self-start mt-1 text-[13.5px] font-semibold underline underline-offset-4" style={{ color: ACCENT }}>
                  {es ? "Ir a Payments →" : "Go to Payments →"}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 mt-8">
            <button type="button" onClick={onBack} className="btn-ghost">
              {d.backHome}
            </button>
            <span className="text-[13px] text-mutedLight">{d.notReady}</span>
          </div>
          {pillar === "payments" && onPlans && (
            <button type="button" onClick={onPlans} className="mt-5 text-[13.5px] underline underline-offset-4" style={{ color: ACCENT }}>
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
