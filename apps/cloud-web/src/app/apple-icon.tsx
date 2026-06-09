import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/**
 * Apple touch icon (180x180). Same mark as the favicon, sized up
 * with a near-white background card behind it. iOS renders this
 * for "Add to Home Screen" and as the favicon on iOS Safari tabs.
 */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "#ffffff",
          position: "relative",
          display: "flex",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 45,
            top: 45,
            width: 30,
            height: 30,
            background: "#0a0a0a",
            borderRadius: 6,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 105,
            top: 105,
            width: 30,
            height: 30,
            background: "#0a0a0a",
            borderRadius: 6,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 75,
            top: 75,
            width: 30,
            height: 30,
            border: "5px solid #0a0a0a",
            borderRadius: 6,
            boxSizing: "border-box",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
