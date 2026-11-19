"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { customerSignOutAction } from "@/app/reviewActions";

// "Paying as Ana · Not you?": the quick account in use, and a way to change it.
export default function PayWho({ name, email, lang }: { name: string; email: string; lang: "es" | "en" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <p className="pay-who">
      {lang === "en" ? "Paying as" : "Pagas como"} <strong>{name || email}</strong> ({email}) ·{" "}
      <button type="button" disabled={pending} onClick={() => start(async () => { await customerSignOutAction(); router.refresh(); })}>
        {lang === "en" ? "Not you?" : "¿No eres tú?"}
      </button>
    </p>
  );
}
