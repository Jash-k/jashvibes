'use client';

import { useEffect, useRef } from 'react';

/**
 * useParallax — the design system's hero parallax (motion tier: subtle).
 *
 * Drifts one element as the page scrolls past it, by writing a single custom
 * property that CSS turns into a transform. The rules it follows are the ones
 * that keep parallax from making a phone feel cheap:
 *
 * 1. **Transform only, and clamped.** The hook writes `--jv-parallax-y`; the CSS
 *    composes it into `translate3d()`. Nothing here touches `top`/`margin`, so
 *    the browser composites instead of laying out. Travel is clamped to ±`max`
 *    px so the artwork can never slide far enough to expose an edge.
 *
 * 2. **No listeners while off-screen.** Scroll and resize handlers are attached
 *    only while the element is within 25% of the viewport, and detached the
 *    moment it leaves. A long page therefore pays nothing for a parallax element
 *    the user scrolled past.
 *
 * 3. **One measure per frame.** Scroll events fire far faster than frames; the
 *    rAF guard collapses a burst of them into a single `getBoundingClientRect`.
 *
 * 4. **Reduced motion = no parallax at all.** No class, no listeners, no
 *    transform — the image renders exactly as it did before. The scale-up that
 *    gives the art its travel room is applied by the `.jv-parallax-on` class for
 *    the same reason: without motion there is no reason to crop the art.
 *
 * `strength` is travel per pixel of scroll; 0.07–0.12 reads as depth without
 * looking like a bug. Above ~0.2 it starts to feel like the page is falling.
 */
export function useParallax({ strength = 0.08, max = 24 } = {}) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof window === 'undefined') return undefined;

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return undefined;

    let frame = 0;
    let listening = false;

    const measure = () => {
      frame = 0;
      const rect = element.getBoundingClientRect();
      // Distance of the element's centre from the viewport centre: the natural
      // 0-point, so the artwork sits still when the hero is centred and drifts
      // symmetrically in either direction.
      const travel = rect.top + rect.height / 2 - window.innerHeight / 2;
      const y = Math.max(-max, Math.min(max, -travel * strength));
      element.style.setProperty('--jv-parallax-y', `${y.toFixed(2)}px`);
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    const start = () => {
      if (listening) return;
      listening = true;
      window.addEventListener('scroll', schedule, { passive: true });
      window.addEventListener('resize', schedule);
      schedule();
    };

    const stop = () => {
      if (!listening) return;
      listening = false;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    element.classList.add('jv-parallax-on');

    if (typeof IntersectionObserver === 'undefined') {
      start();
      return () => {
        stop();
        element.classList.remove('jv-parallax-on');
        element.style.removeProperty('--jv-parallax-y');
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      },
      { rootMargin: '25% 0px' },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      stop();
      element.classList.remove('jv-parallax-on');
      element.style.removeProperty('--jv-parallax-y');
    };
  }, [strength, max]);

  return ref;
}
