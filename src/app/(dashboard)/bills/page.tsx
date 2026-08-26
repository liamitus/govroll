import { Suspense } from "react";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { BillListClient } from "@/components/bills/bill-list-client";
import { RepresentativesDashboard } from "@/components/representatives-dashboard";
import { SystemBanner } from "@/components/system-banner";
import { getServerQueryClient } from "@/lib/query-client";
import { fetchBillsPage } from "@/lib/queries/bills";
import {
  BILLS_PAGE_SIZE,
  billsQueryKey,
  type BillsFilterState,
} from "@/lib/queries/bills-client";
import type { BillsQueryResult } from "@/lib/queries/bills";

export const metadata = {
  title: "Bills — Govroll",
  description: "Browse current government bills, filter by chamber and status.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function pickString(sp: SearchParams, key: string): string {
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

function pickOneOf<T extends string>(
  sp: SearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = sp[key];
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
    return v as T;
  }
  return fallback;
}

function filtersFromSearchParams(sp: SearchParams): BillsFilterState {
  return {
    search: pickString(sp, "search"),
    chamber: pickOneOf(sp, "chamber", ["both", "house", "senate"], "both"),
    status: pickString(sp, "status"),
    momentum: pickOneOf(sp, "momentum", ["live", "graveyard", "all"], "live"),
    sortBy: pickOneOf(
      sp,
      "sortBy",
      ["relevant", "latest", "newest"],
      "relevant",
    ),
    topic: pickString(sp, "topic"),
  };
}

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const filters = filtersFromSearchParams(sp);

  // Prefetch page 1 server-side so the first paint has bills already —
  // dehydrate into the client TanStack cache under the same queryKey
  // useInfiniteQuery uses, which avoids a refetch on mount.
  const queryClient = getServerQueryClient();
  await queryClient.prefetchInfiniteQuery<
    BillsQueryResult,
    Error,
    { pages: BillsQueryResult[]; pageParams: number[] },
    ReturnType<typeof billsQueryKey>,
    number
  >({
    queryKey: billsQueryKey(filters),
    queryFn: () =>
      fetchBillsPage({ ...filters, page: 1, limit: BILLS_PAGE_SIZE }),
    initialPageParam: 1,
  });
  const dehydratedState = dehydrate(queryClient);

  return (
    <>
      {/* System banner — full-bleed, directly under the nav. Shows only
          when there's a session-status fact worth explaining (recess). */}
      <SystemBanner />

      <div className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        {/* Representatives section — the hero */}
        <RepresentativesDashboard />

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="bg-rule h-px flex-1" />
          <span className="text-ink-muted text-[11px] font-bold tracking-[0.18em] uppercase">
            Legislation
          </span>
          <div className="bg-rule h-px flex-1" />
        </div>

        {/* Bills feed — Suspense boundary is required because BillListClient
          reads search params via nuqs; Next.js needs a fallback to prerender. */}
        <HydrationBoundary state={dehydratedState}>
          <Suspense fallback={null}>
            <BillListClient />
          </Suspense>
        </HydrationBoundary>
      </div>
    </>
  );
}
