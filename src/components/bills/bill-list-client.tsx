"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryStates, parseAsString, parseAsStringLiteral } from "nuqs";
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { BillCard } from "./bill-card";
import { BillGroupCard } from "./bill-group-card";
import { TOPICS } from "@/lib/topic-mapping";
import { useAuth } from "@/hooks/use-auth";
import { useUserPref } from "@/hooks/use-user-pref";
import { groupBills } from "@/lib/bill-grouping";
import { formatOrdinal } from "@/lib/parse-bill-citation";
import {
  billsQueryKey,
  fetchBillsPageClient,
  type BillsFilterState,
} from "@/lib/queries/bills-client";
import type { BillsQueryResult } from "@/lib/queries/bills";
import type { VoteType } from "@/types";

const SORT_OPTIONS = [
  { value: "relevant", label: "Trending" },
  { value: "latest", label: "Latest Activity" },
  { value: "newest", label: "Newest" },
] as const;

const SEARCH_EXAMPLES = ["H.R. 1", "S. 1", "defense"] as const;

const filterParsers = {
  search: parseAsString.withDefault(""),
  chamber: parseAsStringLiteral([
    "both",
    "house",
    "senate",
  ] as const).withDefault("both"),
  status: parseAsString.withDefault(""),
  momentum: parseAsStringLiteral([
    "live",
    "graveyard",
    "all",
  ] as const).withDefault("live"),
  sortBy: parseAsStringLiteral([
    "relevant",
    "latest",
    "newest",
  ] as const).withDefault("relevant"),
  topic: parseAsString.withDefault(""),
};

const filterOptions = {
  history: "replace" as const,
  clearOnDefault: true,
  shallow: true,
  throttleMs: 300,
};

// Pre-server-sync we stored hideVoted in localStorage. Migrate any leftover
// value into the server-backed pref the first time a signed-in user lands
// here, then clear the key. Idempotent — once cleared it never runs again.
const LEGACY_HIDE_VOTED_STORAGE_KEY = "bills:hide-voted";

export function BillListClient() {
  const [rawFilters, setFilters] = useQueryStates(filterParsers, filterOptions);
  const queryFilters: BillsFilterState = rawFilters;

  const observerRef = useRef<HTMLDivElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const { user } = useAuth();
  const { value: hideVoted, setValue: setHideVoted } = useUserPref("hideVoted");

  // One-shot migration of the old localStorage value to the server-backed
  // pref. Runs only when signed in and the legacy key is set to "true";
  // clears the key afterward so subsequent loads skip the work.
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined") return;
    try {
      const legacy = window.localStorage.getItem(LEGACY_HIDE_VOTED_STORAGE_KEY);
      if (legacy === "true") setHideVoted(true);
      if (legacy !== null)
        window.localStorage.removeItem(LEGACY_HIDE_VOTED_STORAGE_KEY);
    } catch {
      // localStorage may be unavailable; nothing we can do — the user just
      // re-toggles once and the new value persists server-side.
    }
  }, [user, setHideVoted]);

  const {
    data,
    error: queryError,
    isLoading,
    isFetching,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    refetch,
  } = useInfiniteQuery<BillsQueryResult>({
    queryKey: billsQueryKey(queryFilters),
    queryFn: ({ pageParam, signal }) =>
      fetchBillsPageClient(queryFilters, pageParam as number, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const fetched = lastPage.page * lastPage.pageSize;
      return fetched < lastPage.total ? lastPage.page + 1 : undefined;
    },
    // Keep the previous filter's data visible while the new one loads —
    // prevents the skeleton flash when toggling a chamber pill.
    placeholderData: keepPreviousData,
  });

  const bills = useMemo(
    () => data?.pages.flatMap((p) => p.bills) ?? [],
    [data],
  );
  const total = data?.pages[0]?.total ?? 0;
  const hiddenByMomentum = data?.pages[0]?.hiddenByMomentum ?? 0;
  const exactMatch = data?.pages[0]?.exactMatch ?? null;
  const citation = data?.pages[0]?.citation ?? null;
  const error = queryError
    ? "Something went wrong loading bills. Please try again."
    : null;
  // The infinite query keeps prior pages during refetch; flag the "initial
  // load" differently from "appending a page" for UX (skeletons vs spinner).
  const isRefetchingFilter =
    isFetching && !isFetchingNextPage && bills.length === 0;
  const isRefiltering = isFetching && !isFetchingNextPage && bills.length > 0;

  // Voted bills — only relevant for signed-in users. Enabled-gated, cached
  // per user. We keep direction so the feed can tint the chip and fade the
  // title Reddit-visited-link style.
  const { data: votedData } = useQuery<{
    votes: Array<{ billId: number; voteType: VoteType }>;
  }>({
    queryKey: ["voted-bills", user?.id ?? null],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/user/voted-bills", {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error("Failed to load voted bills");
      return res.json();
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const userVotes = useMemo(
    () =>
      new Map<number, VoteType>(
        (votedData?.votes ?? []).map((v) => [v.billId, v.voteType]),
      ),
    [votedData],
  );

  const visibleBills = useMemo(
    () => (hideVoted ? bills.filter((b) => !userVotes.has(b.id)) : bills),
    [bills, hideVoted, userVotes],
  );
  const hiddenByVoteCount = hideVoted ? bills.length - visibleBills.length : 0;
  const feedItems = useMemo(() => groupBills(visibleBills), [visibleBills]);

  // Infinite-scroll sentinel: fire fetchNextPage when it scrolls into view.
  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          !isFetching
        ) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isFetching]);

  const activeFilterCount =
    (queryFilters.chamber !== "both" ? 1 : 0) +
    (queryFilters.status !== "" ? 1 : 0);

  const filterPill = (
    label: string,
    value: string,
    current: string,
    key: "chamber" | "status",
    resetTo: string,
  ) => (
    <button
      key={value}
      onClick={() =>
        setFilters({ [key]: current === value ? resetTo : value } as Partial<
          typeof rawFilters
        >)
      }
      className={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-all ${
        current === value
          ? "bg-navy text-white"
          : "text-muted-foreground hover:text-navy hover:bg-navy/5"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Row 1 — Search + Sort (stacks on mobile) */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="relative flex-1">
          <svg
            className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" strokeWidth="2" />
            <path d="m21 21-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            placeholder="Search bills or sponsors..."
            value={queryFilters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="border-border/60 placeholder:text-muted-foreground focus:ring-navy/20 focus:border-navy/20 h-10 w-full rounded-lg border bg-white pr-3 pl-9 text-base focus:ring-2 focus:outline-none"
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilters({ sortBy: opt.value })}
              className={`rounded px-2 py-1 text-xs font-medium transition-all ${
                queryFilters.sortBy === opt.value
                  ? "bg-navy/10 text-navy"
                  : "text-muted-foreground hover:text-navy"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search examples — appear on focus when input is empty */}
      {searchFocused && queryFilters.search === "" && (
        <div className="animate-fade-slide-up flex flex-wrap items-center gap-1.5 px-0.5">
          <span className="text-muted-foreground/70 text-xs">Try:</span>
          {SEARCH_EXAMPLES.map((example) => (
            <button
              key={example}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFilters({ search: example })}
              className="bg-muted/50 text-muted-foreground hover:bg-navy/10 hover:text-navy rounded-full px-2 py-0.5 text-xs transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {/* Row 2 — Topics + Filters toggle */}
      <div className="flex items-center gap-2">
        <div className="scrollbar-hide -mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-0.5">
          <button
            onClick={() => setFilters({ topic: "" })}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              queryFilters.topic === ""
                ? "bg-navy text-white"
                : "bg-muted/50 text-muted-foreground hover:text-navy hover:bg-navy/5"
            }`}
          >
            All Topics
          </button>
          {TOPICS.map((t) => (
            <button
              key={t.label}
              onClick={() =>
                setFilters({
                  topic: queryFilters.topic === t.label ? "" : t.label,
                })
              }
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
                queryFilters.topic === t.label
                  ? "bg-navy text-white"
                  : "bg-muted/50 text-muted-foreground hover:text-navy hover:bg-navy/5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
            showFilters || activeFilterCount > 0
              ? "border-navy/20 bg-navy/5 text-navy"
              : "border-border/50 text-muted-foreground hover:text-navy hover:border-navy/20"
          }`}
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth="2"
          >
            <path strokeLinecap="round" d="M3 6h18M7 12h10M10 18h4" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="bg-navy flex h-4 w-4 items-center justify-center rounded-full text-xs leading-none text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Expandable filter row */}
      {showFilters && (
        <div className="animate-fade-slide-up flex flex-wrap items-center gap-3 pb-2">
          <div className="border-border/50 flex items-center gap-0.5 rounded-full border px-1 py-0.5">
            {filterPill("All", "both", queryFilters.chamber, "chamber", "both")}
            {filterPill(
              "House",
              "house",
              queryFilters.chamber,
              "chamber",
              "both",
            )}
            {filterPill(
              "Senate",
              "senate",
              queryFilters.chamber,
              "chamber",
              "both",
            )}
          </div>

          <div className="border-border/50 flex items-center gap-0.5 rounded-full border px-1 py-0.5">
            {filterPill("Any", "", queryFilters.status, "status", "")}
            {filterPill(
              "Introduced",
              "introduced",
              queryFilters.status,
              "status",
              "",
            )}
            {filterPill(
              "In Progress",
              "in_progress",
              queryFilters.status,
              "status",
              "",
            )}
            {filterPill("Passed", "passed", queryFilters.status, "status", "")}
            {filterPill(
              "Enacted",
              "enacted",
              queryFilters.status,
              "status",
              "",
            )}
            {filterPill("Failed", "failed", queryFilters.status, "status", "")}
          </div>
        </div>
      )}

      {/* Count + hidden bills link */}
      <div className="flex min-h-[24px] items-center justify-between">
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          {isRefiltering && (
            <span className="text-navy/70 inline-flex items-center gap-1.5">
              <span className="border-navy/15 border-t-navy/70 h-3 w-3 animate-spin rounded-full border-2" />
              Updating…
            </span>
          )}
          {!isRefiltering && total > 0 && (
            <>
              <span>
                {`${total.toLocaleString("en-US")} bill${total !== 1 ? "s" : ""}`}
              </span>
              {queryFilters.momentum === "live" && hiddenByMomentum > 0 && (
                <button
                  onClick={() => setFilters({ momentum: "all" })}
                  className="text-muted-foreground/70 hover:text-navy underline decoration-dotted underline-offset-2 transition-colors"
                >
                  {`(${hiddenByMomentum.toLocaleString("en-US")} dormant or dead hidden)`}
                </button>
              )}
              {queryFilters.momentum === "all" && (
                <button
                  onClick={() => setFilters({ momentum: "live" })}
                  className="text-muted-foreground/70 hover:text-navy underline decoration-dotted underline-offset-2 transition-colors"
                >
                  (show active only)
                </button>
              )}
              {user && userVotes.size > 0 && (
                <button
                  onClick={() => setHideVoted(!hideVoted)}
                  className="text-muted-foreground/70 hover:text-navy underline decoration-dotted underline-offset-2 transition-colors"
                >
                  {hideVoted
                    ? `(${hiddenByVoteCount} voted hidden)`
                    : "(hide voted)"}
                </button>
              )}
            </>
          )}
        </p>
      </div>

      {/* Jump-to row — when the user typed a bill citation. Sits above
          the main feed so they can still browse other results. */}
      {citation && (
        <div className="animate-fade-slide-up">
          <div className="text-muted-foreground mb-1.5 px-0.5 text-[11px] font-medium tracking-wide uppercase">
            {exactMatch ? (
              <>
                Jump to {citation.shortLabel} {citation.number}
                {citation.congress !== null &&
                  ` · ${formatOrdinal(citation.congress)} Congress`}
              </>
            ) : (
              <>
                No bill found for {citation.shortLabel} {citation.number}
                {citation.congress !== null &&
                  ` · ${formatOrdinal(citation.congress)} Congress`}
              </>
            )}
          </div>
          {exactMatch && (
            <div className="border-navy/20 hover:border-navy/40 rounded-lg border border-dashed transition-colors">
              <BillCard
                bill={exactMatch}
                userVote={userVotes.get(exactMatch.id) ?? null}
              />
            </div>
          )}
        </div>
      )}

      {/* Bill list */}
      <div
        className={`space-y-2 transition-opacity duration-150 ${
          isRefiltering ? "pointer-events-none opacity-40" : ""
        }`}
        aria-busy={isRefiltering}
      >
        {feedItems.map((item, i) => {
          const key =
            item.kind === "single"
              ? `bill-${item.bill.id}`
              : `group-${item.key}`;
          return (
            <div
              key={key}
              className="animate-fade-slide-up"
              style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
            >
              {item.kind === "single" ? (
                <BillCard
                  bill={item.bill}
                  userVote={userVotes.get(item.bill.id) ?? null}
                />
              ) : (
                <BillGroupCard bills={item.bills} userVotes={userVotes} />
              )}
            </div>
          );
        })}
      </div>

      {(isLoading || isRefetchingFilter) && bills.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-border/50 relative overflow-hidden rounded-lg border bg-white px-5 py-4"
              aria-hidden
            >
              <div className="bg-muted absolute top-0 bottom-0 left-0 w-1 rounded-l-lg" />
              <div className="space-y-2.5 pl-3">
                <div
                  className="bg-muted/60 h-4 rounded motion-safe:animate-pulse"
                  style={{ width: `${70 - i * 3}%` }}
                />
                <div
                  className="bg-muted/40 h-3 rounded motion-safe:animate-pulse"
                  style={{ width: `${55 - i * 2}%` }}
                />
                <div className="flex items-center gap-2 pt-1">
                  <div className="bg-muted/50 h-3 w-10 rounded motion-safe:animate-pulse" />
                  <div className="bg-muted/40 h-4 w-16 rounded motion-safe:animate-pulse" />
                  <div className="bg-muted/40 h-4 w-14 rounded motion-safe:animate-pulse" />
                  <div className="bg-muted/30 h-3 w-20 rounded motion-safe:animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isFetchingNextPage && (
        <div className="flex justify-center py-6">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <div className="border-navy/15 border-t-navy/60 h-4 w-4 animate-spin rounded-full border-2" />
            Loading more…
          </div>
        </div>
      )}

      {error && (
        <div className="border-border/60 bg-muted/30 space-y-3 rounded-lg border p-6 text-center">
          <p className="text-muted-foreground text-base">{error}</p>
          <button
            onClick={() => refetch()}
            className="text-navy border-border/60 hover:bg-navy/5 inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!isLoading && !error && bills.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-muted-foreground text-base">
            No bills found matching your filters.
          </p>
        </div>
      )}

      <div ref={observerRef} className="h-4" />
    </div>
  );
}
