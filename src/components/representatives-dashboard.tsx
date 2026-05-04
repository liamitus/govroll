"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAddress } from "@/hooks/use-address";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { RepPhoto } from "@/components/representatives/rep-photo";
import {
  partyColor,
  chamberLabel,
  nextElection,
} from "@/lib/representative-utils";
import {
  fetchRepsByAddress,
  repsByAddressQueryKey,
  type RepByAddress,
} from "@/lib/queries/representatives-client";

/** "123 Main St, Springfield, IL 62704" → "Springfield, IL" */
function shortAddress(full: string): string {
  const parts = full.split(",").map((s) => s.trim());
  if (parts.length < 2) return full;
  const stateZip = parts[parts.length - 1]; // "IL 62704" or "IL"
  const city = parts[parts.length - 2]; // "Springfield"
  const state = stateZip.replace(/\d{5}(-\d{4})?/, "").trim();
  return state ? `${city}, ${state}` : city;
}

type Rep = RepByAddress;

export function RepresentativesDashboard() {
  const { address, setUserAddress, isLoaded } = useAddress();
  const [editAddress, setEditAddress] = useState(false);
  const [inputAddr, setInputAddr] = useState("");

  const {
    data: reps = [],
    isFetching,
    isError,
    refetch,
  } = useQuery<Rep[]>({
    queryKey: repsByAddressQueryKey(address),
    queryFn: ({ signal }) => fetchRepsByAddress(address, signal),
    enabled: isLoaded && !!address,
    // Address-keyed queries are cheap to cache — the same address will
    // almost certainly resolve to the same reps within the 5-minute
    // window, so refetchOnFocus isn't useful here.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const loading = isFetching && reps.length === 0;
  const error = isError
    ? "Could not find representatives for this address."
    : "";

  if (!isLoaded) return null;

  if (!address) {
    return (
      <div className="border-navy/10 civic-pattern relative overflow-hidden rounded-lg border bg-white">
        <div className="relative px-6 py-12 text-center sm:py-14">
          <div className="text-civic-gold/30 mx-auto mb-6 flex items-center justify-center gap-3">
            <div className="bg-civic-gold/30 h-px w-10" />
            <span className="text-sm">&#9733;</span>
            <div className="bg-civic-gold/30 h-px w-10" />
          </div>

          <p className="text-navy/70 mb-3 text-xs font-semibold tracking-[0.3em] uppercase">
            Your Representatives
          </p>
          <h2 className="text-navy mx-auto max-w-md text-2xl leading-[1.15] font-bold tracking-tight sm:text-3xl">
            See who speaks for you in Congress
          </h2>
          <p className="text-muted-foreground mx-auto mt-3 max-w-sm text-base leading-relaxed">
            Enter your address to see your senators and representative.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputAddr.trim()) setUserAddress(inputAddr.trim());
            }}
            className="mx-auto mt-7 max-w-md"
          >
            <div className="relative">
              <AddressAutocomplete
                value={inputAddr}
                onChange={setInputAddr}
                onSelect={(addr) => {
                  setInputAddr(addr);
                  setUserAddress(addr);
                }}
                placeholder="Your US street address"
                className="border-navy/10 placeholder:text-muted-foreground focus:border-navy/30 focus:ring-navy/5 h-12 w-full rounded-md border-2 bg-white px-4 pr-24 text-base transition-all focus:ring-4 focus:outline-none"
              />
              <button className="bg-navy hover:bg-navy-light absolute top-1/2 right-1.5 z-10 h-9 -translate-y-1/2 rounded px-4 text-sm font-medium tracking-wide text-white transition-colors">
                Look up
              </button>
            </div>
            <p className="text-muted-foreground mt-3 text-xs tracking-wide">
              We don&apos;t store your address. It stays on your device.{" "}
              <Link
                href="/privacy"
                className="hover:text-navy underline underline-offset-2 transition-colors"
              >
                Privacy policy
              </Link>
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-navy/70 text-base font-semibold tracking-[0.2em] uppercase">
            Your Representatives
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {editAddress ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const trimmed = inputAddr.trim();
                // Empty submit clears the saved address.
                setUserAddress(trimmed);
                setEditAddress(false);
              }}
              className="flex gap-1.5"
            >
              <AddressAutocomplete
                value={inputAddr}
                onChange={setInputAddr}
                onSelect={(addr) => {
                  setInputAddr(addr);
                  setUserAddress(addr);
                  setEditAddress(false);
                }}
                className="border-input focus:ring-navy/30 h-7 w-52 rounded border px-2 text-sm focus:ring-2 focus:outline-none"
                autoFocus
              />
              <button className="bg-navy hover:bg-navy-light h-7 rounded px-2 text-sm text-white">
                {inputAddr.trim() ? "Update" : "Clear"}
              </button>
              <button
                type="button"
                onClick={() => setEditAddress(false)}
                className="text-muted-foreground hover:text-foreground h-7 px-2 text-sm"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => {
                setInputAddr(address);
                setEditAddress(true);
              }}
              className="text-muted-foreground hover:text-navy text-sm transition-colors"
            >
              <span className="inline-block align-bottom" title={address}>
                {shortAddress(address)}
              </span>{" "}
              &middot; change
            </button>
          )}
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-muted h-40 animate-pulse rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <div className="border-border/60 bg-muted/30 space-y-3 rounded-lg border p-6 text-center">
          <p className="text-muted-foreground text-base">{error}</p>
          <p className="text-muted-foreground/80 mx-auto max-w-sm text-sm">
            Our geocoder occasionally rejects addresses it doesn&apos;t
            recognize. Try adding the ZIP code, removing an apartment number, or
            using a nearby street address.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button
              onClick={() => refetch()}
              className="text-navy border-border/60 hover:bg-navy/5 inline-flex items-center gap-1.5 rounded-md border bg-white px-3 py-1.5 text-xs font-medium transition-colors"
            >
              Try again
            </button>
            <button
              onClick={() => {
                setInputAddr("");
                setUserAddress("");
              }}
              className="text-muted-foreground hover:text-navy inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
            >
              Enter a different address
            </button>
          </div>
        </div>
      )}

      {/* Rep Cards */}
      {!loading && !error && reps.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {reps.map((rep, i) => {
            const colors = partyColor(rep.party);
            return (
              <Link
                key={rep.bioguideId || i}
                href={`/representatives/${rep.slug || rep.bioguideId}`}
                className={`border-border/60 relative flex flex-col overflow-hidden rounded-lg border bg-white ${colors.bar} animate-fade-slide-up hover:border-navy/20 cursor-pointer transition-all hover:shadow-md`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="flex-1 p-4">
                  <div className="flex gap-3.5">
                    {/* 4:5 portrait — object-position: center 20% avoids ceiling/forehead extremes */}
                    <div className="bg-muted relative h-20 w-16 flex-shrink-0 overflow-hidden rounded-md">
                      <RepPhoto
                        bioguideId={rep.bioguideId ?? null}
                        firstName={rep.firstName}
                        lastName={rep.lastName}
                        alt={rep.name}
                        imgClassName="object-[center_20%]"
                        fallbackClassName="text-lg font-medium"
                      />
                    </div>

                    {/* Info — name is primary, everything else is muted */}
                    <div className="min-w-0 flex-1">
                      <p className="text-navy text-base leading-snug font-semibold">
                        {rep.firstName} {rep.lastName}
                      </p>
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {chamberLabel(rep.chamber)} · {rep.state}
                        {rep.district ? `-${rep.district}` : ""}
                      </p>

                      <div className="mt-2 flex items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${colors.badge}`}
                        >
                          {rep.party.replace("Democratic", "Democrat")}
                        </span>
                      </div>

                      <p className="text-muted-foreground mt-1.5 text-xs">
                        Next election {nextElection(rep.chamber)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Phone CTA — pinned to bottom, always aligned across cards */}
                {rep.phone && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.href = `tel:${rep.phone}`;
                    }}
                    className="text-navy/80 hover:text-navy hover:bg-navy/5 mx-2.5 mb-2.5 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-base font-medium transition-colors"
                  >
                    <svg
                      className="h-4 w-4 flex-shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    {rep.phone}
                  </button>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
