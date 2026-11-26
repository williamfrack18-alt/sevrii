"use client";

import { useT, useLang } from "@/components/LangProvider";
import { PLANS_TEXT } from "@/lib/plansI18n";

// Payments and Capital don't exist yet. This screen explains what each one
// will do and shows an illustrative preview — it never pretends to work.
export const PAY_PHOTO = "https://images.unsplash.com/photo-1687422808248-f807f4ea2a2e?auto=format&fit=crop&w=1240&q=70";
export const CAPITAL_PHOTO = "https://images.unsplash.com/photo-1687422811062-a966b55cb217?auto=format&fit=crop&w=1240&q=70";

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
  // Same numbers and pictures as the landing (sevrii.com/ofrecerservicios).
  const n = pillar === "payments" ? "03" : "04";
  const photo = pillar === "payments" ? PAY_PHOTO : CAPITAL_PHOTO;
  const name = pillar === "payments" ? "Payments" : "Capital";

  return (
    <div className="px-4 md:px-10 pt-6 md:pt-12 pb-8 md:pb-12 max-w-[1180px]">
      <div className="glow-card p-5 md:p-10 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-10 lg:gap-14 items-center">
        <div className="min-w-0 lg:order-2">
          <div className="glow-n mb-5">
            {n} · {name}
            <span className="glow-tag">{d.soon}</span>
          </div>
          <h1 className="glow-h mb-4">{copy.title}</h1>
          <p className="glow-lead">{copy.lead}</p>
          <ul className="glow-points mt-8">
            {copy.points.map(([title, text]) => (
              <li key={title}>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          {pillar === "capital" && (
            <div className="glow-box mt-8 p-5 flex flex-col gap-3">
              <div className="text-[15px] font-[450]">{es ? "Qué te falta para activarlo" : "What you need to unlock it"}</div>
              {[
                [payReady, es ? "Activa Payments para cobrar con tarjeta desde Sevrii" : "Turn on Payments to get paid by card through Sevrii"],
                [false, es ? "Cobra con Sevrii Payments durante al menos 3 meses" : "Get paid with Sevrii Payments for at least 3 months"],
                [false, es ? "Te avisamos cuando el socio financiero abra las solicitudes" : "We'll let you know when the financial partner opens applications"],
              ].map(([done, text], i) => (
                <div key={i} className="flex items-start gap-3 text-[14px]">
                  <span className="h-5 w-5 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold mt-[1px]" style={done ? { background: "#3ddc84", color: "#04150c" } : { boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.35)", color: "rgba(255,255,255,.75)" }}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span style={{ color: done ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.85)" }} className={done ? "line-through" : ""}>{text as string}</span>
                </div>
              ))}
              {!payReady && onPayments && (
                <button type="button" onClick={onPayments} className="glow-link self-start mt-1 text-[13.5px] font-semibold">
                  {es ? "Ir a Payments →" : "Go to Payments →"}
                </button>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 mt-8">
            <button type="button" onClick={onBack} className="glow-btn">
              {d.backHome}
            </button>
            <span className="text-[13px]" style={{ color: "rgba(255,255,255,.5)" }}>{d.notReady}</span>
          </div>
          {pillar === "payments" && onPlans && (
            <button type="button" onClick={onPlans} className="glow-link mt-5 text-[13.5px]">
              {lk.paymentsPro} {lk.seePlans} →
            </button>
          )}
        </div>

        <div className="soon-stage photo min-h-[420px] lg:min-h-[560px] lg:order-1" style={{ backgroundImage: `url(${photo})` }}>
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
