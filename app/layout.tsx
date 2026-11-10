import type { Metadata, Viewport } from "next";
import { notoSans } from "./fonts";
import "./globals.css";

const siteUrl = new URL("https://flashcards.naijei.com");
const description = "Personal flashcards with FSRS spaced repetition";

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: "Chinese Flashcards",
  description,
  // Relative image and page URLs are resolved against metadataBase so crawlers
  // receive absolute https://flashcards.naijei.com links. The file is in /public,
  // outside the signed-in app shell.
  openGraph: {
    title: "Chinese Flashcards",
    description,
    url: "/",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 627,
        type: "image/png",
        alt: "Chinese Flashcards",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chinese Flashcards",
    description,
    images: ["/og-image.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Flashcards",
    statusBarStyle: "default",
  },
  // Next emits mobile-web-app-capable. Older iOS still reads the Apple name.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Chromium/Android resize the layout for the soft keyboard. iOS Safari is
  // handled by pinning study screens to visualViewport (useViewportLock).
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f5f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0e0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={notoSans.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
