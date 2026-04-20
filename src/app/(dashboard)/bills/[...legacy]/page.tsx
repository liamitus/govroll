import { notFound, permanentRedirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { billHref, billReadHref } from "@/lib/bills/url";

/**
 * Catch-all that handles the legacy integer URL shape
 * (`/bills/4521`, `/bills/4521/read`) by 301-redirecting to the new
 * canonical `/bills/{congress}/{chamber}/{number}-{slug}` URL.
 *
 * The primary route at `[congress]/[chamber]/[numberSlug]/page.tsx`
 * handles 3-segment matches directly (including the Congress.gov
 * word-form alias and non-canonical casing — those redirect via the
 * route's own canonicalization step). This file exists purely for
 * URLs that don't match the new 3-segment shape.
 */

export const dynamic = "force-dynamic";

type RouteParams = Promise<{ legacy: string[] }>;

async function resolveLegacyBill(idString: string) {
  const id = Number(idString);
  if (!Number.isInteger(id) || id <= 0) return null;
  const bill = await prisma.bill.findUnique({
    where: { id },
    select: { billId: true, title: true },
  });
  return bill;
}

export default async function LegacyBillRedirect({
  params,
}: {
  params: RouteParams;
}) {
  const { legacy } = await params;
  if (!legacy || legacy.length === 0) notFound();

  // `/bills/<int>` — old detail page
  if (legacy.length === 1) {
    const bill = await resolveLegacyBill(legacy[0]);
    if (!bill) notFound();
    permanentRedirect(billHref({ billId: bill.billId, title: bill.title }));
  }

  // `/bills/<int>/read` — old reader page
  if (legacy.length === 2 && legacy[1] === "read") {
    const bill = await resolveLegacyBill(legacy[0]);
    if (!bill) notFound();
    permanentRedirect(billReadHref({ billId: bill.billId, title: bill.title }));
  }

  notFound();
}
