import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sevrii — AI website & marketing for service businesses",
  description:
    "Tell Sevrii what you do. The AI writes your pitch, builds your page, and runs your marketing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@100..900&display=swap"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
