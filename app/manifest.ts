import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Studio Flow",
    short_name: "Studio Flow",
    description: "Reservas, progreso y comunicación de tu estudio en un solo lugar.",
    start_url: "/student",
    scope: "/",
    display: "standalone",
    background_color: "#090A0F",
    theme_color: "#090A0F",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/pwa/icon/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
