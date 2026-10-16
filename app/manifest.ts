import type { MetadataRoute } from "next";

// Lets owners add Sevrii to their phone's home screen (needed for
// notifications on iPhone).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sevrii",
    short_name: "Sevrii",
    description: "Tu tienda, tus clientes y tu marketing en un solo lugar.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
