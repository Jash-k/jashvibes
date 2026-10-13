'use client';
import Link, { useLinkStatus } from 'next/link';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { beginPendingLoad, abortLoad } from '@/lib/loadProgress';

/**
 * SectionLink — the only navigation primitive for section switches.
 *
 * Two jobs, and they are the same job: this is the only place that knows a section switch
 * was *asked for*, a few hundred milliseconds before anything else does.
 *
 *   1. pending feedback lives ON the link being pressed (`is-pending`, `aria-busy`), not in
 *      a floating toast — the old top-screen "Opening X…" pill competed with the route
 *      skeleton, two indicators for one wait, and that was part of what looked glitchy;
 *   2. it tells `lib/loadProgress.js` that a section is opening. That is what starts the
 *      ring, and because it fires before Next swaps the page, the section still on screen
 *      is the one that gets blurred — the section you are leaving, not a placeholder.
 *
 * Warming: on hover/focus/touch for intent (as before), plus one idle pass when the
 * link asks for it (`idleWarm`), so most switches have nothing left to fetch. Both
 * are skipped on save-data and 2G connections.
 */

/**
 * `useLinkStatus` only works inside the `<Link>`, so the state is applied to the
 * anchor element itself rather than to an extra wrapper — a wrapper span would
 * change the nav item's flex layout, and the shell must not move while loading.
 */
function Pending({ label, href }) {
  const { pending } = useLinkStatus();
  const marker = useRef(null);
  const loadId = useRef(0);
  useEffect(() => {
    const anchor = marker.current?.closest('a');
    if (!anchor) return;
    anchor.classList.toggle('is-pending', Boolean(pending));
    if (pending) anchor.setAttribute('aria-busy', 'true');
    else anchor.removeAttribute('aria-busy');
  }, [pending]);
  useEffect(() => {
    if (pending) { loadId.current = beginPendingLoad({ href, label })?.id ?? 0; return undefined; }
    // Pending cleared without a commit (a cancelled tap, back button, a route that never
    // arrived). Give the commit a beat to land, then drop the ring rather than hold it.
    const timer = setTimeout(() => abortLoad(loadId.current), 320);
    return () => clearTimeout(timer);
  }, [pending, href, label]);
  return <span ref={marker} className="sr-only" role="status">{pending ? `Opening ${label}…` : ''}</span>;
}

function useIdleWarm(href) {
  const router = useRouter();
  const done = useRef(false);
  useEffect(() => {
    if (!href || done.current) return undefined;
    const connection = navigator.connection;
    if (connection?.saveData || /2g/.test(connection?.effectiveType || '')) return undefined;
    const run = () => { done.current = true; router.prefetch(href); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(run, 1200);
    return () => window.clearTimeout(timer);
  }, [href, router]);
  return null;
}

export default function SectionLink({
  children, label = 'section', href, idleWarm = false, onPointerEnter, onFocus, onTouchStart, ...props
}) {
  const router = useRouter();
  useIdleWarm(idleWarm ? href : '');
  const warm = () => {
    if (navigator.connection?.saveData || /2g/.test(navigator.connection?.effectiveType || '')) return;
    router.prefetch(href);
  };
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onPointerEnter={(event) => { onPointerEnter?.(event); warm(); }}
      onFocus={(event) => { onFocus?.(event); warm(); }}
      onTouchStart={(event) => { onTouchStart?.(event); warm(); }}
    >
      {children}
      <Pending label={label} href={href} />
    </Link>
  );
}
