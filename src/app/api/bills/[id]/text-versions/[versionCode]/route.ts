import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildReaderSections } from "@/lib/bills/reader-sections";
import { reportError } from "@/lib/error-reporting";

/**
 * Returns one bill text version's rendered sections + meta, for the
 * reader's client-side version switcher (`?v=`).
 *
 * The reader page server-renders only the *latest* version so the route
 * stays full-route ISR-cacheable (it reads no searchParams). Selecting an
 * older version in the picker fetches it here and swaps it in client-side.
 * Non-latest versions are never canonical (canonical = latest), so they do
 * not need to live in the server HTML.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionCode: string }> },
) {
  const { id, versionCode } = await params;
  const billId = parseInt(id);
  if (Number.isNaN(billId)) {
    return NextResponse.json({ error: "Invalid bill id" }, { status: 400 });
  }

  try {
    // (billId, versionCode) is unique; the fullText guard mirrors the
    // reader page so we never hand back a text-less version row.
    const version = await prisma.billTextVersion.findFirst({
      where: { billId, versionCode, fullText: { not: null } },
      select: {
        id: true,
        versionCode: true,
        versionType: true,
        versionDate: true,
        isSubstantive: true,
        fullText: true,
        sectionCaptions: true,
      },
    });

    if (!version?.fullText) {
      return NextResponse.json({ error: "Version not found" }, { status: 404 });
    }

    const sections = buildReaderSections(
      version.fullText,
      version.sectionCaptions,
    );
    if (sections.length === 0) {
      return NextResponse.json(
        { error: "Version has no readable text" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      version: {
        id: version.id,
        versionCode: version.versionCode,
        versionType: version.versionType,
        versionDate: version.versionDate,
        isSubstantive: version.isSubstantive,
      },
      sections,
    });
  } catch (error) {
    reportError(error, {
      route: "GET /api/bills/[id]/text-versions/[versionCode]",
      billId,
    });
    return NextResponse.json(
      { error: "Failed to load version" },
      { status: 500 },
    );
  }
}
