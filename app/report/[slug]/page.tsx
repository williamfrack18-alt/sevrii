import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBusinessBySlug } from "@/lib/db";
import { STORE_TEXT } from "@/lib/storeI18n";
import ReportForm from "./ReportForm";

export const metadata: Metadata = { robots: { index: false } };

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const lang = business.site.lang;
  const t = STORE_TEXT[lang].report;
  return (
    <div lang={lang} className="min-h-screen bg-white text-[#111] font-sans">
      <div className="max-w-[560px] mx-auto px-5 py-14">
        <h1 className="text-[28px] font-bold tracking-[-0.02em] mb-2">{t.title}</h1>
        <p className="text-[15px] text-[#555] mb-1">{business.name}</p>
        <p className="text-[14px] text-[#777] mb-8">{t.intro}</p>
        <ReportForm slug={business.slug} lang={lang} />
      </div>
    </div>
  );
}
