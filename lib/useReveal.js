'use client';

import { useEffect, useRef } from 'react';

/**
 * useReveal — the design system's scroll-reveal layer (motion tier: subtle).
 *
 * One IntersectionObserver per surface marks `[data-reveal]` descendants `is-in`
 * as they scroll into view. Four rules, because each of them has bitten a real
 * app somewhere:
 *
 * 1. **Content is only hidden once JS is running.** The `data-reveal-ready`
 *    attribute is set from this hook, never in the markup, and the CSS that hides
 *    `[data-reveal]` is scored under that attribute. A failed bundle or a
 *    pre-hydration paint therefore shows the full shelf instead of a blank page —
 *    which is the failure mode that makes reveal animations a liability.
 *
 * 2. **Re-running is expected.** These lists grow: "Keep loading" appends rows to
 *    a decade shelf, and the stremio grid pages in more items. Pass a key (the
 *    item count works) and the effect re-runs: rows added later are observed,
 *    while rows already showing keep their `is-in` and are never re-hidden. Skip
 *    that key and the appended rows would sit at `opacity: 0` forever.
 *
 * 3. **Reduced motion is a switch, not a dial.** If the user has asked for less
 *    motion, every target is marked visible immediately — no observer is created
 *    and no transition runs.
 *
 * 4. **One-shot per element.** IntersectionObserver fires for elements that keep
 *    scrolling in and out; each target is unobserved after it reveals, so a
 *    40-row shelf costs one entry per row for the life of the page.
 *
 * Stagger is opt-in per element with `--reveal-i` (see `.jv-cinema`-style motion
 * classes in app/globals.css). Cap it at the call site: 40 rows × 42ms would
 * still be animating two seconds after the shelf settled.
 */
export function useReveal(dependency) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    const targets = Array.from(root.querySelectorAll('[data-reveal]:not(.is-in)'));
    if (!targets.length) return undefined;

    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach((element) => element.classList.add('is-in'));
      return undefined;
    }

    root.setAttribute('data-reveal-ready', '');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 },
    );
    targets.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
    // `dependency` is the caller's signal that the list changed (item count).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency]);

  return ref;
}

/** The inline style an item carries: `--reveal-i` drives the stagger, capped so a
 *  long shelf never spends seconds animating. */
export const revealStyle = (index, cap = 8) => ({ '--reveal-i': Math.min(index, cap) });
