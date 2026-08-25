import { ImageResponse } from "next/og";

export const alt = "Govroll — See What Your Representatives Are Doing";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Roll Call palette
const SAND = "#F2EDE3";
const INK = "#14161C";
const SAPPHIRE = "#4164FF";
const GOLD = "#FFB62E";

const FONT_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/archivo@latest/latin-800-normal.woff";

/** The brand node — a gold dot ringed in sapphire, "you are here". */
function Node({ size: s = 72 }: { size?: number }) {
  const ring = Math.round(s * 0.18);
  return (
    <div
      style={{
        display: "flex",
        width: s,
        height: s,
        borderRadius: 9999,
        backgroundColor: GOLD,
        border: `${ring}px solid ${SAPPHIRE}`,
      }}
    />
  );
}

export default async function OgImage() {
  const fontRes = await fetch(new URL(FONT_URL));
  const fontData = await fontRes.arrayBuffer();

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: SAND,
      }}
    >
      {/* Node + wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: "44px" }}>
        <Node size={96} />
        <span
          style={{
            color: INK,
            fontSize: 150,
            fontFamily: "Archivo",
            fontWeight: 800,
            letterSpacing: "0.02em",
          }}
        >
          GOVROLL
        </span>
      </div>

      {/* Single sapphire rule — the route line */}
      <div
        style={{
          display: "flex",
          width: 560,
          height: 5,
          marginTop: 56,
          backgroundColor: SAPPHIRE,
        }}
      />

      <div
        style={{
          display: "flex",
          marginTop: 40,
          color: INK,
          fontSize: 34,
          fontFamily: "Archivo",
          fontWeight: 800,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        See what your representatives are doing
      </div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Archivo",
          data: fontData,
          weight: 800,
          style: "normal",
        },
      ],
    },
  );
}
