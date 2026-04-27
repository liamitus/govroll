"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";

export function ThankYouClient() {
  const [citizenCount, setCitizenCount] = useState<number | null>(null);
  const [displayCount, setDisplayCount] = useState(0);
  const fired = useRef(false);

  // Fetch live count so we can show it ticking up including the current donation.
  useEffect(() => {
    fetch("/api/support/citizen-count", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.count != null) setCitizenCount(d.count);
      })
      .catch(() => {});
  }, []);

  // Confetti burst — civic gold + navy, top-right & top-left origins.
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const colors = ["#B8860B", "#0A1F44", "#FAFAF5"];
    const duration = 1200;
    const end = Date.now() + duration;
    (function frame() {
      confetti({
        particleCount: 4,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.2 },
        colors,
        startVelocity: 55,
        gravity: 1.0,
        scalar: 0.9,
      });
      confetti({
        particleCount: 4,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.2 },
        colors,
        startVelocity: 55,
        gravity: 1.0,
        scalar: 0.9,
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }, []);

  // Animate the counter from 0 up to the real value.
  useEffect(() => {
    if (citizenCount == null) return;
    const target = citizenCount;
    const start = performance.now();
    const duration = 1400;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayCount(Math.round(eased * target));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [citizenCount]);

  const shareUrl = "https://www.govroll.com";
  const shareText = encodeURIComponent(
    "I just supported Govroll — civic transparency, no ads, no paywalls. Join me:",
  );

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-16 text-center">
      <p className="text-civic-gold star-accent text-sm tracking-widest uppercase">
        Thank You
      </p>
      <h1 className="font-gelasio text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
        You&apos;re keeping civic
        <br />
        transparency alive.
      </h1>

      {citizenCount != null && citizenCount > 0 && (
        <div className="border-civic-gold/30 bg-civic-cream/40 animate-fade-slide-up rounded-lg border px-6 py-5">
          <p className="text-civic-gold/80 mb-1 text-xs font-semibold tracking-widest uppercase">
            Made Possible By
          </p>
          <p className="font-gelasio text-navy text-3xl font-bold tabular-nums">
            {displayCount.toLocaleString()}
            <span className="text-muted-foreground ml-2 text-base font-normal">
              {citizenCount === 1 ? "citizen" : "citizens"}
            </span>
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {citizenCount === 1
              ? "You’re the first — thank you for starting this."
              : "and counting"}
          </p>
        </div>
      )}

      <p className="text-muted-foreground text-base leading-relaxed">
        Your contribution goes directly to powering Govroll&apos;s AI tools and
        data infrastructure — keeping Govroll free for every American, with no
        ads and no paywalls. We just sent a receipt to your inbox.
      </p>

      <div className="space-y-3 pt-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          Spread the word
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${shareText}&url=${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border/60 text-navy hover:bg-navy/5 inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Post on X
          </a>
          <a
            href={`https://bsky.app/intent/compose?text=${shareText}%20${encodeURIComponent(shareUrl)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border/60 text-navy hover:bg-navy/5 inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.296 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z" />
            </svg>
            Post on Bluesky
          </a>
        </div>
      </div>

      <div className="flex justify-center gap-4 pt-2 text-sm">
        <Link
          href="/made-possible-by"
          className="text-navy/70 hover:text-navy underline underline-offset-2"
        >
          See who makes Govroll possible
        </Link>
        <span className="text-muted-foreground">·</span>
        <Link
          href="/bills"
          className="text-navy/70 hover:text-navy underline underline-offset-2"
        >
          Back to bills
        </Link>
      </div>
    </div>
  );
}
