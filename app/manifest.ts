import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chinese Flashcards",
    short_name: "Flashcards",
    description: "Personal flashcards with FSRS spaced repetition",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f5f3",
    theme_color: "#c0262d",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
