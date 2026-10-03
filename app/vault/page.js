'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { watchHref } from '@/lib/watch/policy';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import Icon from '@/components/Icons';
import { readSessionCache, writeSessionCache } from '@/lib/clientCache';
import { POSTER_SIZES_ATTR, tmdbImageSrcSet } from '@/lib/tmdbPoster';
import { revealStyle, useReveal } from '@/lib/useReveal';

/**
 * The Vault — "Control Deck" (v10.11.0).
 *
 * The chosen direction of the three filter/sort architectures that were built
 * side by side. It keeps the cyan deck the vault always had and changes the way
 * you drive it: every filter is a group in one rail, and **every option carries
 * a live count** — the number of titles that click would leave you with. An
 * option that would return nothing is greyed and struck through instead of
 * leading you into an empty grid, which is the difference between an instrument
 * and a row of switches.
 *
 * The counts are honest because each one is computed with that option's own
 * dimension lifted: the number next to "1080p" is "how many of the titles that
 * pass every OTHER filter hold a 1080p source", not a static catalogue total.
 *
 * Architecture is unchanged: the whole catalogue ships to the browser once,
 * filter/search/sort run client-side with zero round-trips, the server keeps its
 * ~30-minute upstream cache (lib/vault.js) and `?force=1` still bypasses it.
 *
 * What changed under the hood: `lib/vault.js` now lifts `originalLanguage` and
 * `category` from the upstream record (they were always in the payload and were
 * being thrown away), which is what makes the language / original-vs-dubbed
 * filters possible at all — no new scraping.
 *
 * Deliberately absent: genre (the `category` field is a site bucket, not
 * Action/Drama), runtime, cast, popularity, and watch progress (history was
 * removed from this app on purpose). The rail says so in words rather than
 * offering filters that would lie.
 */

// v2: the payload gained language/origin; a v1 entry from a previous visit
// would paint a rail whose every count is zero until the network answered.
const CACHE_KEY = 'jash:vault:v2';
const CACHE_TTL_MS = 30 * 60 * 1000;
const GRID_STEP = 60;

const SORTS = [
  { id: 'newest', label: 'Newest', hint: 'latest vaulted' },
  { id: 'rating', label: 'Top rated', hint: 'highest first' },
  { id: 'year', label: 'Year', hint: 'newest year first' },
  { id: 'az', label: 'A–Z', hint: 'alphabetical' },
  { id: 'sources', label: 'Sources', hint: 'most mirrors first' },
];

const ORIGINS = [
  { id: 'any', label: 'All' },
  { id: 'tamil', label: 'Tamil' },
  { id: 'dubbed', label: 'Dubbed' },
];

const QUALITY_KEYS = ['1080p', '720p', 'HD', '360p'];
const SOURCE_KEYS = [
  { id: '1', label: '1 mirror' },
  { id: '2', label: '2 mirrors' },
  { id: '3-4', label: '3–4 mirrors' },
  { id: '5+', label: '5+ mirrors' },
];
const RATING_KEYS = [
  { id: '5', label: '5+' },
  { id: '6', label: '6+' },
  { id: '7', label: '7+' },
  { id: '8', label: '8+' },
  { id: 'unrated', label: 'Unrated' },
];
const ERA_KEYS = ['2020s', '2010s', '2000s', '1990s', '1980s', 'pre-1980'];
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');

const EMPTY_FILTERS = {
  origin: 'any',
  languages: [],
  qualities: [],
  sources: [],
  rating: 'any',
  eras: [],
  letter: '',
};

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

function sourceBucket(count) {
  if (count <= 1) return '1';
  if (count === 2) return '2';
  if (count <= 4) return '3-4';
  return '5+';
}

/** Era of a record, or '' when the year is missing (one record today). */
function eraOf(year) {
  const value = Number(year) || 0;
  if (value <= 0) return '';
  if (value >= 2020) return '2020s';
  if (value >= 2010) return '2010s';
  if (value >= 2000) return '2000s';
  if (value >= 1990) return '1990s';
  if (value >= 1980) return '1980s';
  return 'pre-1980';
}

/**
 * Does this record survive the current filters?
 *
 * `skip` lifts ONE dimension. That is the whole trick behind a live count: a
 * count for dimension X is computed by asking every record to pass everything
 * except X, so the number answers "how many would be left if I clicked this".
 */
function passes(movie, filters, needle, skip) {
  if (needle && !`${movie.title} ${movie.year}`.toLowerCase().includes(needle)) return false;
  if (skip !== 'language') {
    if (filters.languages.length && !filters.languages.includes(movie.language)) return false;
    if (filters.origin === 'tamil' && movie.origin !== 'tamil') return false;
    if (filters.origin === 'dubbed' && movie.origin !== 'dubbed') return false;
  }
  if (skip !== 'quality' && filters.qualities.length) {
    const marks = movie.embeds.map((embed) => String(embed.quality).toLowerCase());
    if (!filters.qualities.some((quality) => marks.includes(quality.toLowerCase()))) return false;
  }
  if (skip !== 'sources' && filters.sources.length) {
    if (!filters.sources.includes(sourceBucket(movie.embedCount))) return false;
  }
  if (skip !== 'rating' && filters.rating !== 'any') {
    if (filters.rating === 'unrated') { if (Number(movie.rating) > 0) return false; }
    else if (Number(movie.rating) < Number(filters.rating)) return false;
  }
  if (skip !== 'era' && filters.eras.length && !filters.eras.includes(eraOf(movie.year))) return false;
  if (skip !== 'letter' && filters.letter && movie.letter !== filters.letter) return false;
  return true;
}

/* ── the controls ───────────────────────────────────────────────────── */

/** One faceted option: a tick, a word, and what the click would leave you with. */
function DeckOption({ pressed, count, label, onClick, children }) {
  const dead = count === 0 && !pressed;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={dead}
      className={`jv-deck-opt${pressed ? ' is-on' : ''}${dead ? ' is-dead' : ''}`}
      title={dead ? `${label} — nothing matches the rest of your filters` : `${label} — ${count} title${count === 1 ? '' : 's'}`}
    >
      <span className="jv-deck-box" aria-hidden="true">{pressed ? '✕' : ''}</span>
      <span className="jv-deck-opt-label">{label}</span>
      <span className="jv-deck-count">{count}</span>
      {children}
    </button>
  );
}

function DeckGroup({ title, note, children }) {
  return (
    <div className="jv-deck-group">
      <div className="jv-deck-group-head">
        <h3>{title}</h3>
        {note ? <span className="jv-deck-note">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

/* ── poster tile ────────────────────────────────────────────────────── */

function VaultTile({ movie, onPlay, index = 0 }) {
  return (
    <button
      type="button"
      data-reveal
      style={revealStyle(index, 6)}
      className="jv-vault-card group"
      onClick={() => onPlay(movie)}
      title={movie.isSeries
        ? `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''} — ${movie.episodeCount} episode${movie.episodeCount === 1 ? '' : 's'}`
        : `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''}`}
    >
      {movie.poster ? (
        <img
          src={movie.poster}
          srcSet={tmdbImageSrcSet(movie.poster) || undefined}
          sizes={tmdbImageSrcSet(movie.poster) ? POSTER_SIZES_ATTR : undefined}
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
          <span className="jv-vault-src-chip">{movie.embedCount} src</span>
        </span>
      </span>
    </button>
  );
}

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
  const [sort, setSort] = useState('newest');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [dense, setDense] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
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
  }, [data, router]);

  const movies = data?.movies || [];
  const needle = query.trim().toLowerCase();
  const facets = data?.facets;

  /* Every live count, in one pass per dimension. */
  const counts = useMemo(() => {
    const out = { language: {}, quality: {}, sources: {}, rating: {}, era: {}, letter: {}, origin: {} };
    for (const movie of movies) {
      const language = movie.language || '';
      const marks = movie.embeds.map((embed) => String(embed.quality).toLowerCase());
      const bucket = sourceBucket(movie.embedCount);
      const rating = Number(movie.rating) || 0;
      const era = eraOf(movie.year);
      const languagePasses = passes(movie, filters, needle, 'language');
      const qualityPasses = passes(movie, filters, needle, 'quality');
      const sourcePasses = passes(movie, filters, needle, 'sources');
      const ratingPasses = passes(movie, filters, needle, 'rating');
      const eraPasses = passes(movie, filters, needle, 'era');
      const letterPasses = passes(movie, filters, needle, 'letter');
      if (languagePasses) {
        if (language) out.language[language] = (out.language[language] || 0) + 1;
        out.origin[movie.origin] = (out.origin[movie.origin] || 0) + 1;
      }
      if (qualityPasses) for (const key of QUALITY_KEYS) { if (marks.includes(key.toLowerCase())) out.quality[key] = (out.quality[key] || 0) + 1; }
      if (sourcePasses) out.sources[bucket] = (out.sources[bucket] || 0) + 1;
      if (ratingPasses) {
        if (rating > 0) for (const key of ['5', '6', '7', '8']) { if (rating >= Number(key)) out.rating[key] = (out.rating[key] || 0) + 1; }
        else out.rating.unrated = (out.rating.unrated || 0) + 1;
      }
      if (eraPasses && era) out.era[era] = (out.era[era] || 0) + 1;
      if (letterPasses) out.letter[movie.letter] = (out.letter[movie.letter] || 0) + 1;
    }
    return out;
  }, [movies, filters, needle]);

  /* One filter+sort pipeline — every control writes state, this reads it. */
  const filtered = useMemo(() => {
    const list = movies.filter((movie) => passes(movie, filters, needle, null));
    const byAdded = (a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')) || b.year - a.year;
    if (sort === 'newest') list.sort(byAdded);
    else if (sort === 'year') list.sort((a, b) => b.year - a.year || a.title.localeCompare(b.title));
    else if (sort === 'rating') list.sort((a, b) => b.rating - a.rating || byAdded(a, b));
    else if (sort === 'az') list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === 'sources') list.sort((a, b) => b.embedCount - a.embedCount || byAdded(a, b));
    return list;
  }, [movies, filters, needle, sort]);

  /* Reset paging whenever the result set changes shape. */
  useEffect(() => { setVisible(GRID_STEP); }, [query, filters, sort]);

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

  /* ── filter bookkeeping ── */
  const setFilter = (patch) => setFilters((prev) => ({ ...prev, ...patch }));
  const toggleIn = (key, value) => setFilters((prev) => ({
    ...prev,
    [key]: prev[key].includes(value) ? prev[key].filter((entry) => entry !== value) : [...prev[key], value],
  }));
  const clearAll = () => { setQuery(''); setFilters(EMPTY_FILTERS); };

  const chips = useMemo(() => {
    const out = [];
    if (query.trim()) out.push({ id: 'q', label: `“${query.trim()}”` });
    if (filters.origin !== 'any') out.push({ id: 'origin', label: filters.origin === 'tamil' ? 'Original Tamil' : 'Dubbed' });
    for (const code of filters.languages) out.push({ id: `lang:${code}`, label: (facets?.languages || []).find((entry) => entry.code === code)?.label || code.toUpperCase() });
    for (const quality of filters.qualities) out.push({ id: `qual:${quality}`, label: quality });
    for (const bucket of filters.sources) out.push({ id: `src:${bucket}`, label: `${bucket} mirror${bucket === '1' ? '' : 's'}` });
    if (filters.rating !== 'any') out.push({ id: 'rating', label: `${filters.rating === 'unrated' ? 'Unrated' : `${filters.rating}+`} rated` });
    for (const era of filters.eras) out.push({ id: `era:${era}`, label: era });
    if (filters.letter) out.push({ id: 'letter', label: `letter ${filters.letter}` });
    return out;
  }, [query, filters, facets]);

  const removeChip = (id) => {
    if (id === 'q') return setQuery('');
    if (id === 'origin') return setFilter({ origin: 'any' });
    if (id === 'rating') return setFilter({ rating: 'any' });
    if (id === 'letter') return setFilter({ letter: '' });
    const [kind, value] = id.split(':');
    if (kind === 'lang') return toggleIn('languages', value);
    if (kind === 'qual') return toggleIn('qualities', value);
    if (kind === 'src') return toggleIn('sources', value);
    if (kind === 'era') return toggleIn('eras', value);
    return undefined;
  };

  // Keyed on the filters AND the page window: the vault appends as it scrolls, and
  // two filter combinations can render the same number of tiles.
  const revealRef = useReveal(`${sort}|${JSON.stringify(filters)}|${query}|${visible}`);

  const activeCount = chips.length;

  /* The rail is ONE node: a sticky column on desktop, a bottom sheet on a phone.
     Moving it in the DOM would lose focus and scroll; CSS alone cannot. */
  const rail = (
    <div className={`jv-deck-rail${sheetOpen ? ' is-open' : ''}`} id="vault-filters" aria-label="Vault filters">
      <div className="jv-deck-rail-bar">
        <strong>Filters</strong>
        <span className="jv-deck-note">{filtered.length} of {movies.length}</span>
        <button type="button" className="jv-deck-close" onClick={() => setSheetOpen(false)} aria-label="Close filters">Done</button>
      </div>

      <DeckGroup title="Origin" note="original vs dub">
        <div className="jv-deck-seg" role="group" aria-label="Origin">
          {ORIGINS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filters.origin === entry.id}
              onClick={() => setFilter({ origin: entry.id })}
              title={entry.id === 'any' ? 'Every title' : `${counts.origin[entry.id] || 0} titles`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </DeckGroup>

      <DeckGroup title="Language" note={`${(facets?.languages || []).length} in the catalogue`}>
        {(facets?.languages || []).slice(0, 10).map((entry) => (
          <DeckOption
            key={entry.code}
            label={entry.label}
            count={counts.language[entry.code] || 0}
            pressed={filters.languages.includes(entry.code)}
            onClick={() => toggleIn('languages', entry.code)}
          />
        ))}
        {(facets?.languages || []).length > 10 ? (
          <DeckOption
            label="Other + unknown"
            count={movies.filter((movie) => !(facets?.languages || []).slice(0, 10).some((entry) => entry.code === movie.language)).length}
            pressed={false}
            onClick={() => setFilter({ languages: [], origin: 'any' })}
          />
        ) : null}
      </DeckGroup>

      <DeckGroup title="Quality" note="any source of the title">
        {QUALITY_KEYS.map((quality) => (
          <DeckOption
            key={quality}
            label={quality}
            count={counts.quality[quality] || 0}
            pressed={filters.qualities.includes(quality)}
            onClick={() => toggleIn('qualities', quality)}
          />
        ))}
      </DeckGroup>

      <DeckGroup title="Sources" note="mirrors per title">
        {SOURCE_KEYS.map((entry) => (
          <DeckOption
            key={entry.id}
            label={entry.label}
            count={counts.sources[entry.id] || 0}
            pressed={filters.sources.includes(entry.id)}
            onClick={() => toggleIn('sources', entry.id)}
          />
        ))}
      </DeckGroup>

      <DeckGroup title="Rating" note="TMDB, from upstream">
        <div className="jv-deck-radios" role="group" aria-label="Minimum rating">
          <button type="button" aria-pressed={filters.rating === 'any'} onClick={() => setFilter({ rating: 'any' })}>Any</button>
          {RATING_KEYS.map((entry) => {
            const count = counts.rating[entry.id] || 0;
            const dead = count === 0 && filters.rating !== entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={filters.rating === entry.id}
                onClick={() => setFilter({ rating: entry.id })}
                disabled={dead}
                className={dead ? 'is-dead' : undefined}
              >
                {entry.label} <span className="jv-deck-count">{count}</span>
              </button>
            );
          })}
        </div>
      </DeckGroup>

      <DeckGroup title="Era">
        {ERA_KEYS.map((era) => (
          <DeckOption
            key={era}
            label={era}
            count={counts.era[era] || 0}
            pressed={filters.eras.includes(era)}
            onClick={() => toggleIn('eras', era)}
          />
        ))}
      </DeckGroup>

      <div className="jv-deck-group">
        <p className="jv-deck-fine">
          Genre, runtime, cast and “where you left off” are not in the catalogue, so no filter here
          pretends they are. Everything above is a field the vault actually carries.
        </p>
      </div>

      {activeCount ? (
        <div className="jv-deck-group">
          <button type="button" className="jv-deck-clear" onClick={clearAll}>Clear all filters</button>
        </div>
      ) : null}
    </div>
  );

  return (
    <main className="jv-vault-page jv-rail-shift min-h-dvh overflow-x-hidden text-zinc-100">
      <RailNav />

      <section className="mx-auto w-full max-w-[1500px] px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-8">
        {/* ── deck head ── */}
        <header className="jv-vault-head">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h1 className="jv-vault-title">VAULT</h1>
              <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-cyan-200/75">
                {facets ? (
                  <>
                    {facets.total} titles · {facets.posters} posters · {facets.series || 0} series
                    {data?.fetchedAt ? <span className="text-txt-4"> · updated {relativeTime(data.fetchedAt)}</span> : null}
                  </>
                ) : 'loading the deck…'}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={forceRefresh}
                disabled={refreshing}
                className="jv-vault-glass flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-txt-2 transition hover:border-cyan-400/50 hover:text-white disabled:opacity-50"
              >
                <Icon name="refresh" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Checking…' : 'Sync now'}
              </button>
              <span className="jv-vault-glass hidden rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-200/85 sm:block">
                30 min auto-sync
              </span>
            </div>
          </div>

          {/* search */}
          <div className="jv-vault-search mt-4">
            <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-300/70" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${facets?.total || 'the'} titles…`}
              aria-label="Search titles"
              className="w-full bg-transparent pl-11 pr-10 py-2.5 text-sm font-semibold text-txt-1 placeholder:text-txt-4 focus:outline-none"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-4 hover:text-txt-1">
                <Icon name="close" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </header>

        {/* ── control bar: sort, density, filters ── */}
        <div className="jv-deck-bar">
          <div className="jv-deck-seg jv-deck-seg-wide" role="group" aria-label="Sort">
            {SORTS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={sort === entry.id}
                title={entry.hint}
                onClick={() => setSort(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="jv-deck-seg" role="group" aria-label="Tile density">
            <button type="button" aria-pressed={!dense} onClick={() => setDense(false)}>Cozy</button>
            <button type="button" aria-pressed={dense} onClick={() => setDense(true)}>Dense</button>
          </div>
          <button
            type="button"
            className="jv-deck-filters-btn"
            aria-expanded={sheetOpen}
            aria-controls="vault-filters"
            onClick={() => setSheetOpen((open) => !open)}
          >
            Filters{activeCount ? ` · ${activeCount}` : ''}
          </button>
        </div>

        {/* ── A–Z strip, with what each letter holds ── */}
        <div className="jv-deck-letters" role="group" aria-label="Jump to letter">
          <button
            type="button"
            aria-pressed={!filters.letter}
            onClick={() => setFilter({ letter: '' })}
            className="jv-deck-letter"
          >
            <span>All</span>
          </button>
          {ALPHABET.map((letter) => {
            const count = counts.letter[letter] || 0;
            const dead = count === 0 && filters.letter !== letter;
            return (
              <button
                key={letter}
                type="button"
                aria-pressed={filters.letter === letter}
                disabled={dead}
                onClick={() => setFilter({ letter: filters.letter === letter ? '' : letter })}
                className={`jv-deck-letter${dead ? ' is-dead' : ''}`}
                title={`${letter} — ${count} title${count === 1 ? '' : 's'}`}
              >
                <span>{letter}</span>
                <em>{count}</em>
              </button>
            );
          })}
        </div>

        {/* ── count line + active filters ── */}
        <div className="jv-deck-countline">
          <b>{filtered.length}</b>
          <span>{filtered.length === 1 ? 'title' : 'titles'}</span>
          <div className="jv-deck-chips">
            {chips.map((chip) => (
              <span key={chip.id} className="jv-deck-chip">
                {chip.label}
                <button type="button" onClick={() => removeChip(chip.id)} aria-label={`Remove ${chip.label}`}>✕</button>
              </span>
            ))}
            {chips.length > 1 ? (
              <button type="button" className="jv-deck-chip jv-deck-chip-clear" onClick={clearAll}>Clear all</button>
            ) : null}
          </div>
        </div>

        {/* ── body: rail + grid ── */}
        <div className="jv-deck-body">
          {rail}

          <div className="min-w-0 flex-1">
            {status === 'loading' ? <SkeletonGrid /> : null}

            {status === 'error' ? (
              <div className="jv-vault-glass rounded-2xl p-8 text-center">
                <p role="alert" className="text-sm font-bold text-danger">{error}</p>
                <button type="button" onClick={forceRefresh} className="jv-vault-src-chip mt-4">Try again</button>
              </div>
            ) : null}

            {status === 'ready' && !filtered.length ? (
              <div className="jv-vault-glass rounded-2xl p-10 text-center">
                <p className="text-sm font-bold text-txt-2">Nothing in the vault matches this cut.</p>
                <p className="mt-2 text-xs text-txt-4">
                  The rail greys out options that would return nothing — loosen one of the others.
                </p>
                <button type="button" onClick={clearAll} className="jv-vault-src-chip mt-4">Clear all filters</button>
              </div>
            ) : null}

            {status === 'ready' && filtered.length ? (
              <>
                <div
                  ref={revealRef}
                  className={`grid gap-3 ${dense
                    ? 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8'
                    : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6'}`}
                >
                  {shown.map((movie, index) => (
                    <VaultTile key={movie.id} movie={movie} onPlay={openWatch} index={index} />
                  ))}
                </div>
                {visible < filtered.length ? (
                  <div ref={sentinelRef} className="py-6 text-center text-[11px] font-black uppercase tracking-[0.18em] text-txt-4">
                    loading more…
                  </div>
                ) : (
                  <div className="py-6 text-center text-[11px] font-black uppercase tracking-[0.18em] text-txt-4">
                    end of the deck — {filtered.length} titles
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      </section>

      {sheetOpen ? <div className="jv-deck-scrim" onClick={() => setSheetOpen(false)} aria-hidden="true" /> : null}
    </main>
  );
}
