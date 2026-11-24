import type { MetadataRoute } from "next";

// What search engines may crawl. Private areas (the panel, payments, account,
// admin, review links) stay out; the marketplace API stays open because the
// home page lists the services with it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/api/marketplace"],
        disallow: ["/dashboard", "/start", "/account", "/admin", "/api/", "/pay/", "/resena/", "/report/", "/comprar", "/empezar", "/onboarding", "/discover", "/goodbye", "/reset", "/forgot", "/panel-afiliado", "/ser-afiliado", "/*?vista=", "/*?editar=", "/*?diseno="],
      },
    ],
    sitemap: "https://www.sevrii.com/sitemap.xml",
    host: "https://www.sevrii.com",
  };
}
