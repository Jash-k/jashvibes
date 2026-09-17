'use client';

/*
 * app/error.js — the app-wide crash boundary.
 *
 * Every surface here is a large client component tree (the live page alone is
 * ~90 hooks), and until now one render crash meant an unbranded white page
 * with a tiny prod error stub. This boundary keeps the cinema chrome: the
 * crash is contained, explained in one sentence, and the two actions that can
 * actually help (retry the render, or hard-reload for a fresh bundle) are the
 * only controls. `reset()` re-renders the route segment without a full reload;
 * it fixes transient state errors but not stale-bundle problems, hence both.
 */

import { useEffect } from 'react';

export default function RouteError({ error, reset }) {
  useEffect(() => {
    // Surfaced in the browser console with the app's tag so a pasted log is
    // recognisably this boundary and not Next's generic handler.
    console.error('[jash] route crashed:', error);
  }, [error]);

  const digest = typeof error?.digest === 'string' ? error.digest.slice(0, 12) : '';

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#050505] px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-[1.75rem] bg-[linear-gradient(115deg,#f59e0b,#dc2626_50%,#a855f7)] p-[1.5px] shadow-2xl shadow-red-950/40">
        <div className="rounded-[calc(1.75rem-1.5px)] bg-[#0a0a0c] px-6 py-8 text-center">
          <p className="jash-vibes-logo text-2xl">JaSH ViBeS</p>
          <h1 className="mt-5 text-xl font-black text-white">This screen took a hit</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-zinc-400">
            Something broke while rendering this page — not your library, which lives on this
            device and is untouched. Try again, or reload for a fresh app bundle.
          </p>
          {digest ? (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">
              ref {digest}
            </p>
          ) : null}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-500"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-300 transition hover:border-white/40"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
