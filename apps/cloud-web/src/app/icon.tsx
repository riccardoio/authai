import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/**
 * Browser-tab favicon. Mirrors the landing-page brand mark
 * (three rounded squares offset diagonally). Inverts in dark mode
 * via the white-on-dark variant most browsers don't actually fetch,
 * but the mark works on both because the squares are pure ink.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
          position: "relative",
          display: "flex",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 1,
            top: 1,
            width: 12,
            height: 12,
            background: "#0a0a0a",
            borderRadius: 2,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 19,
            top: 19,
            width: 12,
            height: 12,
            background: "#0a0a0a",
            borderRadius: 2,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 10,
            width: 12,
            height: 12,
            border: "2px solid #0a0a0a",
            borderRadius: 2,
            boxSizing: "border-box",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
