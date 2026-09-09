'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MasonryGrid from '@/components/MasonryGrid';

/**
 * Anime — the one destination the rail needs that the daily scrape cannot answer.
 *
 * The 1tamilmv catalog carries no genres, so filtering it would be guesswork; this asks TMDB's
 * Animation genre through `lib/animeCatalog.js` (one upstream call per type+page per 30 minutes,
 * cached server-side). The page itself makes exactly one request per toggle-and-page, aborts the
 * previous one, and never polls — on a 512 MB free tier a browsing surface may not become a load.
 */

const TYPES = [
  { id: 'movie', label: 'Movies' },
  { id: 'series', label: 'Series' },
];

function AnimeCard({ item }) {
  const href = `/watch/${item.type}/${item.tmdbId}`;
  const year = String(item.releaseDate || '').slice(0, 4);
  const rating = Number(item.rating) ? Number(item.rating).toFixed(1) : '';

  return (
    <Link
      href={href}
      className="group block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-lg shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-fuchsia-400/60 sm:rounded-3xl"
      title={item.synopsis || item.title}
    >
      <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
        {item.posterUrl ? (
          <img
            src={item.posterUrl}
            alt={`${item.title} poster`}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black p-3 text-center">
            <span className="text-xs font-black text-zinc-200">{item.title}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-95" />
        {rating ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] text-amber-200 backdrop-blur">
            ★ {rating}
          </span>
        ) : null}
      </div>
      <div className="p-2.5 sm:p-3">
        <p className="line-clamp-2 text-xs font-black leading-4 text-white">{item.title}</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {year || (item.type === 'series' ? 'Series' : 'Movie')}
        </p>
      </div>
    </Link>
  );
}

export default function AnimePage() {
  const [type, setType] = useState('movie');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  // Retry needs something to change: setting `type` to the value it already has makes React bail out of
  // the re-render, and the effect would never re-run. This counter is the honest version of "again".
  const [nonce, setNonce] = useState(0);
  const requestRef = useRef(0);

  const fetchPage = useCallback(async (kind, nextPage, signal) => {
    const response = await fetch(`/api/anime?type=${kind}&page=${nextPage}`, { cache: 'no-store', signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) throw new Error(data?.error || 'The anime listing is unavailable right now.');
    return data;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const id = requestRef.current + 1;
    requestRef.current = id;
    setStatus('loading');
    setError('');
    fetchPage(type, 1, controller.signal)
      .then((data) => {
        if (requestRef.current !== id) return;
        setItems(data.items || []);
        setPage(data.page || 1);
        setTotalPages(data.totalPages || 0);
        setStatus('ready');
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || requestRef.current !== id) return;
        setItems([]);
        setError(err?.message || 'Unable to load the listing.');
        setStatus('error');
      });
    return () => controller.abort();
  }, [type, nonce, fetchPage]);

  const loadMore = async () => {
    if (loadingMore) return;
    const next = page + 1;
    const id = requestRef.current + 1;
    setLoadingMore(true);
    try {
      const data = await fetchPage(type, next);
      if (requestRef.current === id) {
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...(data.items || []).filter((item) => !seen.has(item.id))];
        });
        setPage(data.page || next);
        setTotalPages(data.totalPages || totalPages);
      }
    } catch (err) {
      setError(err?.message || 'That page could not be loaded.');
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = useMemo(() => page < (totalPages || page), [page, totalPages]);

  return (
    <main className="min-h-dvh bg-[#050505] pb-16 text-zinc-100">
      <section className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white"
            >
              ← Home
            </Link>
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
              Anime <span aria-hidden="true">🌸</span>
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-[#0b0b10] p-1.5 sm:min-w-72">
            {TYPES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setType(entry.id)}
                aria-pressed={type === entry.id}
                className={`min-h-11 rounded-2xl px-4 py-2 text-left transition ${
                  type === entry.id ? 'bg-fuchsia-500/20 text-white shadow-[inset_0_0_0_1px_rgba(232,121,249,0.45)]' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span className="block text-[10px] font-black uppercase tracking-[0.22em] opacity-75">{entry.label}</span>
                <span className="mt-0.5 block text-sm font-black">TMDB genre 16</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {status === 'loading' ? (
          <p className="text-sm text-zinc-500">Loading the animation catalogue…</p>
        ) : null}

        {status === 'error' ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
            <p>{error || 'The listing could not be loaded.'}</p>
            <button
              type="button"
              onClick={() => setNonce((value) => value + 1)}
              className="mt-3 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-black text-white transition hover:border-white/40"
            >
              Retry
            </button>
          </div>
        ) : null}

        {status === 'ready' && !items.length ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-zinc-400">
            TMDB returned no {type === 'series' ? 'series' : 'movies'} for this page.
          </div>
        ) : null}

        {items.length ? (
          <>
            {error && status === 'ready' ? <p className="mb-3 text-xs font-bold text-amber-300">{error}</p> : null}
            <MasonryGrid gap={14} minItemWidth={155}>
              {items.map((item) => (
                <AnimeCard key={item.id} item={item} />
              ))}
            </MasonryGrid>

            <div className="mt-8 flex justify-center">
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-fuchsia-400/70 hover:bg-fuchsia-500/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : `Load page ${page + 1}`}
                </button>
              ) : (
                <p className="text-sm text-zinc-500">That is the end of the listing.</p>
              )}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
