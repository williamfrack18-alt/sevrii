import type { Metadata } from "next";
import "./globals.css";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import LangProvider from "@/components/LangProvider";
import { GeistSans } from "geist/font/sans";

export async function generateMetadata(): Promise<Metadata> {
  const t = getDict(await getLang());
  return {
    title: t.meta.title,
    description: t.meta.description,
    icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/assets/favicon.png", type: "image/png", sizes: "32x32" }], apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Sevrii", statusBarStyle: "black-translucent" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={GeistSans.variable}>
      <body className="font-sans">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
