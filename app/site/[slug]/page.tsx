import { notFound } from "next/navigation";
import { getBusinessBySlug, listServices, listReviews, incrementPageViews } from "@/lib/db";
import WhatsappLink from "./WhatsappLink";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";

export default async function PublicBusinessPage({ params }: { params: { slug: string } }) {
  const business = await getBusinessBySlug(params.slug);
  if (!business || !business.published) notFound();

  const t = getDict(getLang());
  const services = await listServices(business.id);
  const reviews = await listReviews(business.id);
  const waLink = business.whatsapp
    ? `https://wa.me/${business.whatsapp.replace(/[^0-9]/g, "")}`
    : null;

  try {
    await incrementPageViews(business.id);
  } catch {
    // Never let analytics failures break the visitor's page.
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border">
        <div className="max-w-[900px] mx-auto px-6 h-[64px] flex items-center justify-between">
          <span className="font-serif text-lg font-semibold" style={{ color: business.accentColor }}>
            {business.name}
          </span>
          {waLink ? (
            <WhatsappLink
              href={waLink}
              businessId={business.id}
              className="h-[38px] px-5 rounded-full text-white text-[13px] font-semibold flex items-center"
              style={{ background: business.accentColor }}
            >
              {t.site.message}
            </WhatsappLink>
          ) : null}
        </div>
      </header>

      <section className="max-w-[900px] mx-auto px-6 py-16 flex flex-col gap-4">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">
          {business.category}
          {business.city ? ` · ${business.city}` : ""}
        </span>
        <h1 className="font-serif text-4xl font-semibold leading-tight max-w-2xl">{business.name}</h1>
        <p className="text-muted text-lg max-w-xl leading-relaxed">{business.pitch}</p>
        {waLink ? (
          <WhatsappLink
            href={waLink}
            businessId={business.id}
            className="inline-flex w-fit items-center gap-2 h-[48px] px-6 rounded-full text-white text-[15px] font-semibold mt-2"
            style={{ background: business.accentColor }}
          >
            {t.site.message}
          </WhatsappLink>
        ) : (
          <p className="text-[13px] text-mutedLight mt-2">
            {t.site.noContact}
          </p>
        )}
      </section>

      {services.length > 0 && (
        <section className="max-w-[900px] mx-auto px-6 py-12 border-t border-border">
          <h2 className="font-serif text-2xl font-semibold mb-6">{t.site.services}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {services.map((s) => (
              <div key={s.id} className="card">
                <div className="font-semibold text-[15px]">{s.name}</div>
                {s.price && <div className="text-muted text-[13.5px] mt-1">{s.price}</div>}
                {s.description && <div className="text-muted text-[13.5px] mt-2">{s.description}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="max-w-[900px] mx-auto px-6 py-12 border-t border-border">
        <h2 className="font-serif text-2xl font-semibold mb-6">{t.site.reviews}</h2>
        {reviews.length === 0 ? (
          <p className="text-muted text-[14px]">{t.site.noReviews}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {reviews.map((r) => (
              <div key={r.id} className="card">
                <div className="text-[13px] font-semibold">
                  {r.author} · {"★".repeat(r.rating)}
                  {"☆".repeat(Math.max(0, 5 - r.rating))}
                </div>
                <p className="text-muted text-[13.5px] mt-2">{r.text}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="border-t border-border py-8 text-center text-[12.5px] text-mutedLight">
        {t.site.builtWith}
      </footer>
    </div>
  );
}
