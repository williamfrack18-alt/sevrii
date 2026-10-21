"use client";

// The project's card inside its own chat (Cerebro, Store and Marketing all
// use it the same way): always the last thing in the conversation, showing
// where this project stands right now, with a link to the full view that sits
// right under the chat (the map, or the page).
export default function ProjectDock({
  eyebrow,
  title,
  status,
  children,
  link,
}: {
  eyebrow: string;
  title: string;
  status?: React.ReactNode;
  children?: React.ReactNode;
  link?: { label: string; href: string };
}) {
  return (
    <div className="rounded-2xl p-4 md:p-5 flex flex-col gap-3.5 min-w-0" style={{ background: "#141414", boxShadow: "0 0 0 1px rgba(255,255,255,0.08)" }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8e8e8e] shrink-0">{eyebrow}</span>
          {status}
        </div>
        {link && (
          <a href={link.href} className="text-[12.5px] text-[#a1a1a1] hover:text-white shrink-0">
            {link.label}
          </a>
        )}
      </div>
      <span className="text-[17px] font-semibold text-white break-words leading-snug">{title}</span>
      {children}
    </div>
  );
}

// The full view under the chat: visibly part of the same conversation.
export function BelowChat({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <section id={id} className="px-4 md:px-8 pb-14 scroll-mt-4">
      <div className="flex flex-col items-center pt-1 pb-6" aria-hidden="true">
        <span className="h-6 w-px" style={{ background: "rgba(255,255,255,0.16)" }} />
      </div>
      <div className="max-w-[1100px] mx-auto flex flex-col gap-5 min-w-0">
        <div className="flex justify-center">
          <span className="text-[12px] px-3 py-1 rounded-full text-[#a1a1a1]" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}>
            {label}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}
