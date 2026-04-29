import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { parseBillPath, billIdentifierFor } from "@/lib/bills/url";
import { pickBillHeadline } from "@/lib/bill-headline";
import { formatBillNumber } from "@/lib/bill-grouping";
import { getStatusExplanation } from "@/lib/bill-helpers";
import { formatOrdinal } from "@/lib/parse-bill-citation";

export const alt = "Govroll bill share";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const FONT_URL =
  "https://cdn.jsdelivr.net/fontsource/fonts/eb-garamond@latest/latin-700-normal.woff";

const NAVY = "#0A1F44";
const GOLD = "#B8860B";
const WHITE = "#FFFFFF";

// Hard cap so a procedural-title fallback ("To amend the Internal Revenue
// Code of 1986 to provide for…") still lays out cleanly. At 64px in the
// 1040px content width, ~22 chars fit per line, so 110 caps at ~5 lines —
// past that the bottom status row gets clipped.
const HEADLINE_HARD_CAP = 110;

function clampHeadline(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const idx = lastSpace > max * 0.6 ? lastSpace : max - 1;
  return cut.slice(0, idx).replace(/[,;:]\s*$/, "") + "…";
}

// Tuned for legibility at thumbnail sizes (iMessage ~300px, Twitter ~506px).
// Source font sizes scale down by ~3-4× in those previews, so the floor is
// 64px — anything smaller becomes mush.
function headlineFontSize(text: string): number {
  const len = text.length;
  if (len <= 24) return 128;
  if (len <= 50) return 104;
  if (len <= 90) return 80;
  return 64;
}

type Params = Promise<{
  congress: string;
  chamber: string;
  numberSlug: string;
}>;

export default async function OgImage({ params }: { params: Params }) {
  const fontPromise = fetch(FONT_URL).then((r) => r.arrayBuffer());

  const { congress, chamber, numberSlug } = await params;
  const parsed = parseBillPath([congress, chamber, numberSlug]);
  const billIdKey = parsed
    ? billIdentifierFor(parsed.chamberCode, parsed.number, parsed.congress)
    : null;
  const bill = billIdKey
    ? await prisma.bill.findUnique({
        where: { billId: billIdKey },
        select: {
          billId: true,
          billType: true,
          congressNumber: true,
          currentStatus: true,
          title: true,
          popularTitle: true,
          shortTitle: true,
          displayTitle: true,
          shortText: true,
          aiShortDescription: true,
        },
      })
    : null;

  const fontData = await fontPromise;
  const fonts = [
    {
      name: "EBGaramond",
      data: fontData,
      weight: 700 as const,
      style: "normal" as const,
    },
  ];

  if (!bill) {
    return new ImageResponse(<BrandFallback />, { ...size, fonts });
  }

  const { headline: rawHeadline } = pickBillHeadline(bill);
  const headline = clampHeadline(rawHeadline, HEADLINE_HARD_CAP);
  const fontSize = headlineFontSize(headline);
  const identifier = formatBillNumber(bill.billType, bill.billId);
  const citation = bill.congressNumber
    ? `${identifier} · ${formatOrdinal(bill.congressNumber)} Congress`
    : identifier;
  const statusLabel = getStatusExplanation(
    bill.billType,
    bill.currentStatus,
  ).headline;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "72px 80px",
        backgroundColor: NAVY,
        fontFamily: "EBGaramond",
      }}
    >
      <div
        style={{
          display: "flex",
          color: GOLD,
          fontSize: 36,
          letterSpacing: "0.14em",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        {citation}
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          color: WHITE,
          fontSize,
          lineHeight: 1.06,
          fontWeight: 700,
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        {headline}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            color: GOLD,
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          {statusLabel}
        </div>
        <div
          style={{
            display: "flex",
            color: WHITE,
            fontSize: 44,
            letterSpacing: "0.22em",
            fontWeight: 700,
            opacity: 0.78,
          }}
        >
          GOVROLL
        </div>
      </div>
    </div>,
    { ...size, fonts },
  );
}

function BrandFallback() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: NAVY,
        fontFamily: "EBGaramond",
      }}
    >
      <div
        style={{
          display: "flex",
          color: WHITE,
          fontSize: 144,
          fontWeight: 700,
          letterSpacing: "0.18em",
        }}
      >
        GOVROLL
      </div>
    </div>
  );
}
