import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBusinessById, purchaseByReviewToken } from "@/lib/db";
import { hashToken } from "@/lib/customers";
import ReviewForm from "@/app/reviews/ReviewForm";
import "@/app/pay/[id]/pay.css";
import "@/app/reviews/reviews.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sevrii", robots: { index: false } };

// The review link emailed after a purchase: works on any device, only for
// that customer and that business.
export default async function ReviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) notFound();
  const p = await purchaseByReviewToken(hashToken(token));
  const business = p ? await getBusinessById(p.businessId) : undefined;
  if (!p || !business || !p.customerId) notFound();
  const lang = business.site.lang;
  const accent = /^#[0-9a-f]{6}$/i.test(business.accentColor) ? business.accentColor : "#234f36";
  return (
    <div className="pay" lang={lang} style={{ ["--accent" as string]: accent } as React.CSSProperties}>
      <main className="pay-card">
        <div className="pay-biz">
          {business.site.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.site.logoUrl} alt="" className="pay-logo" />
          ) : (
            <span className="pay-initial">{business.name.trim().charAt(0).toUpperCase()}</span>
          )}
          <span className="pay-biz-name">{business.name}</span>
        </div>
        <ReviewForm businessId={business.id} businessName={business.name} lang={lang} token={token} />
        {business.published ? (
          <p className="pay-secure">
            <a href={`/site/${business.slug}`}>{lang === "en" ? "See their page" : "Ver su página"} →</a>
          </p>
        ) : null}
      </main>
    </div>
  );
}
