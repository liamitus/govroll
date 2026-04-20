"use client";

import { useEffect } from "react";

/**
 * Navigation bridge for the reader. Handles three scroll triggers:
 *
 *   1. `?section=<slug>` on initial load — a canonical shareable
 *      deep link. We handle this post-hydration (not via the
 *      browser's hash scroll) so we can expand ancestor `<details>`
 *      first.
 *   2. `#<slug>` hashchange events — fired when the outline rail's
 *      anchor links are clicked. Same expand-then-scroll dance.
 *   3. Clicks on `a[href^="#"]` with a matching section target —
 *      catches re-click on the already-active anchor (where
 *      hashchange wouldn't fire).
 *
 * "Expand ancestors" walks up from the target element and flips
 * `open` on every `<details>` in the chain. Without this, clicking
 * an outline entry for a nested subsection inside a collapsed group
 * would leave the target with zero layout and the browser with
 * nowhere to scroll to.
 */
export function DeepLinkScroller({
  initialSlug,
}: {
  initialSlug: string | null;
}) {
  useEffect(() => {
    function expandAncestorDetails(el: Element | null): void {
      let node: Element | null = el;
      while (node) {
        if (node instanceof HTMLDetailsElement && !node.open) {
          node.open = true;
        }
        node = node.parentElement;
      }
    }

    function scrollToSlug(slug: string): void {
      const target = document.getElementById(slug);
      if (!target) return;
      expandAncestorDetails(target);
      // Defer until after the <details> toggle has a chance to lay
      // out — one animation frame is enough for native browsers.
      requestAnimationFrame(() => {
        target.scrollIntoView({ block: "start", behavior: "auto" });
      });
    }

    if (initialSlug) scrollToSlug(initialSlug);

    function handleHashChange(): void {
      const hash = window.location.hash;
      if (hash.length <= 1) return;
      scrollToSlug(decodeURIComponent(hash.slice(1)));
    }

    function handleAnchorClick(e: MouseEvent): void {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest<HTMLAnchorElement>('a[href^="#"]');
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.length <= 1) return;
      const slug = decodeURIComponent(href.slice(1));
      const el = document.getElementById(slug);
      if (!el) return;
      // Open ancestors synchronously so the browser's native hash-
      // anchor scroll finds a laid-out target. We don't preventDefault
      // — let the native scroll behavior run, then also run our own
      // scroll after a frame for consistent scroll-margin handling.
      expandAncestorDetails(el);
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "start", behavior: "auto" });
      });
    }

    window.addEventListener("hashchange", handleHashChange);
    document.addEventListener("click", handleAnchorClick);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      document.removeEventListener("click", handleAnchorClick);
    };
  }, [initialSlug]);

  return null;
}
