import type { Metadata } from "next";
import "./globals.css";
import { getLang } from "@/lib/lang";
import { getDict } from "@/lib/i18n";
import LangProvider from "@/components/LangProvider";

export function generateMetadata(): Metadata {
  const t = getDict(getLang());
  return { title: t.meta.title, description: t.meta.description };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLang();
  return (
    <html lang={lang}>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@100..900&display=swap"
        />
      </head>
      <body className="font-sans">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
