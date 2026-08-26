"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAddress } from "@/hooks/use-address";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import Link from "next/link";

export function AddressHero() {
  const [inputValue, setInputValue] = useState("");
  const { address, setUserAddress, isLoaded } = useAddress();
  const router = useRouter();

  // Redirect returning users
  useEffect(() => {
    if (isLoaded && address) {
      router.push("/bills");
    }
  }, [isLoaded, address, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      setUserAddress(inputValue.trim());
      router.push("/bills");
    }
  };

  return (
    <div className="bg-sand relative flex h-[calc(100dvh-3.5rem)] flex-col items-center justify-center px-4">
      <div className="w-full max-w-xl space-y-10 text-center">
        <div className="space-y-5">
          <p className="text-sapphire-deep text-[11px] font-bold tracking-[0.18em] uppercase">
            Find your representatives
          </p>
          <h1 className="text-ink text-5xl leading-[1.02] font-bold sm:text-6xl">
            See what your
            <br />
            representatives
            <br />
            are doing
          </h1>

          {/* Route motif — a bill is a route: cleared track, current
              position (the gold node), untravelled track ahead. */}
          <div className="mx-auto flex w-48 items-center" aria-hidden="true">
            <div className="bg-sapphire h-px flex-1" />
            <span className="bg-sapphire h-1.5 w-1.5 rounded-full" />
            <div className="bg-sapphire h-px flex-1" />
            <span className="bg-sapphire h-1.5 w-1.5 rounded-full" />
            <div className="bg-sapphire h-px flex-1" />
            <span className="brand-node" />
            <div className="bg-hollow h-px flex-1" />
          </div>

          <p className="text-ink-muted mx-auto max-w-sm text-lg leading-relaxed">
            Plain-language bill summaries. See how your reps actually voted.
            Call them with one tap.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="border-rule bg-paper space-y-3 border p-4 sm:p-5"
        >
          <div className="relative">
            <AddressAutocomplete
              value={inputValue}
              onChange={setInputValue}
              onSelect={(addr) => {
                setInputValue(addr);
                setUserAddress(addr);
                router.push("/bills");
              }}
              className="border-rule bg-paper placeholder:text-ink-muted focus:border-ink h-14 w-full border px-5 pr-24 text-base transition-colors focus:outline-none"
              autoFocus
            />
            <button
              type="submit"
              className="bg-sapphire-deep text-paper hover:bg-ink absolute top-1/2 right-2 z-10 h-10 -translate-y-1/2 px-5 text-base font-semibold tracking-wide transition-colors"
            >
              Go
            </button>
          </div>
          <p className="text-ink-muted text-sm tracking-wide">
            We don&apos;t store your address. It stays on your device.{" "}
            <Link
              href="/privacy"
              className="hover:text-ink underline underline-offset-2"
            >
              Privacy policy
            </Link>
          </p>
        </form>

        <div className="pt-2">
          <Link
            href="/bills"
            className="text-ink-muted hover:text-ink inline-flex items-center gap-2 text-sm font-medium tracking-wide uppercase transition-colors"
          >
            <div className="h-px w-6 bg-current" />
            Browse all bills
            <div className="h-px w-6 bg-current" />
          </Link>
        </div>
      </div>
    </div>
  );
}
