'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import LibraryRows from '@/components/LibraryRows';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import Icon from '@/components/Icons';
import MasonryGrid from '@/components/MasonryGrid';
import { isFavoriteItem, makeWatchKey, toggleFavoriteItem, useLibraryVersion } from '@/lib/watchStore';

const PAGE_SIZE = 15;
const HOME_CACHE_KEY = 'jash:home:v5';

function formatDateTime(value) {
  if (!value) return 'Not updated yet';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return 'Not updated yet';
  }
}

function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setResults([]);
      setError('');
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setStatus('loading');
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('Server is still starting. Please wait a few seconds and search again.');
        }

        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || data?.warning || 'Search failed');
        setResults(data.results || []);
        setError(data.warning || '');
        setStatus('ready');
      } catch (error) {
        if (error.name === 'AbortError') return;
        setResults([]);
        setError(error.message || 'Search failed');
        setStatus('error');
      }
    }, 220);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div className="relative w-full lg:max-w-md">
      <label htmlFor="tmdb-search" className="sr-only">Search TMDB</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500">⌕</span>
        <input
          id="tmdb-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search TMDB titles..."
          enterKeyHint="search"
          autoComplete="off"
          className="w-full rounded-2xl border border-white/10 bg-black/70 py-3.5 pl-10 pr-4 text-base font-semibold text-white outline-none backdrop-blur placeholder:text-zinc-500 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 sm:text-sm"
        />
      </div>

      {trimmed ? (
        <div className="absolute right-0 z-50 mt-3 max-h-[min(70vh,34rem)] w-full overscroll-contain overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl shadow-black/60 backdrop-blur">
          {status === 'loading' ? (
            <div className="p-4 text-sm text-zinc-400">Searching TMDB...</div>
          ) : null}

          {status === 'error' ? (
            <div className="p-4 text-sm leading-6 text-red-300">
              {error || 'Search failed. Try again.'}
              <span className="mt-1 block text-xs text-zinc-500">Check that TMDB or TMDB_TOKEN is set, then redeploy.</span>
            </div>
          ) : null}

          {status === 'ready' && error ? (
            <div className="mb-2 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-100">
              TMDB search fallback: {error}
            </div>
          ) : null}

          {status === 'ready' && results.length === 0 ? (
            <div className="p-4 text-sm text-zinc-400">No TMDB titles found.</div>
          ) : null}

          {results.map((item) => (
            <Link
              key={`${item.type}-${item.tmdbId}`}
              href={`/watch/${item.type}/${item.tmdbId}`}
              className="flex gap-3 rounded-2xl p-2 transition hover:bg-white/[0.06]"
              onClick={() => setQuery('')}
            >
              <div className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                {item.posterUrl ? (
                  <img src={item.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                ) : null}
              </div>
              <div className="min-w-0 py-1">
                <p className="line-clamp-2 text-sm font-black text-white">{item.title}</p>
                <p className="mt-1 text-xs font-bold uppercase tracking-wider text-red-400">
                  {item.type === 'series' ? 'Series' : 'Movie'} {item.releaseDate ? `• ${String(item.releaseDate).slice(0, 4)}` : ''}
                </p>
                {item.synopsis ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{item.synopsis}</p>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CleanEmbedButtons() {
  const [sites, setSites] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadSites() {
      try {
        const response = await fetch('/api/embed-sites', { cache: 'no-store' });
        const data = await response.json();
        if (!cancelled) setSites(data.sites || []);
      } catch {
        if (!cancelled) setSites([]);
      }
    }

    loadSites();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {sites.map((site) => (
        <Link
          key={site.id}
          href={`/embed-browser?site=${encodeURIComponent(site.id)}`}
          className="rounded-full border border-orange-500/25 bg-orange-500/10 px-4 py-2 text-sm font-black text-orange-100 transition hover:border-orange-400/70 hover:bg-orange-500/20"
          title={site.url}
        >
          {site.label}
        </Link>
      ))}
    </>
  );
}

function MatchDialog({ item, onClose, onMatched }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  async function submit(event) {
    event?.preventDefault?.();
    const value = query.trim();
    if (!value || status === 'loading') return;
    try {
      setStatus('loading');
      setError('');
      const response = await fetch('/api/title-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: item.title || '',
          year: String(item.year || String(item.releaseDate || '').slice(0, 4) || ''),
          type: item.type === 'series' ? 'series' : 'movie',
          query: value,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Match failed');
      onMatched?.(data.item);
    } catch (err) {
      setError(err.message || 'Match failed');
      setStatus('error');
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black/60" onClick={(event) => event.stopPropagation()}>
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-500">Match poster → TMDB</p>
        <h3 className="mt-2 line-clamp-2 text-lg font-black leading-6 text-white">{item.title}</h3>
        <p className="mt-2 text-xs leading-5 text-zinc-400">
          {item.type === 'series' ? 'Series' : 'Movie'}{item.year ? ` • ${item.year}` : ''} — this poster is not linked to TMDB yet, so no stream servers can be built. Paste its TMDB or IMDb link/id once to bind it permanently.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="themoviedb.org/movie/1132687 or tt0133093"
            autoFocus
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2.5 text-sm text-white outline-none focus:border-red-500"
          />
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-xs leading-5 text-red-200">{error}</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={status === 'loading' || !query.trim()}
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === 'loading' ? 'Matching…' : '🎯 Match'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-zinc-300 transition hover:border-white/40"
            >
              Cancel
            </button>
          </div>
        </form>
        <p className="mt-3 text-[11px] leading-4 text-zinc-600">
          Accepts a TMDB url (themoviedb.org/movie/… or /tv/…), an IMDb url (imdb.com/title/tt…), a bare TMDB id number, or a tt… IMDb id. The match is saved on the server — the poster keeps this TMDB metadata and opens every stream server from then on.
        </p>
      </div>
    </div>
  );
}

function MediaCard({ item, onItemMatched, delay = 0 }) {
  const [matchOpen, setMatchOpen] = useState(false);
  const hasTMDB = Boolean(item.tmdbId);
  const href = hasTMDB
    ? `/watch/${item.type}/${item.tmdbId}${item.type === 'series' && (item.season || item.episode) ? `?season=${item.season || 1}&episode=${item.episode || 1}` : ''}`
    : undefined;
  const Wrapper = hasTMDB ? Link : 'div';

  return (
    <>
      <Wrapper
        href={href}
        className={`jv-card group relative block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-lg shadow-black/25 transition duration-300 active:scale-[0.99] hover:border-red-400/50 hover:bg-zinc-900 hover:shadow-2xl hover:shadow-red-950/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:rounded-3xl sm:shadow-xl ${hasTMDB ? '' : 'cursor-pointer'}`}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return;
          const rect = event.currentTarget.getBoundingClientRect();
          const pxI = (event.clientX - rect.left) / rect.width - 0.5;
          const pyI = (event.clientY - rect.top) / rect.height - 0.5;
          event.currentTarget.style.setProperty('--rx', `${(-pyI * 8).toFixed(2)}deg`);
          event.currentTarget.style.setProperty('--ry', `${(pxI * 8).toFixed(2)}deg`);
          event.currentTarget.style.setProperty('--gx', `${((pxI + 0.5) * 100).toFixed(1)}%`);
          event.currentTarget.style.setProperty('--gy', `${((pyI + 0.5) * 100).toFixed(1)}%`);
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.removeProperty('--rx');
          event.currentTarget.style.removeProperty('--ry');
        }}
      >
        <div className="jv-tilt-inner">
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
            <div className="flex h-full min-h-48 items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black p-4 text-center sm:min-h-64 sm:p-5">
              <span className="text-sm font-black text-zinc-200 sm:text-base">{item.title}</span>
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent opacity-95" />

          {hasTMDB && Number(item.rating) > 0 ? (
            <div className="absolute right-2 top-2 sm:right-3 sm:top-3">
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-black/70 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
                ★ {Number(item.rating).toFixed(1)}
              </span>
            </div>
          ) : null}

          {hasTMDB ? (
            <div className="absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-[linear-gradient(115deg,#f59e0b,#dc2626_50%,#a855f7)] text-white opacity-0 shadow-xl shadow-red-950/40 transition duration-300 group-hover:scale-110 group-hover:opacity-100">
              <Icon name="play" className="h-4 w-4" />
            </div>
          ) : null}

          <div className="absolute left-2 top-2 sm:left-3 sm:top-3">
            <span className="rounded-full bg-black/75 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur sm:px-2.5 sm:py-1 sm:text-[10px]">
              {item.type === 'series' ? 'Series' : 'Movie'}
            </span>
          </div>

          {hasTMDB ? null : (
            <>
              <div className="absolute right-2 top-2 sm:right-3 sm:top-3">
                <span className="rounded-full border border-yellow-400/40 bg-yellow-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-yellow-200 backdrop-blur">
                  Match needed
                </span>
              </div>
              <div className="absolute inset-x-3 bottom-3">
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMatchOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 px-3 py-2 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-red-950/40 transition hover:bg-red-500"
                >
                  <Icon name="target" className="h-3.5 w-3.5" />
                  Match
                </button>
              </div>
            </>
          )}
        </div>

        <div className="p-3 sm:p-4">
          <h3 className="line-clamp-2 min-h-9 text-[13px] font-black leading-4 text-white sm:min-h-10 sm:text-sm sm:leading-5">
            {item.title}
          </h3>
        </div>
        </div>
        <div className="jv-card-glare" aria-hidden="true" />
      </Wrapper>

      {matchOpen ? (
        <MatchDialog
          item={item}
          onClose={() => setMatchOpen(false)}
          onMatched={(matched) => {
            setMatchOpen(false);
            onItemMatched?.(item, matched);
          }}
        />
      ) : null}
    </>
  );
}

function MediaGrid({ items, onItemMatched }) {
  if (!items?.length) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-zinc-400">
        No titles found.
      </div>
    );
  }

  return (
    <MasonryGrid gap={14} minItemWidth={155}>
      {items.map((item) => (
        <MediaCard key={`${item.type}-${item.tmdbId || item.id || item.title}`} item={item} onItemMatched={onItemMatched} />
      ))}
    </MasonryGrid>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:rounded-3xl">
          <div className="aspect-[2/3] animate-pulse bg-zinc-900" />
          <div className="space-y-2 p-3 sm:space-y-3 sm:p-4">
            <div className="h-4 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

function mergeUnique(existing, next) {
  const seen = new Set(existing.map((item) => `${item.tmdbId || ''}:${item.id || ''}:${item.title || ''}`));
  const merged = [...existing];
  for (const item of next || []) {
    const key = `${item.tmdbId || ''}:${item.id || ''}:${item.title || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return merged;
}

function TabButton({ active, children, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] sm:px-5 ${
        active
          ? 'border-transparent bg-[linear-gradient(115deg,#f59e0b,#dc2626_50%,#a855f7)] text-white shadow-lg shadow-red-950/30'
          : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/25 hover:text-white'
      }`}
    >
      <span className="block text-[10px] font-black uppercase tracking-[0.22em] opacity-75 sm:text-xs sm:tracking-[0.25em]">{children}</span>
      <span className="mt-1 block text-xl font-black sm:text-2xl">{count}</span>
    </button>
  );
}

function HeroCarousel({ items }) {
  const slides = useMemo(
    () => (items || []).filter((item) => item.tmdbId && (item.backdropUrl || item.posterUrl)).slice(0, 6),
    [items],
  );
  const [idx, setIdx] = useState(0);
  const pausedRef = useRef(false);
  const touchRef = useRef(null);
  useLibraryVersion(); // heart state stays in sync with My List

  useEffect(() => {
    if (slides.length < 2) return undefined;
    const timer = setInterval(() => {
      if (!pausedRef.current) setIdx((value) => (value + 1) % slides.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [slides.length]);

  if (!slides.length) return null;

  const current = Math.min(idx, slides.length - 1);
  const go = (dir) => setIdx((value) => (value + dir + slides.length) % slides.length);

  return (
    <section aria-label="Featured releases" className="mx-auto mt-6 max-w-7xl px-4 sm:mt-8 sm:px-6 lg:px-8">
      <div
        className="jv-hero jv-reveal relative h-[54svh] min-h-[300px] max-h-[560px] overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50"
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse') return;
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.style.setProperty('--hpx', ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3));
          event.currentTarget.style.setProperty('--hpy', ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3));
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.removeProperty('--hpx');
          event.currentTarget.style.removeProperty('--hpy');
        }}
        onTouchStart={(event) => { touchRef.current = event.touches[0].clientX; }}
        onTouchEnd={(event) => {
          const start = touchRef.current;
          touchRef.current = null;
          if (start == null) return;
          const delta = event.changedTouches[0].clientX - start;
          if (Math.abs(delta) > 48) {
            pausedRef.current = true;
            go(delta < 0 ? 1 : -1);
            setTimeout(() => { pausedRef.current = false; }, 9000);
          }
        }}
      >
        {slides.map((item, slideIdx) => {
          const active = slideIdx === current;
          const href = `/watch/${item.type}/${item.tmdbId}${item.type === 'series' ? `?season=${item.season || 1}&episode=${item.episode || 1}` : ''}`;
          const art = item.backdropUrl || item.posterUrl;
          const favKey = makeWatchKey({ type: item.type, tmdbId: item.tmdbId });
          const favorite = isFavoriteItem(favKey);
          const year = String(item.releaseDate || '').slice(0, 4);
          return (
            <div
              key={`${item.type}-${item.tmdbId}`}
              className={`absolute inset-0 transition-opacity duration-[900ms] ease-out ${active ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0'}`}
              aria-hidden={!active}
            >
              <img src={art} alt={item.title} loading={slideIdx === 0 ? "eager" : "lazy"} decoding="async" className="jv-hero-art h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-[#050505]/40 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#050505]/90 via-[#050505]/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 max-w-2xl p-4 sm:p-8 lg:p-10">
                <p className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.26em] text-amber-300 sm:mb-2.5 sm:text-xs">
                  <Icon name="sparkle" className="h-3.5 w-3.5" /> New Release
                </p>
                <h3 className="jv-hero-title line-clamp-2 text-2xl font-black leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">{item.title}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-zinc-300 sm:mt-3 sm:text-xs">
                  <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 uppercase tracking-wider backdrop-blur">{item.type === 'series' ? 'Series' : 'Movie'}</span>
                  {year ? <span className="rounded-full border border-white/15 bg-black/50 px-2 py-0.5 backdrop-blur">{year}</span> : null}
                  {Number(item.rating) > 0 ? <span className="rounded-full border border-amber-300/30 bg-black/50 px-2 py-0.5 text-amber-300 backdrop-blur">★ {Number(item.rating).toFixed(1)}</span> : null}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2.5 sm:mt-5 sm:gap-3">
                  <Link href={href} className="jv-btn-solid !px-5 !py-2.5 text-sm sm:!px-7 sm:!py-3 sm:text-base">
                    <Icon name="play" className="h-4 w-4 sm:h-5 sm:w-5" /> Play Now
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggleFavoriteItem({
                      key: favKey,
                      type: item.type,
                      tmdbId: item.tmdbId,
                      title: item.title,
                      posterUrl: item.posterUrl,
                      backdropUrl: item.backdropUrl,
                      rating: item.rating,
                      releaseDate: item.releaseDate,
                    })}
                    className="jv-btn-ghost !px-4 !py-2.5 text-sm sm:!py-3"
                  >
                    <span className={favorite ? "text-emerald-300" : ""}><Icon name={favorite ? "check" : "plus"} className="h-4 w-4" /></span>
                    {favorite ? 'In My List' : 'My List'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {slides.length > 1 ? (
          <>
            <button type="button" aria-label="Previous featured title" onClick={() => go(-1)} className="absolute left-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 sm:grid">
              <Icon name="chevL" className="h-5 w-5" />
            </button>
            <button type="button" aria-label="Next featured title" onClick={() => go(1)} className="absolute right-3 top-1/2 z-20 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 sm:grid">
              <Icon name="chevR" className="h-5 w-5" />
            </button>
            <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1.5 sm:bottom-6 sm:right-8">
              {slides.map((item, dotIdx) => (
                <button
                  key={`dot-${item.type}-${item.tmdbId}`}
                  type="button"
                  aria-label={`Featured slide ${dotIdx + 1}`}
                  onClick={() => setIdx(dotIdx)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${dotIdx === current ? 'w-7 bg-gradient-to-r from-amber-400 via-red-500 to-purple-500' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

export default function LandingPage() {
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [activeTab, setActiveTab] = useState('movies');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [scrapeStatus, setScrapeStatus] = useState('loading');
  const [scrapeError, setScrapeError] = useState('');
  const [syncStatus, setSyncStatus] = useState('idle');
  const [paging, setPaging] = useState({
    movies: { page: 1, hasMore: false, loading: false, total: 0 },
    series: { page: 1, hasMore: false, loading: false, total: 0 },
  });

  const sentinelRef = useRef(null);

  const featuredItems = useMemo(() => [...movies, ...series], [movies, series]);

  useEffect(() => {
    const cached = readSessionCache(HOME_CACHE_KEY);
    if (cached?.movies?.length || cached?.series?.length) {
      setMovies(cached.movies || []);
      setSeries(cached.series || []);
      setActiveTab(cached.activeTab || 'movies');
      setUpdatedAt(cached.updatedAt || null);
      setPaging(cached.paging || {
        movies: { page: 1, hasMore: false, loading: false, total: 0 },
        series: { page: 1, hasMore: false, loading: false, total: 0 },
      });
      setScrapeStatus(cached.scrapeStatus || 'ready');
      restoreScroll(HOME_CACHE_KEY);
      return;
    }

    async function loadInitialTitles() {
      try {
        setScrapeStatus('loading');
        const response = await fetch(`/api/tamilmv?page=1&limit=${PAGE_SIZE}`, { cache: 'no-store' });
        const data = await response.json();

        if (!response.ok) throw new Error(data?.error || 'Unable to load scraped titles');

        setMovies(data.movies || []);
        setSeries(data.series || []);
        setUpdatedAt(data.updatedAt || data.refreshedAt || null);
        setPaging({
          movies: {
            page: data.pagination?.movies?.page || 1,
            hasMore: Boolean(data.pagination?.movies?.hasMore),
            loading: false,
            total: data.pagination?.movies?.total || data.movies?.length || 0,
          },
          series: {
            page: data.pagination?.series?.page || 1,
            hasMore: Boolean(data.pagination?.series?.hasMore),
            loading: false,
            total: data.pagination?.series?.total || data.series?.length || 0,
          },
        });
        setScrapeStatus('ready');
      } catch (error) {
        setScrapeError(error.message || 'Unable to load scraped titles');
        setScrapeStatus('error');
      }
    }

    loadInitialTitles();
  }, []);

  useEffect(() => {
    writeSessionCache(HOME_CACHE_KEY, {
      movies,
      series,
      activeTab,
      updatedAt,
      paging,
      scrapeStatus,
    });
  }, [movies, series, activeTab, updatedAt, paging, scrapeStatus]);

  useEffect(() => {
    const onScroll = () => saveScroll(HOME_CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      saveScroll(HOME_CACHE_KEY);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const loadMore = useCallback(async (group) => {
    const current = paging[group];
    if (!current || current.loading || !current.hasMore || scrapeStatus !== 'ready') return;

    const nextPage = current.page + 1;
    setPaging((prev) => ({
      ...prev,
      [group]: { ...prev[group], loading: true },
    }));

    try {
      const response = await fetch(`/api/tamilmv?group=${group}&page=${nextPage}&limit=${PAGE_SIZE}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Unable to load more ${group}`);

      if (group === 'movies') setMovies((items) => mergeUnique(items, data.movies || []));
      if (group === 'series') setSeries((items) => mergeUnique(items, data.series || []));

      const info = data.pagination?.[group] || {};
      setPaging((prev) => ({
        ...prev,
        [group]: {
          page: info.page || nextPage,
          hasMore: Boolean(info.hasMore),
          loading: false,
          total: info.total || prev[group].total,
        },
      }));
    } catch (error) {
      setPaging((prev) => ({
        ...prev,
        [group]: { ...prev[group], loading: false },
      }));
      setScrapeError(error.message || `Unable to load more ${group}`);
    }
  }, [paging, scrapeStatus]);

  const syncLatestReleases = useCallback(async () => {
    if (syncStatus === 'syncing') return;
    try {
      setSyncStatus('syncing');
      setScrapeError('');
      const response = await fetch(`/api/tamilmv?sync=1&manual=1&page=1&limit=${PAGE_SIZE}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Sync failed');
      setMovies(data.movies || []);
      setSeries(data.series || []);
      setUpdatedAt(data.updatedAt || data.refreshedAt || null);
      setPaging({
        movies: {
          page: data.pagination?.movies?.page || 1,
          hasMore: Boolean(data.pagination?.movies?.hasMore),
          loading: false,
          total: data.pagination?.movies?.total || data.movies?.length || 0,
        },
        series: {
          page: data.pagination?.series?.page || 1,
          hasMore: Boolean(data.pagination?.series?.hasMore),
          loading: false,
          total: data.pagination?.series?.total || data.series?.length || 0,
        },
      });
      setScrapeStatus('ready');
      setSyncStatus('ready');
      window.setTimeout(() => setSyncStatus('idle'), 1600);
    } catch (error) {
      setScrapeError(error.message || 'Sync failed');
      setScrapeStatus('error');
      setSyncStatus('error');
      window.setTimeout(() => setSyncStatus('idle'), 2200);
    }
  }, [syncStatus]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (scrapeStatus === 'ready') loadMore(activeTab);
      },
      { rootMargin: '700px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [activeTab, loadMore, scrapeStatus]);

  const currentItems = activeTab === 'movies' ? movies : series;
  const currentPaging = paging[activeTab];
  const currentStatus = scrapeStatus;
  const currentError = scrapeError;

  // A Match dialog success swaps the matched poster's metadata in-place:
  // it becomes a normal /watch/{type}/{tmdbId} card immediately.
  const handleItemMatched = useCallback((prevItem, matched) => {
    if (!matched?.tmdbId) return;
    const isTarget = (entry) =>
      (prevItem.id && entry.id === prevItem.id) ||
      (entry.title === prevItem.title && (entry.type || 'movie') === (prevItem.type || 'movie'));
    const apply = (items) => (items || []).map((entry) => {
      if (!isTarget(entry)) return entry;
      const type = matched.type === 'series' ? 'series' : 'movie';
      return {
        ...entry,
        id: `tamilmv-${type}-${matched.tmdbId}`,
        tmdbId: matched.tmdbId,
        type,
        title: matched.title || entry.title,
        year: matched.year || entry.year || '',
        posterUrl: matched.posterUrl || entry.posterUrl || '',
        synopsis: matched.synopsis || entry.synopsis || '',
        matchedBy: 'manual',
      };
    });
    setMovies((items) => apply(items));
    setSeries((items) => apply(items));
  }, []);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050505] text-zinc-100">
      <section className="relative overflow-visible border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,_rgba(220,38,38,0.28),_transparent_34%),radial-gradient(circle_at_85%_20%,_rgba(234,179,8,0.12),_transparent_30%),linear-gradient(to_bottom,_rgba(0,0,0,0),_#050505)]" />
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
                <img
                  src="/brand/logo.png"
                  alt="JaSH ViBeS logo"
                  className="h-24 w-24 rounded-full object-contain drop-shadow-[0_0_28px_rgba(217,70,239,0.45)] sm:h-32 sm:w-32 lg:h-36 lg:w-36"
                  loading="eager"
                  decoding="async"
                />
                <h1 className="jash-vibes-logo text-4xl tracking-tight min-[380px]:text-5xl sm:text-7xl lg:text-8xl">
                  JaSH ViBeS
                </h1>
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Link href="/music" title="Music — ராக வானம்" className="jv-btn-ghost">
                  <span className="text-emerald-300"><Icon name="music" className="h-4 w-4" /></span> Music
                </Link>
                <Link href="/sports" className="jv-btn-ghost">
                  <span className="text-amber-300"><Icon name="trophy" className="h-4 w-4" /></span> Sports
                </Link>
                <Link href="/live" className="jv-btn-ghost">
                  <span className="text-red-400"><Icon name="live" className="h-4 w-4" /></span> Live TV
                </Link>
                <a href="/stremio?home=1" onClick={(event) => { event.preventDefault(); window.location.assign('/stremio?home=1'); }} className="jv-btn-ghost">
                  <span className="text-fuchsia-300"><Icon name="sparkle" className="h-4 w-4" /></span> Stremio
                </a>
                <Link href="/my-list" title="My List & Continue Watching" className="jv-btn-ghost">
                  <span className="text-rose-400"><Icon name="heart" className="h-4 w-4" /></span> My List
                </Link>
                <CleanEmbedButtons />
              </div>
            </div>

            <div className="sticky top-2 z-40 w-full lg:top-6 lg:max-w-md">
              <SearchBox />
            </div>
          </div>

        </div>
      </section>

      <HeroCarousel items={featuredItems} />

      <LibraryRows />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-2xl shadow-black/20 sm:mb-8 sm:rounded-3xl sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-extrabold text-white">Latest Releases</h2>
                <button
                  type="button"
                  onClick={syncLatestReleases}
                  disabled={syncStatus === 'syncing'}
                  className="rounded-full border border-yellow-400/25 bg-yellow-400/10 px-3 py-1.5 text-xs font-black text-yellow-100 transition hover:border-yellow-300 hover:bg-yellow-400/20 disabled:cursor-wait disabled:opacity-60"
                >
                  {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'ready' ? 'Synced' : 'Sync'}
                </button>
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                Fresh movies and series. Last update: {formatDateTime(updatedAt)}. Posters without a TMDB match show a 🎯 Match button — bind them once to unlock every stream server.
              </p>
            </div>

            <div className="sticky top-16 z-30 -mx-1 grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-[#050505]/90 p-1.5 backdrop-blur sm:static sm:mx-0 sm:min-w-96 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
              <TabButton active={activeTab === 'movies'} count={movies.length} onClick={() => setActiveTab('movies')}>
                Movies
              </TabButton>
              <TabButton active={activeTab === 'series'} count={series.length} onClick={() => setActiveTab('series')}>
                Series
              </TabButton>
            </div>
          </div>

          {currentStatus === 'loading' ? (
            <p className="mt-4 text-sm text-zinc-500">Loading latest scraped titles...</p>
          ) : null}
          {currentStatus === 'error' ? (
            <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
              {currentError}
            </p>
          ) : null}
        </div>

        {currentStatus === 'loading' ? <LoadingGrid /> : null}

        {currentStatus === 'ready' ? (
          <section className="scroll-mt-8">
            <div className="mb-4 flex items-end justify-between gap-3 sm:mb-5 sm:gap-4">
              <div>
                <p className="jv-shimmer-text text-[10px] font-black uppercase tracking-[0.22em] sm:text-xs sm:tracking-[0.28em]">
                  {activeTab === 'movies' ? 'Movies' : 'Series'}
                </p>
                <h2 className="mt-1 text-2xl font-extrabold text-white sm:mt-2 sm:text-3xl">
                  {activeTab === 'movies' ? 'Movies' : 'Series'}
                </h2>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-zinc-400 sm:px-3 sm:text-sm">
                {currentItems.length}{currentPaging.total ? ` / ${currentPaging.total}` : ''} loaded
              </span>
            </div>

            <MediaGrid items={currentItems} onItemMatched={handleItemMatched} />

            <div ref={sentinelRef} className="mt-10 flex min-h-24 items-center justify-center">
              {currentPaging.loading ? (
                <div className="flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-zinc-300 sm:w-auto">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-red-500" />
                  Loading more {activeTab}...
                </div>
              ) : currentPaging.hasMore ? (
                <button
                  type="button"
                  onClick={() => loadMore(activeTab)}
                  className="w-full rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-red-500 hover:bg-red-500/10 sm:w-auto"
                >
                  Load more {activeTab}
                </button>
              ) : (
                <p className="text-sm text-zinc-500">No more {activeTab} in the catalog.</p>
              )}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
