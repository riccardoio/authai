import { ImageResponse } from "next/og";

export const alt =
  "AuthAI: Build AI products without the AI bill. Sign in with ChatGPT, Grok, or Copilot. Run: npx authai-cloud init.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Brand tokens (mirror globals.css). Keep in sync if you bump theme.
const INK = "#0a0a0a";
const SUBTLE = "#525252";
const ACCENT = "#1d4dff";
const BG = "#ffffff";
const TERMINAL_BG = "#0a0a0a";
const TERMINAL_FG = "#e5e5e5";
const TERMINAL_MUTED = "#737373";

// Single radius scale (small-soft family). Cards and logo squares scale together.
const R_SMALL = 4;
const R_MEDIUM = 10;

/**
 * Fetches a Geist TTF binary that Satori can parse. Satori uses
 * opentype.js, which supports TTF/OTF/WOFF but NOT WOFF2. Google
 * Fonts now serves only WOFF2 even with a downgraded UA, so we
 * pull from jsdelivr's mirror of Vercel's `geist` npm package,
 * which ships the raw .ttf files alongside the woff2.
 */
async function loadGeist(
  pkg: "geist-sans" | "geist-mono",
  file: string,
): Promise<ArrayBuffer> {
  const url = `https://cdn.jsdelivr.net/npm/geist@latest/dist/fonts/${pkg}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[opengraph-image] failed to fetch ${file}: ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * OG image. 1200x630, ~50-80 KB rendered. Must be readable at 200px
 * thumbnail (iMessage / Twitter inline preview), so the headline
 * carries the composition.
 *
 * Design tenets:
 *   - Headline matches the landing H1 exactly so click-through reinforces
 *     (tweet -> preview -> landing all say the same thing).
 *   - A literal `npx authai-cloud init` terminal card answers "how do I
 *     try this" before the user even clicks.
 *   - Soft lime + green aurora upper corners (same signature as landing
 *     hero) for visual identity without competing with text.
 *   - No decorative grid (banned per design-taste-frontend section 9.F).
 *   - No corner decoration strip (banned per 9.F).
 *   - One radius scale (small-soft) for shape consistency.
 *   - Brand mark from landing-client.tsx.
 */
export default async function OpengraphImage() {
  const [geist400, geist600, geistMono500] = await Promise.all([
    loadGeist("geist-sans", "Geist-Regular.ttf"),
    loadGeist("geist-sans", "Geist-SemiBold.ttf"),
    loadGeist("geist-mono", "GeistMono-Medium.ttf"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          position: "relative",
          fontFamily: "Geist",
          color: INK,
          overflow: "hidden",
        }}
      >
        {/* Aurora: soft lime blob upper-left */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: -260,
            width: 820,
            height: 820,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at center, rgba(57, 255, 20, 0.22), rgba(57, 255, 20, 0) 65%)",
          }}
        />
        {/* Aurora: soft green blob upper-right */}
        <div
          style={{
            position: "absolute",
            top: -220,
            right: -260,
            width: 780,
            height: 780,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at center, rgba(0, 255, 136, 0.18), rgba(0, 255, 136, 0) 68%)",
          }}
        />
        {/* Bottom wash: fades aurora out so the terminal card and headline
            land on near-white, which is mandatory for legibility at thumbnail. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.55) 38%, rgba(255, 255, 255, 0.96) 75%, rgba(255, 255, 255, 1) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: "64px 80px",
          }}
        >
          {/* Brand mark + wordmark (mirrors landing-client.tsx SVG) */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ position: "relative", display: "flex", width: 56, height: 56 }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 24,
                  height: 24,
                  background: INK,
                  borderRadius: R_SMALL,
                  display: "flex",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 32,
                  top: 32,
                  width: 24,
                  height: 24,
                  background: INK,
                  borderRadius: R_SMALL,
                  display: "flex",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 16,
                  top: 16,
                  width: 24,
                  height: 24,
                  border: `4px solid ${INK}`,
                  borderRadius: R_SMALL,
                  boxSizing: "border-box",
                  display: "flex",
                }}
              />
            </div>
            <span style={{ fontSize: 40, fontWeight: 600, letterSpacing: -0.8 }}>AuthAI</span>
          </div>

          {/* Headline + subtitle. Headline dominates the canvas; subtitle
              is the "what is this" answer at thumbnail size. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <span
              style={{
                fontSize: 108,
                fontWeight: 600,
                letterSpacing: -3.6,
                lineHeight: 1.02,
                maxWidth: 1040,
                display: "flex",
              }}
            >
              Build AI products without the AI bill.
            </span>
            <span
              style={{
                fontSize: 34,
                color: SUBTLE,
                lineHeight: 1.3,
                maxWidth: 1040,
                display: "flex",
              }}
            >
              Sign in with ChatGPT, Grok, or Copilot. Your users’ plan pays for the inference.
            </span>
          </div>

          {/* Terminal card: shows the install command. Real content,
              answers "how do I try this" in one glance. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: 18,
                background: TERMINAL_BG,
                borderRadius: R_MEDIUM,
                padding: "22px 28px",
                fontFamily: "Geist Mono",
                boxShadow: "0 14px 40px rgba(0, 0, 0, 0.12)",
              }}
            >
              <span style={{ color: TERMINAL_MUTED, fontSize: 28, fontWeight: 500 }}>$</span>
              <span style={{ color: TERMINAL_FG, fontSize: 28, fontWeight: 500 }}>npx </span>
              <span style={{ color: ACCENT, fontSize: 28, fontWeight: 500 }}>authai-cloud</span>
              <span style={{ color: TERMINAL_FG, fontSize: 28, fontWeight: 500 }}> init</span>
            </div>

            {/* Footer: URL only. No decoration strip. */}
            <span style={{ fontSize: 26, color: SUBTLE, display: "flex" }}>authai.io</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: geist400, weight: 400, style: "normal" },
        { name: "Geist", data: geist600, weight: 600, style: "normal" },
        { name: "Geist Mono", data: geistMono500, weight: 500, style: "normal" },
      ],
    },
  );
}
