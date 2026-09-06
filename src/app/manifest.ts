import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Hanabi LOG",
    short_name: "Hanabi LOG",
    description: "チームの活動・判断・学びを残す日報アプリ",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0d1833",
    icons: [
      { src: "/app-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
