"use client";

import { useActionState } from "react";
import { resetPasswordAction, type ResetState } from "@/app/accountActions";
import SubmitButton from "@/components/SubmitButton";
import { useLang } from "@/components/LangProvider";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";

export default function ResetForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<ResetState, FormData>(resetPasswordAction, null);
  const a = ACCOUNT_TEXT[useLang()];
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] font-medium text-ink">
          {a.newPassword}
        </label>
        <input id="password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" className="input" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm" className="text-[13px] font-medium text-ink">
          {a.confirmPassword}
        </label>
        <input id="confirm" name="confirm" type="password" minLength={8} maxLength={128} autoComplete="new-password" className="input" required />
      </div>
      {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      <SubmitButton>{a.resetButton}</SubmitButton>
    </form>
  );
}
