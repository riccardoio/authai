import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = "https://authai.io";
const SITE_TITLE = "AuthAI — auth for AI builders";
const SITE_DESCRIPTION =
  "Build AI products without the AI bill. Your users sign in with their AI subscription; every model call lands on their plan. Across ChatGPT, Grok, and Copilot. Free, open-source, self-hostable.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: "/",
    types: { "text/markdown": "/llms.txt" },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "AuthAI",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Geist + Geist Mono via Google Fonts. The example-react demo loads
          these the same way; preconnect saves one round-trip on first paint.
          next/font/google would self-host the woff2s, but for parity with
          the existing demo and zero build-cost we keep the CDN link.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
