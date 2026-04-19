"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Tracks which section is currently the "active" one as the user
 * scrolls. Used by the sticky breadcrumb (to display the active
 * heading path) and the outline tree (to highlight the active row +
 * auto-scroll itself).
 *
 * Implementation is a single IntersectionObserver per provider with
 * a narrow rootMargin band sitting just below the sticky breadcrumb
 * (80px from the top). Sections enter "visible" when their top
 * crosses into that band; the active slug is the last-in-document-
 * order visible slug, so as you scroll down the breadcrumb tracks
 * the deepest section your eye is currently parsing.
 *
 * The IO does not run on the main thread — Chrome / Safari handle
 * the threshold checks in the compositor, which is why hundreds of
 * targets stay 60fps even on mid-range Android. Don't replace this
 * with a scroll listener.
 */

interface ScrollSpyContextValue {
  /** Slug of the active section, or null if no section is in view
   *  (e.g. user is still above the first section). */
  activeSlug: string | null;
}

const ScrollSpyContext = createContext<ScrollSpyContextValue>({
  activeSlug: null,
});

export function useScrollSpy(): ScrollSpyContextValue {
  return useContext(ScrollSpyContext);
}

export function ScrollSpyProvider({
  slugsInOrder,
  children,
}: {
  /** All section slugs in document order. The provider observes the
   *  DOM elements with matching `id` and resolves "last visible" by
   *  this canonical order. */
  slugsInOrder: string[];
  children: ReactNode;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  // Mutable Set held by ref so the observer callback doesn't recreate
  // the closure every render. State update happens via setActiveSlug
  // only when the resolved active slug actually changes.
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (slugsInOrder.length === 0) return;
    visibleRef.current.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const slug = (entry.target as HTMLElement).dataset.sectionSlug;
          if (!slug) continue;
          if (entry.isIntersecting) visibleRef.current.add(slug);
          else visibleRef.current.delete(slug);
        }

        // "Active" = last visible slug in document order. If nothing
        // is currently in the band, fall back to whatever was active
        // last so the breadcrumb doesn't flicker to empty mid-scroll.
        let lastVisible: string | null = null;
        for (const slug of slugsInOrder) {
          if (visibleRef.current.has(slug)) lastVisible = slug;
        }
        if (lastVisible !== null) {
          setActiveSlug((prev) => (prev === lastVisible ? prev : lastVisible));
        }
      },
      {
        // 80px top margin matches the sticky breadcrumb height — a
        // section becomes "active" when its heading crosses that
        // band. The 85% bottom margin compresses the active band to
        // the top sliver of the viewport so we track the heading
        // closest to the user's reading position, not the entire
        // visible area.
        rootMargin: "-80px 0px -85% 0px",
        threshold: 0,
      },
    );

    // Observe the live DOM. Targets are the `<section data-section-slug=…>`
    // elements rendered by `<SectionRenderer>` (server-side). The IDs
    // align because both rendering and observing read from the same
    // `slugsInOrder` array.
    const observed: Element[] = [];
    for (const slug of slugsInOrder) {
      const el = document.getElementById(slug);
      if (el) {
        observer.observe(el);
        observed.push(el);
      }
    }

    return () => {
      for (const el of observed) observer.unobserve(el);
      observer.disconnect();
    };
  }, [slugsInOrder]);

  const value = useMemo(() => ({ activeSlug }), [activeSlug]);

  return (
    <ScrollSpyContext.Provider value={value}>
      {children}
    </ScrollSpyContext.Provider>
  );
}
