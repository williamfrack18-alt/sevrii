"use client";

// "Editar mi página": pieces that only exist when the owner opens their page
// in edit mode (?editar=1). Visitors never get any of this: page.tsx only
// renders these components for the signed-in owner in edit mode.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveSectionAction, saveSiteTextAction, setDesignAction, toggleSectionAction, type EditField } from "@/app/siteEditActions";
import type { PageDesign, PageSection } from "@/lib/site";

type Ui = "es" | "en";
type Status = "idle" | "saving" | "saved" | "error";

const TXT = {
  es: {
    title: "Editando tu página",
    help: "Toca cualquier texto para cambiarlo. Usa las flechas para mover secciones y «Ocultar» para quitar una.",
    design: "Diseño",
    designs: { classic: "Clásico", hero: "Portada grande", simple: "Solo texto" } as Record<PageDesign, string>,
    done: "Listo",
    saving: "Guardando…",
    saved: "Guardado ✓",
    error: "No se pudo guardar. Revisa el texto e inténtalo otra vez.",
    up: "Subir",
    down: "Bajar",
    hide: "Ocultar",
    show: "Mostrar",
    hiddenTag: "Oculta: no se ve en tu página",
    sections: { trust: "Datos de confianza", offerBand: "Oferta", services: "Servicios", photos: "Fotos", steps: "Cómo trabajo", faq: "Preguntas frecuentes", cta: "Cierre" } as Record<PageSection, string>,
  },
  en: {
    title: "Editing your page",
    help: "Tap any text to change it. Use the arrows to move sections and “Hide” to remove one.",
    design: "Design",
    designs: { classic: "Classic", hero: "Big cover", simple: "Text only" } as Record<PageDesign, string>,
    done: "Done",
    saving: "Saving…",
    saved: "Saved ✓",
    error: "Couldn't save. Check the text and try again.",
    up: "Move up",
    down: "Move down",
    hide: "Hide",
    show: "Show",
    hiddenTag: "Hidden: not shown on your page",
    sections: { trust: "Trust facts", offerBand: "Offer", services: "Services", photos: "Photos", steps: "How I work", faq: "FAQ", cta: "Closing" } as Record<PageSection, string>,
  },
};

const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function report(state: Status) {
  window.dispatchEvent(new CustomEvent("mt-edit-status", { detail: state }));
}

// A text you can change right where it is. Saves when you leave it.
export function Ed({
  slug,
  field,
  value,
  index,
  sub,
  id,
  multiline = false,
  ph,
}: {
  slug: string;
  field: EditField;
  value: string;
  index?: number;
  sub?: string;
  id?: string;
  multiline?: boolean;
  ph?: string;
}) {
  const router = useRouter();
  const ref = useRef<HTMLSpanElement>(null);
  const saved = useRef(value);
  useEffect(() => {
    saved.current = value;
  }, [value]);

  async function save() {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText.replace(/ /g, " ").trim();
    if (text === saved.current) return;
    report("saving");
    try {
      const res = await saveSiteTextAction(slug, field, text, { index, sub, id });
      if (res.ok) {
        saved.current = text;
        report("saved");
        router.refresh();
      } else {
        el.innerText = saved.current;
        report("error");
      }
    } catch {
      el.innerText = saved.current;
      report("error");
    }
  }

  return (
    <span
      ref={ref}
      className="mt-ed"
      data-ph={ph || ""}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline={multiline}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
        if (e.key === "Escape") {
          if (ref.current) ref.current.innerText = saved.current;
          (e.target as HTMLElement).blur();
        }
      }}
      dangerouslySetInnerHTML={{ __html: esc(value) }}
      onPaste={(e) => {
        // Plain text only: no fonts or colors pasted from elsewhere.
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " ");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}

// The bar on top of the page in edit mode: the three designs and "Done".
export function EditBar({ slug, design, ui, exitHref }: { slug: string; design: PageDesign; ui: Ui; exitHref: string }) {
  const t = TXT[ui];
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [pending, start] = useTransition();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const s = (e as CustomEvent<Status>).detail;
      setStatus(s);
      if (timer) clearTimeout(timer);
      if (s === "saved") timer = setTimeout(() => setStatus("idle"), 2200);
    };
    window.addEventListener("mt-edit-status", on);
    return () => {
      window.removeEventListener("mt-edit-status", on);
      if (timer) clearTimeout(timer);
    };
  }, []);

  function pick(d: PageDesign) {
    if (d === design) return;
    report("saving");
    start(async () => {
      const r = await setDesignAction(slug, d);
      report(r.ok ? "saved" : "error");
      router.refresh();
    });
  }
  function exit() {
    if (window.parent !== window) window.parent.postMessage({ type: "sevrii-edit-done" }, window.location.origin);
    else window.location.href = exitHref;
  }

  return (
    <div className="mt-editbar" role="region" aria-label={t.title}>
      <div className="mt-editbar-row">
        <strong>{t.title}</strong>
        <span className={`mt-editbar-status ${status}`} role="status" aria-live="polite">
          {status === "saving" ? t.saving : status === "saved" ? t.saved : status === "error" ? t.error : ""}
        </span>
        <button type="button" className="mt-editbar-done" onClick={exit}>
          {t.done}
        </button>
      </div>
      <div className="mt-editbar-row mt-editbar-designs">
        <span>{t.design}:</span>
        {(Object.keys(t.designs) as PageDesign[]).map((d) => (
          <button key={d} type="button" disabled={pending} aria-pressed={d === design} className={d === design ? "on" : ""} onClick={() => pick(d)}>
            {t.designs[d]}
          </button>
        ))}
      </div>
      <p className="mt-editbar-help">{t.help}</p>
    </div>
  );
}

// Above each section in edit mode: move it, hide it, show it again.
export function SectionTools({ slug, section, peers, hidden, ui }: { slug: string; section: PageSection; peers: PageSection[]; hidden: boolean; ui: Ui }) {
  const t = TXT[ui];
  const router = useRouter();
  const [pending, start] = useTransition();
  const at = peers.indexOf(section);
  function run(fn: () => Promise<{ ok: boolean }>) {
    report("saving");
    start(async () => {
      const r = await fn().catch(() => ({ ok: false }));
      report(r.ok ? "saved" : "error");
      router.refresh();
    });
  }
  return (
    <div className="mt-sectools wrap">
      <span className="mt-sectools-name">
        {t.sections[section]}
        {hidden && <em> · {t.hiddenTag}</em>}
      </span>
      <span className="mt-sectools-btns">
        <button type="button" disabled={pending || at <= 0} onClick={() => run(() => moveSectionAction(slug, section, -1, peers))} aria-label={t.up} title={t.up}>
          ↑
        </button>
        <button type="button" disabled={pending || at < 0 || at >= peers.length - 1} onClick={() => run(() => moveSectionAction(slug, section, 1, peers))} aria-label={t.down} title={t.down}>
          ↓
        </button>
        <button type="button" disabled={pending} onClick={() => run(() => toggleSectionAction(slug, section, !hidden))}>
          {hidden ? t.show : t.hide}
        </button>
      </span>
    </div>
  );
}
