import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getBusinessBySlug, listServices, incrementPageViews } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { allow, clientIp } from "@/lib/guard";
import { STORE_TEXT } from "@/lib/storeI18n";
import { formatPhone, normalizePhone, readableTextOn, smsHref, telHref, waHref } from "@/lib/site";
import ContactLink from "./ContactLink";

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|slack|discord|telegram|preview|vercel|lighthouse|headless/i;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business || !business.published) return { title: "Sevrii", robots: { index: false } };
  const site = business.site;
  const where = site.serviceArea || business.city || "";
  const title = `${business.name}${business.category ? ` · ${business.category}` : ""}${where ? ` · ${where}` : ""}`;
  const description = (site.headline ? `${site.headline}. ` : "") + business.pitch;
  const image = site.coverUrl || site.logoUrl || undefined;
  return {
    title,
    description: description.slice(0, 300),
    openGraph: { title, description: description.slice(0, 300), images: image ? [image] : undefined, type: "website" },
    twitter: { card: image ? "summary_large_image" : "summary", title, description: description.slice(0, 300) },
  };
}

export default async function PublicBusinessPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  const viewer = await getCurrentUser().catch(() => null);
  const isOwner = viewer?.business?.id === business.id;
  if (!business.published && !isOwner) notFound();

  const site = business.site;
  const t = STORE_TEXT[site.lang].site;
  const services = await listServices(business.id);

  // Count real visitors only: not the owner, not link-preview bots, once per IP per hour.
  if (!isOwner && business.published) {
    try {
      const ua = (await headers()).get("user-agent") || "";
      if (!BOT_UA.test(ua) && (await allow(`view:${await clientIp()}:${business.id}`, 1, 60 * 60))) {
        await incrementPageViews(business.id);
      }
    } catch {
      // Never let analytics failures break the visitor's page.
    }
  }

  const accent = /^#[0-9a-f]{6}$/i.test(business.accentColor) ? business.accentColor : "#122118";
  const onAccent = readableTextOn(accent);
  const phone = site.phone || null;
  const wa = normalizePhone(business.whatsapp);
  const generic = t.msgGeneric(business.name);
  const area = site.serviceArea || business.city || "";

  const trust: string[] = [];
  if (site.licenseNumber) trust.push(`${t.license} #${site.licenseNumber}${site.licenseState ? ` (${site.licenseState})` : ""}`);
  if (site.insured) trust.push(t.insured);
  if (site.yearsInBusiness) trust.push(t.years(site.yearsInBusiness));
  if (site.spanish) trust.push(t.spanish);

  const primaryBtn = "inline-flex items-center justify-center gap-2 h-[52px] px-6 rounded-full text-[16px] font-semibold";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 h-[52px] px-6 rounded-full text-[16px] font-semibold border border-[#d9d9d9] bg-white text-[#111]";

  const contactButtons = (variant: "hero" | "band") => (
    <div className="flex flex-wrap gap-3">
      {phone && (
        <ContactLink href={telHref(phone)} businessId={business.id} channel="call" className={primaryBtn} style={{ background: accent, color: onAccent }}>
          <PhoneIcon /> {t.callNow}
        </ContactLink>
      )}
      {phone && site.textEnabled && (
        <ContactLink href={smsHref(phone, generic)} businessId={business.id} channel="text" className={phone ? ghostBtn : primaryBtn}>
          <TextIcon /> {t.text}
        </ContactLink>
      )}
      {wa && (
        <ContactLink
          href={waHref(wa, generic)}
          businessId={business.id}
          channel="whatsapp"
          external
          className={phone ? ghostBtn : primaryBtn}
          style={phone ? undefined : { background: accent, color: onAccent }}
        >
          <WaIcon /> {t.whatsapp}
        </ContactLink>
      )}
      {!phone && !wa && variant === "hero" && <p className="text-[14px] text-[#6b6b6b]">{t.noContact}</p>}
    </div>
  );

  const requestHref = (svc: string): { href: string; channel: "text" | "whatsapp" | "call"; external?: boolean } | null => {
    const msg = t.msgService(business.name, svc);
    if (wa) return { href: waHref(wa, msg), channel: "whatsapp", external: true };
    if (phone && site.textEnabled) return { href: smsHref(phone, msg), channel: "text" };
    if (phone) return { href: telHref(phone), channel: "call" };
    return null;
  };

  return (
    <div lang={site.lang} className="min-h-screen bg-white text-[#111] font-sans pb-[84px] md:pb-0">
      {!business.published && (
        <div className="bg-[#fff4d6] text-[#5c4400] text-[13px] text-center px-4 py-2.5">{t.draftBanner}</div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-[#eee]">
        <div className="max-w-[1080px] mx-auto px-5 h-[64px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {site.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={site.logoUrl} alt={business.name} className="h-9 w-9 rounded-lg object-cover" />
            ) : (
              <span className="h-9 w-9 rounded-lg flex items-center justify-center text-[13px] font-bold" style={{ background: accent, color: onAccent }}>
                {business.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="font-semibold text-[16px] truncate">{business.name}</span>
          </div>
          {phone ? (
            <ContactLink href={telHref(phone)} businessId={business.id} channel="call" className="hidden sm:inline-flex items-center gap-2 h-10 px-4 rounded-full text-[14px] font-semibold" style={{ background: accent, color: onAccent }}>
              <PhoneIcon /> {formatPhone(phone)}
            </ContactLink>
          ) : null}
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        {site.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={site.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className={site.coverUrl ? "relative bg-gradient-to-r from-black/75 via-black/55 to-black/20 text-white" : "relative"} style={site.coverUrl ? undefined : { background: `linear-gradient(180deg, ${accent}14, #ffffff)` }}>
          <div className="max-w-[1080px] mx-auto px-5 py-14 md:py-24 flex flex-col gap-5">
            <span className={`text-[13px] font-semibold uppercase tracking-wide ${site.coverUrl ? "text-white/80" : "text-[#6b6b6b]"}`}>
              {business.category}
              {area ? ` · ${area}` : ""}
            </span>
            <h1 className="text-[34px] md:text-[52px] font-bold leading-[1.05] tracking-[-0.02em] max-w-[760px]">
              {site.headline || business.name}
            </h1>
            <p className={`text-[17px] md:text-[19px] leading-relaxed max-w-[620px] ${site.coverUrl ? "text-white/90" : "text-[#444]"}`}>{business.pitch}</p>
            {trust.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {trust.map((item) => (
                  <li key={item} className={`text-[13px] font-medium px-3 py-1.5 rounded-full ${site.coverUrl ? "bg-white/15 text-white" : "bg-[#f2f2f2] text-[#333]"}`}>
                    ✓ {item}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2">{contactButtons("hero")}</div>
            {site.googleReviewsUrl && (
              <a href={site.googleReviewsUrl} target="_blank" rel="noopener noreferrer nofollow" className={`text-[14px] underline w-fit ${site.coverUrl ? "text-white/90" : "text-[#333]"}`}>
                ★ {t.googleReviews}
              </a>
            )}
          </div>
        </div>
      </section>

      {/* Services */}
      {services.length > 0 && (
        <section className="max-w-[1080px] mx-auto px-5 py-14">
          <h2 className="text-[28px] md:text-[34px] font-bold tracking-[-0.02em] mb-7">{t.services}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {services.map((s) => {
              const req = requestHref(s.name);
              return (
                <div key={s.id} className="rounded-2xl border border-[#eaeaea] p-5 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-[17px] font-semibold leading-snug">{s.name}</h3>
                    <span className="text-[15px] font-semibold whitespace-nowrap">{s.price || t.priceOnRequest}</span>
                  </div>
                  {s.description && <p className="text-[14.5px] text-[#555] leading-relaxed">{s.description}</p>}
                  {req && (
                    <ContactLink href={req.href} businessId={business.id} channel={req.channel} external={req.external} className="mt-auto pt-2 text-[14.5px] font-semibold w-fit" style={{ color: accent === "#ffffff" ? "#111" : accent }}>
                      {t.requestService} →
                    </ContactLink>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Why us */}
      {site.highlights.length > 0 && (
        <section className="bg-[#fafafa] border-y border-[#eee]">
          <div className="max-w-[1080px] mx-auto px-5 py-14">
            <h2 className="text-[28px] md:text-[34px] font-bold tracking-[-0.02em] mb-7">{t.whyUs}</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {site.highlights.map((h) => (
                <li key={h} className="flex items-start gap-3 text-[16px]">
                  <span className="mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[13px]" style={{ background: accent, color: onAccent }}>
                    ✓
                  </span>
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Gallery */}
      {site.gallery.length > 0 && (
        <section className="max-w-[1080px] mx-auto px-5 py-14">
          <h2 className="text-[28px] md:text-[34px] font-bold tracking-[-0.02em] mb-7">{t.gallery}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {site.gallery.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt={business.name} loading="lazy" className="w-full aspect-square object-cover rounded-xl" />
            ))}
          </div>
        </section>
      )}

      {/* Area & hours */}
      {(area || site.hours) && (
        <section className="max-w-[1080px] mx-auto px-5 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {area && (
              <div className="rounded-2xl border border-[#eaeaea] p-5">
                <div className="text-[13px] font-semibold uppercase tracking-wide text-[#6b6b6b] mb-1">{t.serviceArea}</div>
                <div className="text-[16px]">{area}</div>
              </div>
            )}
            {site.hours && (
              <div className="rounded-2xl border border-[#eaeaea] p-5">
                <div className="text-[13px] font-semibold uppercase tracking-wide text-[#6b6b6b] mb-1">{t.hours}</div>
                <div className="text-[16px] whitespace-pre-line">{site.hours}</div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* FAQ */}
      {site.faq.length > 0 && (
        <section className="max-w-[1080px] mx-auto px-5 py-14">
          <h2 className="text-[28px] md:text-[34px] font-bold tracking-[-0.02em] mb-7">{t.faq}</h2>
          <div className="flex flex-col divide-y divide-[#eee] border-y border-[#eee]">
            {site.faq.map((f) => (
              <details key={f.q} className="py-4 group">
                <summary className="cursor-pointer text-[16.5px] font-semibold list-none flex justify-between gap-4">
                  {f.q}
                  <span className="text-[#999] group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-[15px] text-[#555] leading-relaxed whitespace-pre-line">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Final CTA */}
      {(phone || wa) && (
        <section className="max-w-[1080px] mx-auto px-5 py-14">
          <div className="rounded-3xl p-8 md:p-12 flex flex-col gap-4" style={{ background: accent, color: onAccent }}>
            <h2 className="text-[28px] md:text-[36px] font-bold tracking-[-0.02em]">{t.ctaTitle}</h2>
            <p className="text-[16px] opacity-90">{t.ctaSub}</p>
            <div className="flex flex-wrap gap-3">
              {phone && (
                <ContactLink href={telHref(phone)} businessId={business.id} channel="call" className="inline-flex items-center gap-2 h-[52px] px-6 rounded-full text-[16px] font-semibold bg-white text-[#111]">
                  <PhoneIcon /> {formatPhone(phone)}
                </ContactLink>
              )}
              {wa && (
                <ContactLink href={waHref(wa, generic)} businessId={business.id} channel="whatsapp" external className="inline-flex items-center gap-2 h-[52px] px-6 rounded-full text-[16px] font-semibold border border-current">
                  <WaIcon /> {t.whatsapp}
                </ContactLink>
              )}
            </div>
          </div>
        </section>
      )}

      <footer className="border-t border-[#eee] py-8 px-5 text-center text-[12.5px] text-[#888] flex flex-col gap-2 items-center">
        <span>
          <a href="/" className="underline">
            {t.builtWith(business.name)}
          </a>
        </span>
        <a href={`/report/${business.slug}`} className="underline">
          {t.report}
        </a>
      </footer>

      {/* Sticky mobile contact bar */}
      {(phone || wa) && (
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#e5e5e5] px-3 py-2.5 flex gap-2" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          {phone && (
            <ContactLink href={telHref(phone)} businessId={business.id} channel="call" className="flex-1 h-12 rounded-full flex items-center justify-center gap-2 text-[15px] font-semibold" style={{ background: accent, color: onAccent }}>
              <PhoneIcon /> {t.call}
            </ContactLink>
          )}
          {phone && site.textEnabled && (
            <ContactLink href={smsHref(phone, generic)} businessId={business.id} channel="text" className="flex-1 h-12 rounded-full flex items-center justify-center gap-2 text-[15px] font-semibold border border-[#d9d9d9]">
              <TextIcon /> {t.textShort}
            </ContactLink>
          )}
          {wa && (
            <ContactLink href={waHref(wa, generic)} businessId={business.id} channel="whatsapp" external className="flex-1 h-12 rounded-full flex items-center justify-center gap-2 text-[15px] font-semibold border border-[#d9d9d9]">
              <WaIcon /> {t.whatsapp}
            </ContactLink>
          )}
        </nav>
      )}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
    </svg>
  );
}

function TextIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function WaIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 2.9 2.9 0 0 0-.9 2.2 5 5 0 0 0 1 2.7 11.5 11.5 0 0 0 4.4 3.9c1.6.7 2.3.8 3.1.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.5-.3z" />
    </svg>
  );
}
