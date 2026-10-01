"use client";

import { useFormStatus } from "react-dom";
import { useT } from "./LangProvider";

export default function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? t.common.wait : children}
    </button>
  );
}
