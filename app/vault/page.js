'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { watchHref } from '@/lib/watch/policy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import Icon from '@/components/Icons';
import { readSessionCache, writeSessionCache } from '@/lib/clientCache';
import { episodeLabel, groupEpisodes } from '@/lib/vaultEpisodes';

/**
 * The Vault — "Neon Control Deck" (v10.9.0).
 *
 * The full browse surface for the mv_vault catalogue, in the chosen concept:
 * glowing cyan deck head, glass control rail, decade waveform scrubber, and
 * sharp neon-edged poster tiles. Desktop gets a sticky left control rail;
 * mobile gets the same controls as horizontally-scrolling pill rows — both
 * were built together and every control exists in both shells.
 *
 * Architecture: the whole catalogue (currently ~600 titles) ships to the
 * browser once and every filter/search/sort runs client-side, so scrubbing the
 * decade wave or typing is instant with zero round-trips. The server's 30-minute
 * upstream cache (lib/vault.js) is the freshness contract; `?force=1` is the
 * escape hatch when you want the just-finished scrape letter *now*.
 *
 * Series (v10.9.1): a record with `kind: 'series'` carries one embed per quality
 * per episode. The tile gets an episode badge and the player gains an episode
 * strip, so a 20-episode show is a playable season rather than a wall of
 * "1080p · #7"-style chips. Movies are untouched — `groupEpisodes` returns
 * nothing for them and every code path falls back to the original behaviour.
 *
 * Playback: tiles open the instant embed player — a modal iframe pointed at the
 * onestream embed, no route change, no resolve round-trip. Embeds are sorted
 * best-first (1080p before 720p) and chips switch quality/source inside the
 * modal, which is how a dead embed costs one click instead of a dead end.
 */

const CACHE_KEY = 'jash:vault:v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const GRID_STEP = 60;

const SORTS = [
  { id: 'newest', label: 'Newest', hint: 'latest vaulted' },
  { id: 'rating', label: 'Top rated', hint: 'highest first' },
  { id: 'az', label: 'A–Z', hint: 'alphabetical' },
  { id: 'year', label: 'Year', hint: 'newest year first' },
];

const QUALITIES = [
  { id: 'any', label: 'Any quality' },
  { id: '1080p', label: '1080p' },
  { id: '720p', label: '720p' },
];

function relativeTime(iso) {
  const then = Date.parse(iso || '');
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function qualityChipClass(quality) {
  if (quality === '1080p') return 'jv-vault-chip jv-vault-chip-hd';
  if (quality === '720p') return 'jv-vault-chip jv-vault-chip-hq';
  return 'jv-vault-chip';
}

/* ── waveform scrubber ──────────────────────────────────────────────── */

function WaveScrubber({ decades, value, onChange, total }) {
  const max = Math.max(1, ...decades.map((entry) => entry.count));
  const bars = [{ decade: 'all', label: 'All', count: total }, ...decades];
  return (
    <div className="jv-vault-wave" role="group" aria-label="Decade scrubber">
      {bars.map((bar) => {
        const active = String(value) === String(bar.decade);
        const height = bar.decade === 'all' ? 100 : Math.max(14, Math.round((bar.count / max) * 100));
        return (
          <button
            key={bar.decade}
            type="button"
            aria-pressed={active}
            title={`${bar.label} — ${bar.count} films`}
            className={`jv-vault-wave-col${active ? ' jv-vault-wave-on' : ''}`}
            onClick={() => onChange(active ? 'all' : bar.decade)}
          >
            <span className="jv-vault-wave-track">
              <span className="jv-vault-wave-bar" style={{ height: `${height}%` }} />
            </span>
            <span className="jv-vault-wave-count">{bar.count}</span>
            <span className="jv-vault-wave-label">{bar.label || bar.decade}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── poster tile ────────────────────────────────────────────────────── */

function VaultTile({ movie, onPlay }) {
  return (
    <button
      type="button"
      className="jv-vault-card group"
      onClick={() => onPlay(movie)}
      title={movie.isSeries
        ? `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''} — ${movie.episodeCount} episode${movie.episodeCount === 1 ? '' : 's'}`
        : `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''}`}
    >
      {movie.poster ? (
        <img
          src={movie.poster}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className="jv-vault-poster"
        />
      ) : (
        <span className="jv-vault-poster jv-vault-poster-none" aria-hidden="true">
          {String(movie.title || '??').slice(0, 2).toUpperCase()}
        </span>
      )}

      {movie.quality ? <span className={qualityChipClass(movie.quality)}>{movie.quality}</span> : null}

      {movie.isSeries ? (
        <span className="jv-vault-chip jv-vault-chip-series">
          {movie.episodeCount ? `${movie.episodeCount} EP` : 'SERIES'}
        </span>
      ) : null}

      <span className="jv-vault-play" aria-hidden="true">
        <Icon name="play" className="h-7 w-7" />
      </span>

      <span className="jv-vault-caption">
        <span className="jv-vault-name">{movie.title}</span>
        <span className="jv-vault-meta">
          {movie.year || '—'}
          {movie.isSeries ? <span className="jv-vault-ep-count">{movie.episodeCount} ep</span> : null}
          {movie.rating ? <span className="jv-vault-star">★ {movie.rating.toFixed(1)}</span> : null}
        </span>
      </span>
    </button>
  );
}

/* ── instant embed player ───────────────────────────────────────────── */



/* ── skeletons & notes ──────────────────────────────────────────────── */

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <div key={index} className="jv-vault-card aspect-[2/3] animate-pulse bg-white/[0.03]" />
      ))}
    </div>
  );
}

/* ── the page ───────────────────────────────────────────────────────── */

export default function VaultPage() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [query, setQuery] = useState('');
  const [decade, setDecade] = useState('all');
  const [quality, setQuality] = useState('any');
  const [sort, setSort] = useState('newest');
  const [letter, setLetter] = useState('');
  const [visible, setVisible] = useState(GRID_STEP);
  const router = useRouter();
  const openWatch = useCallback((movie) => router.push(watchHref(movie, 'vault')), [router]);

  const sentinelRef = useRef(null);
  const playHandledRef = useRef(false);

  /* Load: session cache paints instantly, network confirms or replaces it. */
  useEffect(() => {
    let alive = true;
    const apply = (payload) => {
      if (!alive || !payload?.movies?.length) return;
      setData(payload);
      setStatus('ready');
    };

    apply(readSessionCache(CACHE_KEY, CACHE_TTL_MS));

    const force = new URLSearchParams(window.location.search).has('force');
    fetch(`/api/vault${force ? '?force=1' : ''}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status === 401 ? 'Unlock JaSH ViBeS first.' : `vault ${response.status}`))))
      .then((payload) => {
        if (!alive) return;
        if (payload?.movies) writeSessionCache(CACHE_KEY, payload);
        if (payload?.movies?.length) apply(payload);
        else if (!readSessionCache(CACHE_KEY, CACHE_TTL_MS)) throw new Error('The vault catalogue is empty.');
      })
      .catch((err) => {
        if (!alive && status === 'ready') return;
        setError(err?.message || 'The vault is unreachable right now.');
        setStatus((prev) => (prev === 'ready' ? 'ready' : 'error'));
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Deep link: /vault?play=<id> opens the player the moment data lands. */
  useEffect(() => {
    if (playHandledRef.current || !data?.movies?.length) return;
    const id = new URLSearchParams(window.location.search).get('play');
    playHandledRef.current = true;
    if (!id) return;
    const movie = data.movies.find((entry) => entry.id === id);
    if (movie) router.replace(watchHref(movie, 'vault'));
  }, [data]);

  /* Facets + letter index, derived from the full list. */
  const facets = data?.facets;
  const letters = useMemo(() => {
    const counts = new Map();
    for (const movie of data?.movies || []) counts.set(movie.letter, (counts.get(movie.letter) || 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)));
  }, [data]);

  /* One filter+sort pipeline — every control writes state, this reads it. */
  const filtered = useMemo(() => {
    const movies = data?.movies || [];
    const needle = query.trim().toLowerCase();
    const list = movies.filter((movie) => {
      if (needle && !`${movie.title} ${movie.year}`.toLowerCase().includes(needle)) return false;
      if (decade !== 'all' && movie.decade !== decade) return false;
      if (quality !== 'any' && !movie.embeds.some((embed) => String(embed.quality).toLowerCase() === quality)) return false;
      if (letter && movie.letter !== letter) return false;
      return true;
    });
    const byAdded = (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')) || b.year - a.year;
    if (sort === 'newest') list.sort(byAdded);
    else if (sort === 'year') list.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating || byAdded(a, b));
    else if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [data, query, decade, quality, letter, sort]);

  /* Reset paging whenever the result set changes shape. */
  useEffect(() => { setVisible(GRID_STEP); }, [query, decade, quality, letter, sort]);

  /* Infinite scroll: one sentinel, one observer, no scroll math. */
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setVisible((prev) => Math.min(prev + GRID_STEP, filtered.length));
    }, { rootMargin: '900px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [filtered.length]);

  const shown = filtered.slice(0, visible);
  const forceRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/vault?force=1');
      const payload = await response.json();
      if (payload?.movies?.length) {
        writeSessionCache(CACHE_KEY, payload);
        setData(payload);
        setStatus('ready');
        setError('');
      }
    } catch { /* keep the current view */ } finally {
      setRefreshing(false);
    }
  };

  const clearAll = () => { setQuery(''); setDecade('all'); setQuality('any'); setLetter(''); };

  return (
    <main className="jv-vault-page jv-rail-shift min-h-dvh overflow-x-hidden text-zinc-100">
      <RailNav />

      <section className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-8">
        {/* ── deck head ── */}
        <header className="jv-vault-head">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h1 className="jv-vault-title">VAULT</h1>
              <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-100/60">
                {facets ? (
                  <>
                    {facets.total} movies · {facets.posters} posters · {facets.qualities['1080p']} in 1080p
                    {data?.fetchedAt ? <span className="text-zinc-600"> · updated {relativeTime(data.fetchedAt)}</span> : null}
                  </>
                ) : 'loading the deck…'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={forceRefresh}
                disabled={refreshing}
                className="jv-vault-glass flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-zinc-300 transition hover:border-cyan-400/50 hover:text-white disabled:opacity-50"
              >
                <Icon name="refresh" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Checking…' : 'Sync now'}
              </button>
              <span className="jv-vault-glass hidden rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200/70 sm:block">
                30 min auto-sync
              </span>
            </div>
          </div>

          {/* search — the circular dial, expanded */}
          <div className="jv-vault-search mt-4">
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the vault…"
              aria-label="Search movies"
              className="w-full bg-transparent pl-11 pr-10 py-2.5 text-sm font-semibold text-white placeholder:text-zinc-600 focus:outline-none"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                <Icon name="close" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </header>

        {/* ── decade waveform ── */}
        {facets?.decades?.length ? (
          <div className="jv-vault-glass mt-4 rounded-xl px-3 pb-2 pt-3 sm:px-4">
            <WaveScrubber decades={facets.decades} total={facets.total} value={decade} onChange={setDecade} />
          </div>
        ) : null}

        {/* ── mobile pills (desktop rail mirrors every control) ── */}
        <div className="mt-3 space-y-2 lg:hidden">
          <div className="jv-vault-pills" aria-label="Sort">
            {SORTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={sort === entry.id}
                onClick={() => setSort(entry.id)}
                className={sort === entry.id ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}
              >
                {entry.label}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={quality !== 'any'}
              onClick={() => setQuality(quality === '1080p' ? '720p' : quality === '720p' ? 'any' : '1080p')}
              className={quality !== 'any' ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}
            >
              {quality === 'any' ? '1080p only' : quality === '1080p' ? '720p only' : 'any quality'}
            </button>
          </div>
          <div className="jv-vault-pills" aria-label="Decade">
            <button type="button" aria-pressed={decade === 'all'} onClick={() => setDecade('all')} className={decade === 'all' ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}>All</button>
            {(facets?.decades || []).map((entry) => (
              <button
                key={entry.decade}
                type="button"
                aria-pressed={decade === entry.decade}
                onClick={() => setDecade(decade === entry.decade ? 'all' : entry.decade)}
                className={decade === entry.decade ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}
              >
                {entry.decade} <span className="opacity-60">{entry.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── A–Z strip ── */}
        <div className="jv-vault-pills mt-3" aria-label="Jump to letter">
          <button type="button" aria-pressed={!letter} onClick={() => setLetter('')} className={!letter ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}>#All</button>
          {letters.map(([value, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={letter === value}
              onClick={() => setLetter(letter === value ? '' : value)}
              className={letter === value ? 'jv-vault-pill jv-vault-pill-on' : 'jv-vault-pill'}
            >
              {value}<span className="ml-1 opacity-50">{count}</span>
            </button>
          ))}
        </div>

        {/* ── body: control rail (desktop) + grid ── */}
        <div className="mt-5 flex gap-6">
          {/* desktop control rail */}
          <aside className="jv-vault-glass sticky top-5 hidden h-fit w-56 shrink-0 flex-col gap-5 rounded-2xl p-4 lg:flex" aria-label="Vault controls">
            <div>
              <p className="jv-vault-rail-label">Sort</p>
              <div className="mt-2 flex flex-col gap-1">
                {SORTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={sort === entry.id}
                    onClick={() => setSort(entry.id)}
                    className={sort === entry.id ? 'jv-vault-rail-opt jv-vault-rail-opt-on' : 'jv-vault-rail-opt'}
                  >
                    {entry.label}
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-50">{entry.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="jv-vault-rail-label">Quality</p>
              <div className="mt-2 flex flex-col gap-1">
                {QUALITIES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={quality === entry.id}
                    onClick={() => setQuality(entry.id)}
                    className={quality === entry.id ? 'jv-vault-rail-opt jv-vault-rail-opt-on' : 'jv-vault-rail-opt'}
                  >
                    {entry.label}
                    {entry.id !== 'any' && facets ? (
                      <span className="text-[10px] font-semibold opacity-50">{facets.qualities[entry.id] || 0}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="jv-vault-rail-label">Decade</p>
              <div className="mt-2 flex flex-col gap-1">
                <button type="button" aria-pressed={decade === 'all'} onClick={() => setDecade('all')} className={decade === 'all' ? 'jv-vault-rail-opt jv-vault-rail-opt-on' : 'jv-vault-rail-opt'}>
                  All <span className="text-[10px] font-semibold opacity-50">{facets?.total || 0}</span>
                </button>
                {(facets?.decades || []).map((entry) => (
                  <button
                    key={entry.decade}
                    type="button"
                    aria-pressed={decade === entry.decade}
                    onClick={() => setDecade(decade === entry.decade ? 'all' : entry.decade)}
                    className={decade === entry.decade ? 'jv-vault-rail-opt jv-vault-rail-opt-on' : 'jv-vault-rail-opt'}
                  >
                    {entry.decade} <span className="text-[10px] font-semibold opacity-50">{entry.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {(query || decade !== 'all' || quality !== 'any' || letter) ? (
              <button type="button" onClick={clearAll} className="jv-vault-rail-opt justify-center border border-cyan-400/30 text-cyan-200 hover:border-cyan-400/70">
                Clear filters
              </button>
            ) : null}
          </aside>

          {/* results */}
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500">
                {status === 'ready' ? <>showing <span className="text-cyan-300">{filtered.length}</span> of {data?.movies?.length || 0}</> : '\u00A0'}
              </p>
              {sort !== 'newest' || decade !== 'all' ? (
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                  {SORTS.find((entry) => entry.id === sort)?.label}{decade !== 'all' ? ` · ${decade}` : ''}
                </p>
              ) : null}
            </div>

            {status === 'loading' ? <SkeletonGrid /> : null}

            {status === 'error' ? (
              <div className="jv-vault-glass rounded-2xl p-8 text-center">
                <p className="text-sm font-bold text-red-300">{error}</p>
                <button type="button" onClick={forceRefresh} className="jv-vault-src-chip mt-4">Try again</button>
              </div>
            ) : null}

            {status === 'ready' && !filtered.length ? (
              <div className="jv-vault-glass rounded-2xl p-10 text-center">
                <p className="text-sm font-bold text-zinc-300">Nothing matches that combination.</p>
                <button type="button" onClick={clearAll} className="jv-vault-src-chip mt-4">Clear filters</button>
              </div>
            ) : null}

            {status === 'ready' && filtered.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {shown.map((movie) => (
                    <VaultTile key={movie.id} movie={movie} onPlay={openWatch} />
                  ))}
                </div>
                {visible < filtered.length ? (
                  <div ref={sentinelRef} className="py-6 text-center text-[11px] font-black uppercase tracking-[0.18em] text-zinc-600">
                    loading more…
                  </div>
                ) : (
                  <div className="py-6 text-center text-[11px] font-black uppercase tracking-[0.18em] text-zinc-700">
                    end of the deck — {filtered.length} films
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </section>


    </main>
  );
}
