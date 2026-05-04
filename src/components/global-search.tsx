"use client";

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { partyColor } from "@/lib/representative-utils";
import { pickBillHeadline } from "@/lib/bill-headline";
import { billHref } from "@/lib/bills/url";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { RepPhoto } from "@/components/representatives/rep-photo";
import type { GlobalSearchResponse } from "@/app/api/search/route";
import type { BillSummary } from "@/types";
import type { RepSearchResult } from "@/lib/queries/representatives";

const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

// Flattened, navigable result list. The dropdown renders sections, but
// keyboard arrows traverse the whole list — building a single ordered
// array is the simplest way to keep the cursor index honest across
// section boundaries (and the "see all" rows).
type FlatItem =
  | { kind: "rep"; href: string; rep: RepSearchResult }
  | { kind: "bill"; href: string; bill: BillSummary }
  | { kind: "see-all-bills"; href: string };

function repHref(rep: { slug: string | null; bioguideId: string }): string {
  return `/representatives/${rep.slug ?? rep.bioguideId}`;
}

function flatten(
  results: GlobalSearchResponse | null,
  query: string,
): FlatItem[] {
  if (!results) return [];
  const out: FlatItem[] = [];
  for (const rep of results.representatives) {
    out.push({ kind: "rep", href: repHref(rep), rep });
  }
  if (results.exactBill) {
    out.push({
      kind: "bill",
      href: billHref(results.exactBill),
      bill: results.exactBill,
    });
  }
  for (const bill of results.bills) {
    if (results.exactBill && bill.id === results.exactBill.id) continue;
    out.push({ kind: "bill", href: billHref(bill), bill });
  }
  if (results.bills.length > 0 || results.exactBill) {
    out.push({
      kind: "see-all-bills",
      href: `/bills?search=${encodeURIComponent(query)}`,
    });
  }
  return out;
}

interface SearchState {
  query: string;
  results: GlobalSearchResponse | null;
  phase: "idle" | "loading" | "done";
  setQuery: (q: string) => void;
  reset: () => void;
}

function useSearchState(): SearchState {
  const [query, setQueryRaw] = useState("");
  const [results, setResults] = useState<GlobalSearchResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Stamp + check ensures the most recent query wins when responses
  // arrive out of order. AbortController already covers the common case;
  // this guards the rare "two requests both completed before either
  // resolved" edge.
  const seqRef = useRef(0);

  const fetchResults = useCallback(async (q: string, seq: number) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data: GlobalSearchResponse = await res.json();
      if (seq !== seqRef.current) return;
      setResults(data);
      setPhase("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Header search is not load-bearing — log and move on.
      console.error("global search failed", e);
    }
  }, []);

  const setQuery = useCallback(
    (value: string) => {
      setQueryRaw(value);
      const trimmed = value.trim();
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (trimmed.length < MIN_QUERY) {
        setPhase("idle");
        setResults(null);
        seqRef.current += 1;
        return;
      }

      seqRef.current += 1;
      const seq = seqRef.current;
      if (!results) setPhase("loading");
      debounceRef.current = setTimeout(
        () => fetchResults(trimmed, seq),
        DEBOUNCE_MS,
      );
    },
    [fetchResults, results],
  );

  const reset = useCallback(() => {
    setQueryRaw("");
    setResults(null);
    setPhase("idle");
    seqRef.current += 1;
    abortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return { query, results, phase, setQuery, reset };
}

interface SearchInputProps {
  state: SearchState;
  variant: "desktop" | "sheet";
  autoFocus?: boolean;
  onNavigate?: () => void;
}

/**
 * The actual search input + dropdown, shared between the desktop header and
 * the mobile sheet. `variant` controls chrome only — keyboard handling and
 * data flow are identical so a user typing the same query in either place
 * sees the same suggestions.
 */
function SearchInput({
  state,
  variant,
  autoFocus,
  onNavigate,
}: SearchInputProps) {
  const router = useRouter();
  const { query, results, phase, setQuery, reset } = state;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [dismissed, setDismissed] = useState(false);

  const items = useMemo(() => flatten(results, query), [results, query]);

  // Derived-state pattern (React 19): when query or results identity
  // changes, reset the cursor and un-dismiss without scheduling an
  // extra render. Tracking the previous values inline avoids the
  // effect-with-setState cascade that the lint rule flags.
  const [prevQuery, setPrevQuery] = useState(query);
  const [prevResults, setPrevResults] = useState(results);
  if (prevQuery !== query) {
    setPrevQuery(query);
    setActiveIndex(-1);
    setDismissed(false);
  }
  if (prevResults !== results) {
    setPrevResults(results);
    setActiveIndex(-1);
  }

  // Click outside collapses the desktop dropdown. The mobile sheet has
  // its own dismiss path (overlay click / X button) so we skip this
  // listener inside the sheet variant.
  useEffect(() => {
    if (variant !== "desktop") return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDismissed(true);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [variant]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        navigateTo(items[activeIndex].href);
      } else if (query.trim().length >= MIN_QUERY) {
        // No highlighted item — send the user to the bills search page so
        // pressing Enter never feels like a dead end.
        navigateTo(`/bills?search=${encodeURIComponent(query.trim())}`);
      }
    } else if (e.key === "Escape") {
      if (variant === "desktop") {
        setDismissed(true);
        inputRef.current?.blur();
      }
    }
  };

  const navigateTo = (href: string) => {
    router.push(href);
    reset();
    setDismissed(true);
    onNavigate?.();
  };

  // Desktop: collapse when query is empty or user dismissed.
  // Sheet: always show the surface; an empty state guides the user.
  const showDropdown =
    variant === "sheet" ||
    (!dismissed && (phase === "loading" || phase === "done"));

  const inputClasses =
    variant === "desktop"
      ? "h-9 w-full rounded-full border border-white/15 bg-white/5 pl-9 pr-9 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:bg-white/10 focus:outline-none focus:ring-0"
      : "border-border/80 h-11 w-full rounded-lg border bg-white pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:border-navy/40 focus:outline-none";

  const iconClasses =
    variant === "desktop"
      ? "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/50"
      : "pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground";

  const clearClasses =
    variant === "desktop"
      ? "absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/40 hover:bg-white/10 hover:text-white/80"
      : "absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground";

  return (
    <div
      ref={containerRef}
      className={cn("relative", variant === "desktop" && "w-full")}
    >
      <div className="relative">
        <Search className={iconClasses} aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setDismissed(false)}
          placeholder="Search bills or members"
          className={inputClasses}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={showDropdown && items.length > 0}
          aria-controls="global-search-listbox"
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `global-search-item-${activeIndex}` : undefined
          }
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              reset();
              inputRef.current?.focus();
            }}
            className={clearClasses}
            aria-label="Clear search"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {showDropdown && (
        <SearchResults
          items={items}
          phase={phase}
          query={query}
          activeIndex={activeIndex}
          setActiveIndex={setActiveIndex}
          onSelect={navigateTo}
          variant={variant}
        />
      )}
    </div>
  );
}

interface SearchResultsProps {
  items: FlatItem[];
  phase: SearchState["phase"];
  query: string;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  onSelect: (href: string) => void;
  variant: "desktop" | "sheet";
}

function SearchResults({
  items,
  phase,
  query,
  activeIndex,
  setActiveIndex,
  onSelect,
  variant,
}: SearchResultsProps) {
  const reps = items.filter(
    (i): i is Extract<FlatItem, { kind: "rep" }> => i.kind === "rep",
  );
  const billItems = items.filter(
    (i): i is Extract<FlatItem, { kind: "bill" }> => i.kind === "bill",
  );
  const seeAllBills = items.find((i) => i.kind === "see-all-bills");

  const wrapperClasses =
    variant === "desktop"
      ? "border-border/80 absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[70vh] overflow-y-auto rounded-xl border bg-white py-2 shadow-xl"
      : "mt-3 max-h-[70vh] overflow-y-auto";

  if (phase === "loading" && items.length === 0) {
    return (
      <div className={wrapperClasses} id="global-search-listbox" role="listbox">
        {[0, 1, 2].map((i) => (
          <div key={i} className="px-4 py-3" role="presentation">
            <div
              className="bg-muted/60 h-4 animate-pulse rounded-md"
              style={{ width: `${75 - i * 15}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (
    phase === "done" &&
    items.length === 0 &&
    query.trim().length >= MIN_QUERY
  ) {
    return (
      <div className={wrapperClasses} id="global-search-listbox" role="listbox">
        <div className="text-muted-foreground px-4 py-6 text-center text-sm">
          No matches for{" "}
          <span className="text-foreground font-medium">
            &ldquo;{query.trim()}&rdquo;
          </span>
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={wrapperClasses} id="global-search-listbox" role="listbox">
      {reps.length > 0 && <SectionHeader>Members</SectionHeader>}
      {reps.map((item) => {
        const idx = items.indexOf(item);
        return (
          <RepRow
            key={`rep-${item.rep.bioguideId}`}
            id={`global-search-item-${idx}`}
            rep={item.rep}
            active={idx === activeIndex}
            onMouseEnter={() => setActiveIndex(idx)}
            onSelect={() => onSelect(item.href)}
          />
        );
      })}

      {billItems.length > 0 && <SectionHeader>Bills</SectionHeader>}
      {billItems.map((item) => {
        const idx = items.indexOf(item);
        return (
          <BillRow
            key={`bill-${item.bill.id}`}
            id={`global-search-item-${idx}`}
            bill={item.bill}
            active={idx === activeIndex}
            onMouseEnter={() => setActiveIndex(idx)}
            onSelect={() => onSelect(item.href)}
          />
        );
      })}

      {seeAllBills && (
        <SeeAllRow
          id={`global-search-item-${items.indexOf(seeAllBills)}`}
          query={query}
          active={items.indexOf(seeAllBills) === activeIndex}
          onMouseEnter={() => setActiveIndex(items.indexOf(seeAllBills))}
          onSelect={() => onSelect(seeAllBills.href)}
        />
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground px-4 pt-2 pb-1 text-[10px] font-semibold tracking-widest uppercase">
      {children}
    </div>
  );
}

interface RepRowProps {
  id: string;
  rep: RepSearchResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}

function RepRow({ id, rep, active, onMouseEnter, onSelect }: RepRowProps) {
  const colors = partyColor(rep.party);
  const chamberAndDistrict =
    rep.chamber === "senator"
      ? `Senator · ${rep.state}`
      : rep.district
        ? `Representative · ${rep.state}-${rep.district}`
        : `Representative · ${rep.state}`;

  return (
    <Link
      href={repHref(rep)}
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        // Prevent input blur before navigation fires.
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors",
        active ? "bg-navy/[0.06]" : "hover:bg-muted/40",
      )}
    >
      <div className="bg-muted relative size-9 flex-shrink-0 overflow-hidden rounded-full">
        <RepPhoto
          bioguideId={rep.bioguideId}
          firstName={rep.firstName}
          lastName={rep.lastName}
          imgClassName="object-cover object-top"
          fallbackClassName="text-xs font-medium"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate font-medium">
          {rep.firstName} {rep.lastName}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {chamberAndDistrict}
        </div>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
          colors.badge,
        )}
      >
        {rep.party.replace("Democratic", "Democrat").slice(0, 3)}
      </span>
    </Link>
  );
}

interface BillRowProps {
  id: string;
  bill: BillSummary;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}

function BillRow({ id, bill, active, onMouseEnter, onSelect }: BillRowProps) {
  const headline = pickBillHeadline(bill);
  const citation = formatBillCitation(bill.billId);

  return (
    <Link
      href={billHref(bill)}
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onMouseEnter}
      className={cn(
        "flex cursor-pointer flex-col gap-0.5 px-4 py-2.5 text-sm transition-colors",
        active ? "bg-navy/[0.06]" : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        {citation && (
          <span className="text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 font-mono text-[11px]">
            {citation}
          </span>
        )}
        <span className="text-foreground line-clamp-1 font-medium">
          {headline.headline}
        </span>
      </div>
      {bill.currentStatus && (
        <div className="text-muted-foreground truncate pl-1 text-xs">
          {bill.currentStatus.replace(/_/g, " ")}
        </div>
      )}
    </Link>
  );
}

interface SeeAllRowProps {
  id: string;
  query: string;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}

function SeeAllRow({
  id,
  query,
  active,
  onMouseEnter,
  onSelect,
}: SeeAllRowProps) {
  return (
    <Link
      href={`/bills?search=${encodeURIComponent(query)}`}
      id={id}
      role="option"
      aria-selected={active}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onMouseEnter}
      className={cn(
        "border-border/60 mt-1 flex cursor-pointer items-center justify-between border-t px-4 py-2.5 text-sm transition-colors",
        active ? "bg-navy/[0.06]" : "hover:bg-muted/40",
      )}
    >
      <span className="text-foreground font-medium">See all bill matches</span>
      <span className="text-muted-foreground text-xs">&rarr;</span>
    </Link>
  );
}

/**
 * GovTrack-style billId ("senate_bill-3706-118") → "S. 3706" for the
 * dropdown row. The full citation parser lives in parse-bill-citation.ts
 * but it's tuned for input parsing; this is the inverse and only needs
 * to handle the eight bill types we ingest.
 */
function formatBillCitation(billId: string): string | null {
  const lastDash = billId.lastIndexOf("-");
  if (lastDash === -1) return null;
  const rest = billId.slice(0, lastDash);
  const secondLastDash = rest.lastIndexOf("-");
  if (secondLastDash === -1) return null;
  const number = rest.slice(secondLastDash + 1);
  const billType = rest.slice(0, secondLastDash);
  const labels: Record<string, string> = {
    house_bill: "H.R.",
    senate_bill: "S.",
    house_joint_resolution: "H.J. Res.",
    senate_joint_resolution: "S.J. Res.",
    house_concurrent_resolution: "H. Con. Res.",
    senate_concurrent_resolution: "S. Con. Res.",
    house_resolution: "H. Res.",
    senate_resolution: "S. Res.",
  };
  const label = labels[billType];
  if (!label) return null;
  return `${label} ${number}`;
}

/**
 * Header search. Renders a visible input on md+ and a search-icon trigger
 * that opens a sheet on smaller screens. Both presentations share state
 * via a hook so a query started in one isn't lost when the viewport
 * changes (rotate phone, resize window).
 */
export function GlobalSearch() {
  const desktopState = useSearchState();
  const mobileState = useSearchState();
  const [sheetOpen, setSheetOpen] = useState(false);

  // `/` focuses the desktop input, GitHub-style. Skipped when the user
  // is already in a text input or contenteditable so writing about
  // fractions doesn't hijack focus.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      const desktopInput = document.querySelector<HTMLInputElement>(
        '[data-global-search-input="desktop"]',
      );
      if (desktopInput) {
        e.preventDefault();
        desktopInput.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      {/* Desktop: visible input in the navbar */}
      <div className="hidden max-w-md flex-1 md:block">
        <div data-global-search-wrapper="desktop">
          <SearchInputWithDataAttr
            state={desktopState}
            variant="desktop"
            attr="desktop"
          />
        </div>
      </div>

      {/* Mobile: icon button → sheet */}
      <div className="md:hidden">
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <button
                type="button"
                aria-label="Search"
                className="flex size-8 cursor-pointer items-center justify-center rounded text-white/60 transition-colors hover:bg-white/5 hover:text-white"
              />
            }
          >
            <Search className="size-[18px]" />
          </SheetTrigger>
          <SheetContent showCloseButton={false} className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchInputWithDataAttr
                  state={mobileState}
                  variant="sheet"
                  attr="mobile"
                  autoFocus
                  onNavigate={() => setSheetOpen(false)}
                />
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="text-muted-foreground hover:text-foreground rounded px-2 py-1 text-sm"
              >
                Cancel
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

/**
 * Wrap SearchInput so we can stamp a data attr on the underlying <input>
 * without polluting the SearchInput API surface — only used by the `/`
 * focus shortcut to find the desktop input.
 */
function SearchInputWithDataAttr({
  attr,
  ...props
}: SearchInputProps & { attr: "desktop" | "mobile" }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const input = wrapperRef.current?.querySelector("input");
    if (input) input.setAttribute("data-global-search-input", attr);
  }, [attr]);
  return (
    <div ref={wrapperRef}>
      <SearchInput {...props} />
    </div>
  );
}
