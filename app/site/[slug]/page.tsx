import { notFound } from "next/navigation";
import { getBusinessBySlug, listServices, listReviews } from "@/lib/db";

export default function PublicBusinessPage({ params }: { params: { slug: string } }) {
  const business = getBusinessBySlug(params.slug);
  if (!business || !business.published) notFound();

  const services = listServices(business.id);
  const reviews = listReviews(business.id);
  const waLink = business.whatsapp
    ? `https://wa.me/${business.whatsapp.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border">
        <div className="max-w-[900px] mx-auto px-6 h-[64px] flex items-center justify-between">
          <span className="font-serif text-lg font-semibold" style={{ color: business.accentColor }}>
            {business.name}
          </span>
          {waLink ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="h-[38px] px-5 rounded-full text-white text-[13px] font-semibold flex items-center"
              style={{ background: business.accentColor }}
            >
              Message on WhatsApp
            </a>
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
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 h-[48px] px-6 rounded-full text-white text-[15px] font-semibold mt-2"
            style={{ background: business.accentColor }}
          >
            Message on WhatsApp
          </a>
        ) : (
          <p className="text-[13px] text-mutedLight mt-2">
            This business hasn&rsquo;t added a contact number yet.
          </p>
        )}
      </section>

      {services.length > 0 && (
        <section className="max-w-[900px] mx-auto px-6 py-12 border-t border-border">
          <h2 className="font-serif text-2xl font-semibold mb-6">Services</h2>
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
        <h2 className="font-serif text-2xl font-semibold mb-6">Reviews</h2>
        {reviews.length === 0 ? (
          <p className="text-muted text-[14px]">No reviews yet.</p>
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
        Built with Sevri
      </footer>
    </div>
  );
}
