import { ImageResponse } from "next/og";

export const alt = "AuthAI — auth for AI builders";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#171717";
const SUBTLE = "#737373";
const ACCENT = "#1d4dff";
const BG = "#ffffff";

/**
 * Aurora + grid backdrop mirroring the landing page's hero
 * (.landing::before + .landing::after in globals.css). Satori doesn't
 * support filter: blur, so the gradients have wider falloffs to fake
 * the same softness. A bottom-up white wash fades the grid + aurora
 * into the lower half so the headline reads clean.
 */
export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          position: "relative",
          fontFamily: "sans-serif",
          color: INK,
          overflow: "hidden",
        }}
      >
        {/* Aurora — soft lime blob upper-left.
            Satori only accepts simple radial-gradient (circle at X% Y%);
            the explicit-ellipse-size form silently no-ops, hence two
            separate divs instead of one stacked backgroundImage. */}
        <div
          style={{
            position: "absolute",
            top: -200,
            left: -200,
            width: 900,
            height: 900,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at center, rgba(57, 255, 20, 0.45), rgba(57, 255, 20, 0) 70%)",
          }}
        />
        {/* Aurora — soft green blob upper-right */}
        <div
          style={{
            position: "absolute",
            top: -150,
            right: -200,
            width: 850,
            height: 850,
            display: "flex",
            backgroundImage:
              "radial-gradient(circle at center, rgba(0, 255, 136, 0.38), rgba(0, 255, 136, 0) 72%)",
          }}
        />
        {/* Grid overlay — vertical lines */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "linear-gradient(to right, rgba(0, 0, 0, 0.05) 1px, rgba(0, 0, 0, 0) 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        {/* Grid overlay — horizontal lines */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "linear-gradient(to bottom, rgba(0, 0, 0, 0.05) 1px, rgba(0, 0, 0, 0) 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        {/* Bottom wash — fades aurora + grid out toward the footer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            backgroundImage:
              "linear-gradient(to bottom, rgba(255, 255, 255, 0) 35%, rgba(255, 255, 255, 0.92) 80%, rgba(255, 255, 255, 1) 100%)",
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
            padding: "72px 88px",
          }}
        >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ position: "relative", display: "flex", width: 96, height: 96 }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: 40,
                height: 40,
                background: INK,
                borderRadius: 8,
                display: "flex",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 56,
                top: 56,
                width: 40,
                height: 40,
                background: INK,
                borderRadius: 8,
                display: "flex",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 28,
                top: 28,
                width: 40,
                height: 40,
                border: `6px solid ${INK}`,
                borderRadius: 8,
                boxSizing: "border-box",
                display: "flex",
              }}
            />
          </div>
          <span style={{ fontSize: 56, fontWeight: 600, letterSpacing: -1 }}>AuthAI</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <span
            style={{
              fontSize: 104,
              fontWeight: 600,
              letterSpacing: -3,
              lineHeight: 1.02,
              maxWidth: 980,
              display: "flex",
            }}
          >
            Auth for AI builders.
          </span>
          <span
            style={{
              fontSize: 36,
              color: SUBTLE,
              lineHeight: 1.3,
              maxWidth: 980,
              display: "flex",
            }}
          >
            Your users sign in once with their AI subscription. Every model call lands on their plan.
          </span>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <span style={{ fontSize: 30, color: SUBTLE, display: "flex" }}>authai.io</span>
          <span style={{ fontSize: 26, color: ACCENT, fontWeight: 500, display: "flex" }}>
            Open source · Self-hostable
          </span>
        </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
