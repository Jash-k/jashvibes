'use client';

import dynamic from 'next/dynamic';

/*
 * JashPlayerLazy — the same JashPlayer component, loaded on demand.
 *
 * The player chrome + engine is tens of KB of JS that every surface previously
 * paid for in its first-load budget (/live was 174 kB, /watch 160 kB) even on
 * visits that never press play (scrolling the guide, reading a scorecard).
 * next/dynamic moves that cost out of the route bundle: the shell paints, and
 * the player chunk arrives as a parallel fetch the moment the route hydrates —
 * before the user's finger reaches the play button in practice.
 *
 * ssr: false because the engine already is browser-only (Shaka, wake lock,
 * MediaSession); the server never rendered useful player markup anyway.
 *
 * The placeholder is the player's own shell styling so the sheet that holds it
 * does not visibly "flash in" when the real component swaps in.
 *
 * /player-lab imports JashPlayer directly on purpose: it is the fixture
 * harness for the player itself and should never test the lazy wrapper.
 */

function PlayerLoadingShell() {
  return (
    <div
      className="flex min-h-[220px] w-full items-center justify-center rounded-2xl border border-white/10 bg-zinc-950"
      role="status"
      aria-label="Player is loading"
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
        <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-500">Player</span>
      </div>
    </div>
  );
}

const JashPlayer = dynamic(() => import('@/components/player/JashPlayer'), {
  ssr: false,
  loading: PlayerLoadingShell,
});

export default JashPlayer;
