import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://authai.io";
// Title kept to ~55-65 chars (SERP sweet spot). Description ~120 chars so it
// survives both Google's ~160-char SERP cut and social previews' ~125-char cut
// without truncating the punchline. Colon (not em-dash) is the separator:
// em-dash is banned in user-visible strings per the design-taste rules.
const SITE_TITLE = "AuthAI: Sign in with a ChatGPT, Grok, or Copilot subscription";
const SITE_DESCRIPTION =
  "Build AI products without the AI bill. Your users sign in with their ChatGPT, Grok, or Copilot subscription, and their plan covers every model call.";

// Next.js auto-detects /opengraph-image at /opengraph-image, but declaring it
// explicitly here means crawlers that don't probe (Discord, iMessage in some
// cases, older Slack) get a guaranteed absolute URL instead of relying on
// metadataBase resolution.
const OG_IMAGE_URL = `${SITE_URL}/opengraph-image`;
const OG_IMAGE_ALT =
  "AuthAI: Build AI products without the AI bill. Sign in with ChatGPT, Grok, or Copilot. Run: npx authai-cloud init.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: "AuthAI",
  authors: [{ name: "Interface Labs", url: "https://interfacelabs.ai" }],
  generator: "Next.js",
  keywords: [
    "AuthAI",
    "Sign in with ChatGPT",
    "OAuth relay",
    "AI subscriptions",
    "ChatGPT API",
    "Grok API",
    "Copilot API",
    "device-code OAuth",
    "OpenAI relay",
    "user-funded inference",
  ],
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
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: OG_IMAGE_ALT,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    // TODO: fill these in when an AuthAI Twitter/X handle exists. Until then
    // the card still renders with the image and copy, just without
    // "via @handle" attribution under it.
    // site: "@authai_io",
    // creator: "@riccardo_io",
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: OG_IMAGE_ALT,
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

// themeColor lives on Viewport in Next.js 15+ (was Metadata in 14).
// Browser chrome on mobile gets tinted to match: white in light mode,
// near-black in dark. Avoids the iOS Safari "white tab on dark mode" jump.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  colorScheme: "light dark",
  width: "device-width",
  initialScale: 1,
};

// JSON-LD structured data. Helps Google understand "this is a software
// application" and surface richer SERP cards. Schema.org SoftwareApplication
// type is the right one for both the SaaS site (authai.io) and the npm
// package family it advertises.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "AuthAI",
      url: SITE_URL,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Cross-platform",
      description: SITE_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      author: {
        "@type": "Organization",
        name: "Interface Labs",
        url: "https://interfacelabs.ai",
      },
      license: "https://opensource.org/licenses/MIT",
      codeRepository: "https://github.com/authai-io/authai",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "AuthAI",
      description: SITE_DESCRIPTION,
      publisher: {
        "@type": "Organization",
        name: "Interface Labs",
        url: "https://interfacelabs.ai",
      },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Geist + Geist Mono via Google Fonts. The demo-react demo loads
          these the same way; preconnect saves one round-trip on first paint.
          next/font/google would self-host the woff2s; tracked as a follow-up
          (perf > parity tradeoff for the launch window).
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        <script
          type="application/ld+json"
          // The JSON-LD blob is a fixed, build-time-stringified object; no
          // user input flows through it, so dangerouslySetInnerHTML is safe.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
