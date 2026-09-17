import Link from 'next/link';

/*
 * app/not-found.js — the branded 404.
 *
 * The app redirects its own retired URLs (/anime, /match-center/*) via
 * next.config, so a 404 now means a stale bookmark or a mistyped hash —
 * both are people who meant to reach the app. The default Next 404 is an
 * unstyled dead end; this one keeps the cinema chrome and offers the two
 * real destinations: the catalogue and the library.
 */

export const metadata = {
  title: 'Not found — JaSH ViBeS',
};

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#050505] px-4 text-zinc-100">
      <div className="w-full max-w-md rounded-[1.75rem] bg-[linear-gradient(115deg,#f59e0b,#dc2626_50%,#a855f7)] p-[1.5px] shadow-2xl shadow-red-950/40">
        <div className="rounded-[calc(1.75rem-1.5px)] bg-[#0a0a0c] px-6 py-8 text-center">
          <p className="jash-vibes-logo text-2xl">JaSH ViBeS</p>
          <p className="mt-6 bg-gradient-to-r from-amber-400 via-rose-500 to-purple-500 bg-clip-text text-6xl font-black text-transparent">
            404
          </p>
          <h1 className="mt-3 text-xl font-black text-white">This reel does not exist</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-zinc-400">
            The page was moved, renamed, or the link was mistyped. The catalogue and your
            library are both still where you left them.
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/"
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-500"
            >
              Browse titles
            </Link>
            <Link
              href="/my-list"
              className="flex-1 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-300 transition hover:border-white/40"
            >
              My List
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
