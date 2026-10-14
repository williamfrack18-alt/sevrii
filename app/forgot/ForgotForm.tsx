"use client";

import { useActionState } from "react";
import { forgotPasswordAction, type ForgotState } from "@/app/accountActions";
import SubmitButton from "@/components/SubmitButton";
import { useLang, useT } from "@/components/LangProvider";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";

export default function ForgotForm() {
  const [state, formAction] = useActionState<ForgotState, FormData>(forgotPasswordAction, null);
  const t = useT();
  const a = ACCOUNT_TEXT[useLang()];

  if (state?.sent) {
    return <p className="text-[15px] leading-relaxed rounded-2xl border border-border p-4">{a.forgotSent}</p>;
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] font-medium text-ink">
          {t.auth.email}
        </label>
        <input id="email" name="email" type="email" placeholder={t.auth.emailPlaceholder} className="input" required />
      </div>
      {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      <SubmitButton>{a.forgotButton}</SubmitButton>
    </form>
  );
}
