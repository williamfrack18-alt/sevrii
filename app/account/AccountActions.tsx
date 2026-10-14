"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteAccountAction, sendMyResetLinkAction, type DeleteState } from "@/app/accountActions";
import { useLang } from "@/components/LangProvider";
import { ACCOUNT_TEXT } from "@/lib/accountI18n";

function DeleteButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full px-5 py-3 text-[15px] font-semibold disabled:opacity-60"
      style={{ background: "#b42318", color: "#fff" }}
    >
      {pending ? busy : label}
    </button>
  );
}

export function AccountActions({ hasPassword }: { hasPassword: boolean }) {
  const a = ACCOUNT_TEXT[useLang()];
  const [state, formAction] = useActionState<DeleteState, FormData>(deleteAccountAction, null);
  const [linkMsg, setLinkMsg] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendLink() {
    setSending(true);
    setLinkMsg(null);
    try {
      const res = await sendMyResetLinkAction();
      setLinkMsg(res.ok ? a.linkSent : res.error || a.errGeneric);
    } catch {
      setLinkMsg(a.errGeneric);
    }
    setSending(false);
  }

  return (
    <>
      <div className="card p-5 mb-6">
        <div className="text-[16px] font-[500] mb-1">{a.changePassword}</div>
        <p className="text-[14px] text-muted mb-4">{a.changePasswordText}</p>
        <button type="button" onClick={sendLink} disabled={sending} className="btn-ghost">
          {a.sendLink}
        </button>
        {linkMsg && <p className="mt-3 text-[13.5px] text-muted">{linkMsg}</p>}
      </div>

      <div className="rounded-2xl p-5" style={{ border: "1px solid rgba(248,113,113,.35)", background: "rgba(248,113,113,.05)" }}>
        <div className="text-[16px] font-[500] mb-2" style={{ color: "#f87171" }}>
          {a.deleteTitle}
        </div>
        <p className="text-[14px] text-muted leading-relaxed mb-2">{a.deleteText}</p>
        <p className="text-[13px] text-mutedLight leading-relaxed mb-5">{a.deletePayments}</p>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-[13px] font-medium">
              {a.deleteConfirmLabel(a.deleteWord)}
            </label>
            <input id="confirm" name="confirm" className="input" autoComplete="off" required />
          </div>
          {hasPassword && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-[13px] font-medium">
                {a.deletePassword}
              </label>
              <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
            </div>
          )}
          {state?.error && <p className="text-[13px] text-red-600">{state.error}</p>}
          <DeleteButton label={a.deleteButton} busy={a.deleting} />
        </form>
      </div>
    </>
  );
}
