import { ImageResponse } from "next/og";

export const alt = "AuthAI — auth for AI builders";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#171717";
const SUBTLE = "#737373";
const ACCENT = "#1d4dff";
const BG = "#ffffff";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BG,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 88px",
          fontFamily: "sans-serif",
          color: INK,
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
    ),
    { ...size },
  );
}
