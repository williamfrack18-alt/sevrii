/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: "/", destination: "/index.html" },
      { source: "/en", destination: "/en/index.html" },
    ];
  },
};

module.exports = nextConfig;
