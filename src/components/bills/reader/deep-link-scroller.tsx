"use client";

import { useEffect } from "react";

/**
 * On mount, if `initialSlug` is set, scroll the matching section into
 * view. We use `?section=<slug>` (not `#<slug>`) for permalinks because
 * query params are more legible in shared URLs and don't trigger the
 * browser's automatic hash scroll — which means we control the timing
 * here, after hydration, avoiding races against React's commit.
 *
 * `requestAnimationFrame` defers the scroll until layout is stable;
 * `scroll-margin-top` (set on each section heading via globals.css)
 * keeps the target heading clear of the (future Day 5) sticky
 * breadcrumb.
 */
export function DeepLinkScroller({
  initialSlug,
}: {
  initialSlug: string | null;
}) {
  useEffect(() => {
    if (!initialSlug) return;
    const target = document.getElementById(initialSlug);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [initialSlug]);

  return null;
}
