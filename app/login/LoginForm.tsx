"use client";

import { useFormState } from "react-dom";
import { loginAction, type FormState } from "@/app/actions";
import SubmitButton from "@/components/SubmitButton";

export default function LoginForm() {
  const [state, formAction] = useFormState<FormState, FormData>(loginAction, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] font-medium text-ink">
          Email address
        </label>
        <input id="email" name="email" type="email" placeholder="you@example.com" className="input" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-[13px] font-medium text-ink">
          Password
        </label>
        <input id="password" name="password" type="password" className="input" required />
      </div>
      {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
      <SubmitButton>Log in</SubmitButton>
    </form>
  );
}
