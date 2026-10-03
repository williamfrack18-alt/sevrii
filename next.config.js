/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Only Sevrii itself may frame its pages (the dashboard previews /site/... in an iframe).
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Store photo uploads go through a server action (max 4 MB per photo).
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      { source: "/en", destination: "/en/index.html" },
      // Static marketing pages in public/ (don't rely only on Vercel's cleanUrls).
      { source: "/:page(ofrecerservicios|terminos|matheus-credito)", destination: "/:page.html" },
      { source: "/en/:page(ofrecerservicios|terminos|matheus-credito)", destination: "/en/:page.html" },
    ];
  },
};

module.exports = nextConfig;
