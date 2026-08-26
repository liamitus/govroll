"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface Suggestion {
  label: string;
  isRawInput?: boolean;
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Your home address, US",
  className = "",
  autoFocus = false,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [dismissed, setDismissed] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([]);
      setPhase("idle");
      return;
    }

    // Photon/OSM often lacks house-level data for specific residential
    // addresses (e.g. "33 Royal St, Providence RI") and returns same-
    // house-number-different-street matches instead. If the user typed a
    // house number + a street name that Photon doesn't have an exact match
    // for, we offer their raw query as a selectable option — the backend
    // geocoder (Geocodio) resolves these correctly even when Photon can't.
    const queryMatch = query.trim().match(/^(\d+(?:-\d+)?[a-z]?)\s+([a-z]+)/i);
    const userHouseNumber = queryMatch?.[1].toLowerCase();
    const userStreetHint = queryMatch?.[2].toLowerCase();

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Call Photon directly from the browser — no API key needed,
      // avoids Vercel serverless cold-start latency (~0.5s vs ~8s).
      const params = new URLSearchParams({
        q: query,
        limit: "5",
        lang: "en",
        lat: "39.8",
        lon: "-98.5",
      });
      const res = await fetch(
        `https://photon.komoot.io/api/?${params}&layer=house&layer=street`,
        { signal: controller.signal },
      );
      if (!res.ok) return;

      interface PhotonFeature {
        properties: {
          name?: string;
          housenumber?: string;
          street?: string;
          city?: string;
          state?: string;
          postcode?: string;
          countrycode?: string;
        };
      }
      const data: { features: PhotonFeature[] } = await res.json();

      const results: Suggestion[] = data.features
        .filter((f) => f.properties.countrycode?.toLowerCase() === "us")
        .map((f) => {
          const p = f.properties;
          const street = [p.housenumber, p.street || p.name]
            .filter(Boolean)
            .join(" ");
          const parts = [
            street,
            p.city,
            [p.state, p.postcode].filter(Boolean).join(" "),
          ].filter(Boolean);
          return { label: parts.join(", ") };
        });

      // Prepend raw query when no Photon result matches both the typed house
      // number AND the typed street. Clicking it submits as-typed to the
      // backend geocoder, which handles addresses Photon/OSM doesn't index.
      const photonHasExactMatch =
        userHouseNumber &&
        userStreetHint &&
        data.features.some((f) => {
          if (f.properties.countrycode?.toLowerCase() !== "us") return false;
          if (f.properties.housenumber?.toLowerCase() !== userHouseNumber)
            return false;
          const street = (
            f.properties.street ||
            f.properties.name ||
            ""
          ).toLowerCase();
          return new RegExp(`\\b${userStreetHint}\\b`).test(street);
        });
      if (userHouseNumber && userStreetHint && !photonHasExactMatch) {
        results.unshift({ label: query.trim(), isRawInput: true });
      }

      setSuggestions(results);
      setPhase("done");
      setActiveIndex(-1);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setDismissed(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length >= 3) {
      // Only show shimmer if we don't already have suggestions visible.
      // This prevents flicker when typing more chars with results on screen.
      if (suggestions.length === 0) {
        setPhase("loading");
      }
      debounceRef.current = setTimeout(() => fetchSuggestions(val), 250);
    } else {
      setPhase("idle");
      setSuggestions([]);
    }
  };

  const handleSelect = (suggestion: Suggestion) => {
    onChange(suggestion.label);
    onSelect(suggestion.label);
    setSuggestions([]);
    setDismissed(true);
    setPhase("idle");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setDismissed(true);
    }
  };

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const showDropdown =
    !dismissed &&
    phase !== "idle" &&
    (phase === "loading" || suggestions.length > 0 || phase === "done");

  return (
    <div ref={containerRef} className="relative">
      <input
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (suggestions.length > 0) setDismissed(false);
        }}
        placeholder={placeholder}
        className={className}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="address-autocomplete-listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          activeIndex >= 0 ? `address-option-${activeIndex}` : undefined
        }
      />
      {showDropdown && (
        <ul
          id="address-autocomplete-listbox"
          role="listbox"
          className="border-rule bg-paper absolute top-[calc(100%+6px)] right-0 left-0 z-50 overflow-hidden border py-1"
        >
          {phase === "loading" && suggestions.length === 0 ? (
            [0, 1, 2].map((i) => (
              <li key={i} className="px-4 py-3" role="presentation">
                <div
                  className="bg-muted/60 h-4 animate-pulse"
                  style={{ width: `${75 - i * 15}%` }}
                />
              </li>
            ))
          ) : suggestions.length > 0 ? (
            suggestions.map((s, i) => (
              <li
                key={i}
                id={`address-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={() => handleSelect(s)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors ${
                  i === activeIndex ? "bg-ink/[0.06]" : "hover:bg-muted/40"
                }`}
              >
                {s.isRawInput ? (
                  <svg
                    className="text-hollow h-4 w-4 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                ) : (
                  <svg
                    className="text-hollow h-4 w-4 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                )}
                <span className="text-ink">
                  {s.isRawInput ? (
                    <>
                      Search{" "}
                      <span className="font-medium">
                        &ldquo;{s.label}&rdquo;
                      </span>
                    </>
                  ) : (
                    s.label
                  )}
                </span>
              </li>
            ))
          ) : (
            <li className="text-ink-muted px-4 py-3 text-sm">
              No suggestions — press{" "}
              <span className="text-ink font-medium">Look up</span> to search
              this address anyway
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
