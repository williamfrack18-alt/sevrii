"use client";

import { useFormState } from "react-dom";
import { signupAction, type FormState } from "@/app/actions";
import SubmitButton from "@/components/SubmitButton";
import { useT } from "@/components/LangProvider";

export default function SignupForm() {
  const [state, formAction] = useFormState<FormState, FormData>(signupAction, null);
  const t = useT();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] font-medium text-ink">
          {t.auth.email}
        </label>
        <input id="email" name="email" type="email" placeholder={t.auth.emailPlaceholder} className="input" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] font-medium text-ink">
          {t.auth.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          placeholder={t.auth.passwordPlaceholder}
          className="input"
          minLength={8}
          required
        />
      </div>
      {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      <SubmitButton>{t.auth.signupButton}</SubmitButton>
    </form>
  );
}
