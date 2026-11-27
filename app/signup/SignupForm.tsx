"use client";

import { useActionState } from "react";
import { signupAction, type FormState } from "@/app/actions";
import SubmitButton from "@/components/SubmitButton";
import { useLang, useT } from "@/components/LangProvider";

export default function SignupForm() {
  const [state, formAction] = useActionState<FormState, FormData>(signupAction, null);
  const t = useT();
  const en = useLang() === "en";
  const base = en ? "/en" : "";

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="text-[13px] font-medium text-ink">
          {t.auth.email}
        </label>
        <input id="signup-email" name="email" type="email" autoComplete="off" data-1p-ignore data-lpignore="true" placeholder={t.auth.emailPlaceholder} className="input" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className="text-[13px] font-medium text-ink">
          {t.auth.password}
        </label>
        <input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder={t.auth.passwordPlaceholder}
          className="input"
          minLength={8}
          required
        />
      </div>
      {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      <SubmitButton>{t.auth.signupButton}</SubmitButton>
      <p className="text-center text-[12px] leading-relaxed text-muted">
        {en ? "By creating your account you agree to Sevrii’s " : "Al crear tu cuenta aceptas los "}
        <a href={`${base}/terminos`} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">
          {en ? "Terms of Service" : "Términos y Condiciones"}
        </a>
        {en ? " and " : " y la "}
        <a href={`${base}/privacidad`} target="_blank" rel="noopener" className="underline underline-offset-2 hover:text-ink">
          {en ? "Privacy Policy" : "Política de privacidad"}
        </a>
        {en ? "." : " de Sevrii."}
      </p>
    </form>
  );
}
