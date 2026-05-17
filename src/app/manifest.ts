import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sohojatra - Ride Sharing",
    short_name: "Sohojatra",
    description: "Share rides and travel together with Sohojatra",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#3b82f6",
    icons: [
      {
        src: "/sohojatra-splash.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/sohojatra_ico.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
  };
}
