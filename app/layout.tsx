import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sevri — AI website & marketing for service businesses",
  description:
    "Tell Sevri what you do. The AI writes your pitch, builds your page, and runs your marketing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
