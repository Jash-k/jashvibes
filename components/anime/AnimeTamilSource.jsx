'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import RailNav from '@/components/rail/RailNav';

/**
 * The source, framed — and framed on purpose.
 *
 * `/anime/tamil` plays a stream by resolving it and handing it to JashPlayer. That is the right shape for
 * every host that publishes a fetchable manifest, and the wrong one for the rest: some hosts only work
 * inside their own page's script, and one ISP block on one CDN edge is enough to make a row that measured
 * fine sit at 0:00. This page is the second door. It is not `piratexplay.cc` in a box — the document comes
 * from `/api/anime/tamil/page`, which drops their ad scripts and pop-unders before the bytes reach the
 * browser, hides their header/footer/promo blocks with a stylesheet of ours, and stubs `window.open`, which
 * is the part a third-party frame can never do.
 *
 * The frame is CSP-sandboxed into an opaque origin, so their scripts cannot read this app's storage; the
 * only channel between us and them is the `postMessage` below, and it is checked both ways.
 */
export default function AnimeTamilSource({ path = '', rawBase = '', title = '' }) {
  const router = useRouter();
  const [reloadKey, setReloadKey] = useState(0);
  // `depth` is how many of *their* pages this frame has walked through. It is the only thing that makes
  // “back one page” safe: a frame with no history of its own sends `history.back()` to the joint session
  // history, which would have thrown the whole app page away instead.
  const [frame, setFrame] = useState({ loaded: false, blocked: 0, label: title || '', timedOut: false, depth: 0 });
  const seenRef = useRef([]);
  const loadedRef = useRef(false);

  const src = useMemo(() => {
    const params = new URLSearchParams({ u: path });
    if (reloadKey) params.set('force', '1');
    return `/api/anime/tamil/page?${params.toString()}`;
  }, [path, reloadKey]);

  const rawHref = useMemo(() => `${String(rawBase).replace(/\/+$/, '')}${path}`, [rawBase, path]);

  useEffect(() => {
    let alive = true;
    const onMessage = (event) => {
      // The framed document is sandboxed, so its origin is the literal string "null" — that is the one
      // value besides our own that may speak to this toolbar.
      if (!alive) return;
      if (event.origin !== window.location.origin && event.origin !== 'null') return;
      const data = event.data;
      if (!data || data.kind !== 'jv-source') return;
      loadedRef.current = true;
      const seen = data.path ? String(data.path) : '';
      if (seen && !seenRef.current.includes(seen)) seenRef.current = [...seenRef.current, seen];
      setFrame((previous) => ({
        loaded: true,
        blocked: Number(data.blocked) || 0,
        label: data.path ? `${stripTitle(data.title) || previous.label}` : previous.label,
        depth: Math.max(0, seenRef.current.length - 1),
      }));
    };
    window.addEventListener('message', onMessage);
    // A frame their site refused still fires `load` (on a blank document), so the honest signal is the
    // absence of the reply below. Six seconds is long enough for a slow page and short enough that nobody
    // stares at a black box wondering whether it is loading.
    const timer = setTimeout(() => setFrame((previous) => (previous.loaded ? previous : { ...previous, timedOut: true })), 6000);
    return () => { window.removeEventListener('message', onMessage); clearTimeout(timer); alive = false; };
  }, [src]);

  const close = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/anime/tamil');
  }, [router]);

  const back = useCallback(() => {
    // Only ever the frame's own history, and only when it has one. Going back in the app is what the
    // button on the left is for; the two must not be confused.
    if (seenRef.current.length < 2) return;
    const node = document.getElementById('jv-an-src');
    try { node?.contentWindow?.history?.back(); } catch { /* opaque origin: their frame keeps its own counsel */ }
  }, []);
  const canStepBack = frame.depth > 0;

  return (
    <>
      <RailNav />
      <main className="jv-an-page jv-an-source jv-rail-shift">
        <div className="jv-an jv-an-src-wrap">
          <header className="jv-an-src-bar">
            <button type="button" className="jv-an-btn" onClick={close}>← back to the list</button>
            <p className="jv-an-src-title">
              <span className="jv-an-kicker">piratexplay · {path || '/'}</span>
              <strong>{frame.label || title || 'the source page'}</strong>
              <span className="jv-an-src-note">
                {frame.loaded
                  ? `ad scripts dropped${frame.blocked ? ` · ${frame.blocked} off-site click${frame.blocked === 1 ? '' : 's'} blocked` : ''}`
                  : frame.timedOut
                    ? 'their page did not reply — if this is blank, their site refused the read'
                    : 'reading their page…'}
              </span>
            </p>
            <div className="jv-an-src-tools">
              <button
                type="button"
                className="jv-an-btn"
                onClick={back}
                disabled={!canStepBack}
                title={canStepBack ? 'one page back inside their page' : 'their page has not moved yet'}
              >
                back one page
              </button>
              <button type="button" className="jv-an-btn" onClick={() => setReloadKey((value) => value + 1)}>
                reload this page
              </button>
              <a className="jv-an-btn is-quiet" href={rawHref} target="_blank" rel="noopener noreferrer">
                open raw <span aria-hidden="true">↗</span>
              </a>
            </div>
          </header>

          <div className="jv-an-src-frame">
            <iframe
              id="jv-an-src"
              key={`${src}::${reloadKey}`}
              title={`${frame.label || 'PirateXPlay page'} — shown inside the app`}
              src={src}
              sandbox="allow-scripts allow-forms allow-pointer-lock"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => { loadedRef.current = true; }}
            />
          </div>

          <p className="jv-an-note">
            This is their page, stripped and served by this app: the ad hosts&apos; scripts, pop-under frames,
            <code> meta refresh </code> and <code>onbeforeunload</code> are gone before the document reaches
            the browser, and <code>window.open</code> is stubbed so an ad cannot spawn a tab. Video is never
            proxied through here — a stream still goes from its own CDN to your browser — and the frame runs in
            a sandboxed, opaque origin, so it cannot read anything this app stores. What loads *inside* their own
            player is their document, not ours, so that part keeps whatever it ships. If this sits blank, their
            site refused the read: <a className="jv-an-linkbtn" href={rawHref} target="_blank" rel="noopener noreferrer">open it raw ↗</a>.
          </p>
        </div>
      </main>
    </>
  );
}

function stripTitle(value = '') {
  return String(value)
    .replace(/\s*[|–—-]\s*PirateXPlay.*$/i, '')
    // Their own titles write "1x18"; everywhere else in this app that row reads "S1 · E18".
    .replace(/\b(\d{1,2})x(\d{1,3})\b/, (_all, season, episode) => `S${Number(season)} · E${Number(episode)}`)
    .trim()
    .slice(0, 80);
}
