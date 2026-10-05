"use client";

import { useState, useTransition } from "react";
import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { formatPhone, isLicensedTrade, LIMITS } from "@/lib/site";
import {
  saveStoreAction,
  saveServiceAction,
  deleteServiceAction,
  uploadStoreImageAction,
  removeStoreImageAction,
  type StoreFormInput,
} from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";
import { ACCENT } from "@/lib/brand";

type Props = {
  business: ClientBusiness;
  services: ClientService[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
};

function initialForm(b: ClientBusiness): StoreFormInput {
  const s = b.site;
  return {
    name: b.name,
    headline: s.headline,
    pitch: b.pitch,
    category: b.category,
    city: b.city ?? "",
    serviceArea: s.serviceArea,
    hours: s.hours,
    phone: s.phone ? formatPhone(s.phone) : "",
    textEnabled: s.textEnabled,
    whatsapp: b.whatsapp ?? "",
    licenseNumber: s.licenseNumber,
    licenseState: s.licenseState,
    noLicenseNeeded: s.noLicenseNeeded,
    insured: s.insured,
    spanish: s.spanish,
    yearsInBusiness: s.yearsInBusiness ? String(s.yearsInBusiness) : "",
    googleReviewsUrl: s.googleReviewsUrl,
    highlights: s.highlights,
    faq: s.faq,
    accentColor: b.accentColor,
    lang: s.lang,
  };
}

export default function StoreEditor({ business, services, onUpdated }: Props) {
  const t = STORE_TEXT[useLang()].editor;
  const [form, setForm] = useState<StoreFormInput>(() => initialForm(business));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [saving, startSave] = useTransition();
  const licensed = isLicensedTrade(form.category);

  function set<K extends keyof StoreFormInput>(key: K, value: StoreFormInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus("idle");
  }

  function save() {
    startSave(async () => {
      const res = await saveStoreAction(form);
      if (!res.ok) {
        setStatus("error");
        setError(res.error === "phone" || res.error === "whatsapp" ? t.invalidPhone : t.saveFailed);
        return;
      }
      const cb = toClientBusiness(res.business);
      setForm(initialForm(cb));
      onUpdated(cb, res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description })));
      setStatus("saved");
    });
  }

  const label = "block text-[12.5px] font-medium text-muted mb-1.5";
  const check = "flex items-start gap-2.5 text-[14px] text-ink cursor-pointer";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-mutedLight">{t.honestyNote}</p>

      <Section title={t.sections.basics}>
        <Field label={t.fields.name} cls={label}>
          <input className="input" value={form.name} maxLength={LIMITS.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label={t.fields.headline} cls={label}>
          <input className="input" value={form.headline} maxLength={LIMITS.headline} placeholder={t.fields.headlinePh} onChange={(e) => set("headline", e.target.value)} />
        </Field>
        <Field label={t.fields.pitch} cls={label} wide>
          <textarea className="input !h-auto py-3 min-h-[96px]" value={form.pitch} maxLength={LIMITS.pitch} onChange={(e) => set("pitch", e.target.value)} />
        </Field>
        <Field label={t.fields.category} cls={label}>
          <input className="input" value={form.category} maxLength={60} onChange={(e) => set("category", e.target.value)} />
        </Field>
        <Field label={t.fields.city} cls={label}>
          <input className="input" value={form.city} maxLength={80} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label={t.fields.serviceArea} cls={label}>
          <input className="input" value={form.serviceArea} maxLength={LIMITS.serviceArea} placeholder={t.fields.serviceAreaPh} onChange={(e) => set("serviceArea", e.target.value)} />
        </Field>
        <Field label={t.fields.hours} cls={label}>
          <textarea className="input !h-auto py-2.5 min-h-[70px]" rows={2} value={form.hours} maxLength={LIMITS.hours} placeholder={t.fields.hoursPh} onChange={(e) => set("hours", e.target.value)} />
        </Field>
      </Section>

      <Section title={t.sections.contact}>
        <Field label={t.fields.phone} cls={label}>
          <input className="input" type="tel" inputMode="tel" value={form.phone} placeholder={t.fields.phonePh} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label={t.fields.whatsapp} cls={label}>
          <input className="input" type="tel" inputMode="tel" value={form.whatsapp} placeholder="+1 (305) 555-0123" onChange={(e) => set("whatsapp", e.target.value)} />
        </Field>
        <label className={`${check} md:col-span-2`}>
          <input type="checkbox" className="mt-1" checked={form.textEnabled} onChange={(e) => set("textEnabled", e.target.checked)} />
          {t.fields.textEnabled}
        </label>
      </Section>

      <Section title={t.sections.trust}>
        <Field label={t.fields.licenseNumber} cls={label}>
          <input className="input" value={form.licenseNumber} maxLength={LIMITS.license} onChange={(e) => set("licenseNumber", e.target.value)} />
        </Field>
        <Field label={t.fields.licenseState} cls={label}>
          <input className="input" value={form.licenseState} maxLength={LIMITS.state} placeholder="FL, TX, CA…" onChange={(e) => set("licenseState", e.target.value)} />
        </Field>
        {licensed && (
          <>
            <p className="text-[12.5px] text-mutedLight md:col-span-2">{t.fields.licenseNote}</p>
            <label className={`${check} md:col-span-2`}>
              <input type="checkbox" className="mt-1" checked={form.noLicenseNeeded} onChange={(e) => set("noLicenseNeeded", e.target.checked)} />
              {t.fields.noLicenseNeeded}
            </label>
          </>
        )}
        <Field label={t.fields.years} cls={label}>
          <input className="input" inputMode="numeric" value={form.yearsInBusiness} maxLength={2} onChange={(e) => set("yearsInBusiness", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label={t.fields.googleReviewsUrl} cls={label}>
          <input className="input" value={form.googleReviewsUrl} placeholder={t.fields.googleReviewsPh} onChange={(e) => set("googleReviewsUrl", e.target.value)} />
        </Field>
        <label className={check}>
          <input type="checkbox" className="mt-1" checked={form.insured} onChange={(e) => set("insured", e.target.checked)} />
          {t.fields.insured}
        </label>
        <label className={check}>
          <input type="checkbox" className="mt-1" checked={form.spanish} onChange={(e) => set("spanish", e.target.checked)} />
          {t.fields.spanish}
        </label>
      </Section>

      <Section title={t.sections.highlights}>
        <ListEditor
          items={form.highlights}
          max={LIMITS.highlights}
          addLabel={t.add}
          removeLabel={t.remove}
          render={(value, onChange) => <input className="input" value={value} maxLength={LIMITS.highlight} placeholder={t.fields.highlight} onChange={(e) => onChange(e.target.value)} />}
          blank=""
          onChange={(v) => set("highlights", v)}
        />
      </Section>

      <Section title={t.sections.faq}>
        <ListEditor
          items={form.faq}
          max={LIMITS.faq}
          addLabel={t.add}
          removeLabel={t.remove}
          blank={{ q: "", a: "" }}
          render={(value, onChange) => (
            <div className="flex flex-col gap-2 w-full">
              <input className="input" value={value.q} maxLength={LIMITS.faqQ} placeholder={t.fields.faqQ} onChange={(e) => onChange({ ...value, q: e.target.value })} />
              <textarea className="input !h-auto py-2.5 min-h-[70px]" value={value.a} maxLength={LIMITS.faqA} placeholder={t.fields.faqA} onChange={(e) => onChange({ ...value, a: e.target.value })} />
            </div>
          )}
          onChange={(v) => set("faq", v)}
        />
      </Section>

      <Section title={t.sections.look}>
        <Field label={t.fields.accent} cls={label}>
          <div className="flex items-center gap-3">
            <input type="color" value={form.accentColor} onChange={(e) => set("accentColor", e.target.value)} className="h-[46px] w-[64px] rounded-[10px] border border-border bg-transparent" />
            <span className="text-[13px] text-muted">{form.accentColor}</span>
          </div>
        </Field>
        <Field label={t.fields.lang} cls={label}>
          <select className="input" value={form.lang} onChange={(e) => set("lang", e.target.value === "es" ? "es" : "en")}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 -mx-1 px-1 py-3 bg-cream flex items-center gap-3 border-t border-border">
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? t.saving : t.save}
        </button>
        {status === "saved" && <span className="text-[13px]" style={{ color: ACCENT }}>✓ {t.saved}</span>}
        {status === "error" && <span className="text-[13px] text-[#ff6b6b]">{error}</span>}
      </div>

      <ServicesEditor services={services} onChange={(s) => onUpdated(business, s)} />
      <PhotosEditor business={business} onChange={(b) => onUpdated(b, services)} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3 className="text-[15px] font-semibold mb-4">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  );
}

function Field({ label, cls, wide, children }: { label: string; cls: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <span className={cls}>{label}</span>
      {children}
    </div>
  );
}

function ListEditor<T>({
  items,
  max,
  blank,
  addLabel,
  removeLabel,
  render,
  onChange,
}: {
  items: T[];
  max: number;
  blank: T;
  addLabel: string;
  removeLabel: string;
  render: (value: T, onChange: (v: T) => void) => React.ReactNode;
  onChange: (items: T[]) => void;
}) {
  return (
    <div className="md:col-span-2 flex flex-col gap-3">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {render(item, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
          <button type="button" className="dash-chip shrink-0 mt-2" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            {removeLabel}
          </button>
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="dash-chip w-fit" onClick={() => onChange([...items, blank])}>
          + {addLabel}
        </button>
      )}
    </div>
  );
}

function ServicesEditor({ services, onChange }: { services: ClientService[]; onChange: (s: ClientService[]) => void }) {
  const t = STORE_TEXT[useLang()].editor;
  const [draft, setDraft] = useState({ name: "", price: "", description: "" });
  const [pending, start] = useTransition();
  const map = (rows: { id: string; name: string; price: string | null; description: string | null }[]) =>
    rows.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }));

  return (
    <div className="card">
      <h3 className="text-[15px] font-semibold mb-4">{t.sections.services}</h3>
      <div className="flex flex-col gap-3">
        {services.map((s) => (
          <ServiceRow
            key={s.id}
            service={s}
            disabled={pending}
            onSave={(v) => start(async () => onChange(map(await saveServiceAction({ id: s.id, ...v }))))}
            onDelete={() => {
              if (!window.confirm(t.deleteConfirm)) return;
              start(async () => onChange(map(await deleteServiceAction(s.id))));
            }}
          />
        ))}
        <div className="grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr] gap-2 pt-3 border-t border-border">
          <input className="input" placeholder={t.fields.serviceName} value={draft.name} maxLength={LIMITS.serviceName} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input" placeholder={t.fields.servicePricePh} value={draft.price} maxLength={LIMITS.servicePrice} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <input className="input md:col-span-2" placeholder={t.fields.serviceDescription} value={draft.description} maxLength={LIMITS.serviceDescription} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <button
            type="button"
            className="btn-ghost w-fit"
            disabled={pending || !draft.name.trim()}
            onClick={() =>
              start(async () => {
                onChange(map(await saveServiceAction(draft)));
                setDraft({ name: "", price: "", description: "" });
              })
            }
          >
            + {t.addService}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceRow({
  service,
  disabled,
  onSave,
  onDelete,
}: {
  service: ClientService;
  disabled: boolean;
  onSave: (v: { name: string; price: string; description: string }) => void;
  onDelete: () => void;
}) {
  const t = STORE_TEXT[useLang()].editor;
  const [v, setV] = useState({ name: service.name, price: service.price ?? "", description: service.description ?? "" });
  const dirty = v.name !== service.name || v.price !== (service.price ?? "") || v.description !== (service.description ?? "");
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1.4fr_0.8fr] gap-2 pb-3 border-b border-border">
      <input className="input" value={v.name} maxLength={LIMITS.serviceName} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input className="input" value={v.price} maxLength={LIMITS.servicePrice} placeholder={t.fields.servicePricePh} onChange={(e) => setV({ ...v, price: e.target.value })} />
      <input className="input md:col-span-2" value={v.description} maxLength={LIMITS.serviceDescription} placeholder={t.fields.serviceDescription} onChange={(e) => setV({ ...v, description: e.target.value })} />
      <div className="flex gap-2">
        {dirty && (
          <button type="button" className="dash-chip" disabled={disabled} onClick={() => onSave(v)}>
            {t.save}
          </button>
        )}
        <button type="button" className="dash-chip" disabled={disabled} onClick={onDelete}>
          {t.remove}
        </button>
      </div>
    </div>
  );
}

function PhotosEditor({ business, onChange }: { business: ClientBusiness; onChange: (b: ClientBusiness) => void }) {
  const t = STORE_TEXT[useLang()].editor.photos;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");

  function upload(kind: "logo" | "cover" | "gallery", file: File | undefined) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return setMsg(t.tooBig);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setMsg(t.badType);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    setMsg("");
    start(async () => {
      const res = await uploadStoreImageAction(fd);
      if (res.ok) onChange(toClientBusiness(res.business));
      else setMsg(t[res.error === "rate" ? "failed" : res.error]);
    });
  }

  function remove(kind: "logo" | "cover" | "gallery", url?: string) {
    start(async () => onChange(toClientBusiness(await removeStoreImageAction(kind, url))));
  }

  const site = business.site;
  const slot = (kind: "logo" | "cover", url: string, title: string) => (
    <div className="flex flex-col gap-2">
      <span className="text-[12.5px] font-medium text-muted">{title}</span>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className={`${kind === "logo" ? "h-20 w-20" : "h-28 w-full"} object-cover rounded-xl border border-border`} />
      ) : null}
      <div className="flex gap-2">
        <UploadButton label={pending ? t.uploading : t.upload} disabled={pending} onFile={(f) => upload(kind, f)} />
        {url && (
          <button type="button" className="dash-chip" onClick={() => remove(kind)}>
            ✕
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="card">
      <h3 className="text-[15px] font-semibold mb-4">{STORE_TEXT[useLang()].editor.sections.photos}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {slot("logo", site.logoUrl, t.logo)}
        {slot("cover", site.coverUrl, t.cover)}
        <div className="md:col-span-2 flex flex-col gap-2">
          <span className="text-[12.5px] font-medium text-muted">{t.gallery}</span>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {site.gallery.map((g) => (
              <div key={g} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={g} alt="" className="w-full aspect-square object-cover rounded-lg border border-border" />
                <button type="button" className="absolute top-1 right-1 dash-chip !h-6 !px-2" onClick={() => remove("gallery", g)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          {site.gallery.length < LIMITS.gallery && (
            <UploadButton label={pending ? t.uploading : t.upload} disabled={pending} onFile={(f) => upload("gallery", f)} />
          )}
        </div>
      </div>
      {msg && <p className="text-[13px] text-[#ff6b6b] mt-3">{msg}</p>}
    </div>
  );
}

function UploadButton({ label, disabled, onFile }: { label: string; disabled: boolean; onFile: (f: File | undefined) => void }) {
  return (
    <label className={`dash-chip w-fit cursor-pointer ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
      {label}
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}
