'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import CommandPalette from '@/components/CommandPalette';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import Icon from '@/components/Icons';
import { releaseQualityChip, parseReleaseQuality, chipClassForTier, labelForTier } from '@/lib/quality';
import { getHistory, getProgressPercent, isFavoriteItem, makeWatchKey, toggleFavoriteItem, useLibraryVersion } from '@/lib/watchStore';
import RailNav from '@/components/rail/RailNav';
import RailFocus from '@/components/rail/RailFocus';
import { readLiveNow } from '@/lib/liveNow';

const PAGE_SIZE = 15;
const HOME_CACHE_KEY = 'jash:home:v5';

function qualitySourceText(item) {
  return item?.rawTitle || item?.parsedSource || item?.title || item?.synopsis || '';
}

function itemQualityChip(item) {
  // Server is the single source of truth for quality (see /api/tamilmv).
  // Client-side parsing remains only as a last-resort fallback.
  if (item?.qualityTier) {
    return { tier: item.qualityTier, label: item.qualityLabel || labelForTier(item.qualityTier), cls: chipClassForTier(item.qualityTier) };
  }
  return releaseQualityChip(qualitySourceText(item));
}

function watchQualityParam(item, hasQuery = false) {
  const tier = item?.qualityTier || parseReleaseQuality(qualitySourceText(item)).tier;
  if (!tier) return '';
  return `${hasQuery ? '&' : '?'}quality=${encodeURIComponent(tier)}`;
}

/**
 * The single shape of a watch link on this page. MediaCard and the focus panel both need it, and two
 * copies of a URL builder is how one of them ends up dropping the quality hint.
 */
function watchHref(item) {
  if (!item?.tmdbId) return undefined;
  const episode = item.type === 'series' && (item.season || item.episode)
    ? `?season=${item.season || 1}&episode=${item.episode || 1}`
    : '';
  return `/watch/${item.type}/${item.tmdbId}${episode}${watchQualityParam(item, Boolean(episode))}`;
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

function QualityDebugLine({ items = [] }) {
  try {
    const first = items.find((entry) => entry?.type !== 'series') || items[0];
    if (!first) return null;
    const composed = [
      `tier=${first.qualityTier || 'none'}`,
      `rawTitle=${first.rawTitle ? 'yes' : 'no'}`,
      `chip=${itemQualityChip(first).label || 'none'}`,
    ].join(' · ');
    return <span className="ml-2 rounded border border-amber-400/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">{composed}</span>;
  } catch {
    return <span className="ml-2 rounded border border-red-400/40 bg-red-500/10 px-1.5 py-0.5 font-mono text-[9px] text-red-300">debug-error</span>;
  }
}

function MediaCard({ item, onItemMatched, delay = 0 }) {
  const [matchOpen, setMatchOpen] = useState(false);
  const hasTMDB = Boolean(item.tmdbId);
  const href = hasTMDB ? watchHref(item) : undefined;
  const Wrapper = hasTMDB ? Link : 'div';
  const qualityChip = item?.type === 'series'
    ? { label: 'Series', cls: 'border-white/15 bg-black/60 text-zinc-200' }
    : { ...itemQualityChip(item), fallback: true };
  const favKey = hasTMDB ? makeWatchKey({ type: item.type, tmdbId: item.tmdbId }) : '';
  const favorite = hasTMDB ? isFavoriteItem(favKey) : false;

  return (
    <>
      <Wrapper
        href={href}
        className={`jv-card group relative block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-lg shadow-black/25 transition duration-300 active:scale-[0.99] hover:border-amber-400/50 hover:bg-zinc-900 hover:shadow-2xl hover:shadow-red-950/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:rounded-3xl sm:shadow-xl ${hasTMDB ? '' : 'cursor-pointer'}`}
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

          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-95" />

          <div className="absolute left-2 top-2 flex flex-col gap-1 sm:left-3 sm:top-3">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider backdrop-blur sm:text-[10px] ${qualityChip.cls || 'border-white/15 bg-black/60 text-zinc-200'}`}>
              {qualityChip.label || (item?.type === 'series' ? 'Series' : 'Movie')}
            </span>
          </div>

          <div className="absolute right-2 top-2 flex items-center gap-1 sm:right-3 sm:top-3">
            {hasTMDB && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavoriteItem({
                    key: favKey,
                    type: item.type,
                    tmdbId: item.tmdbId,
                    title: item.title,
                    posterUrl: item.posterUrl,
                    rating: item.rating,
                    year: item.year,
                  });
                }}
                className={`grid h-7 w-7 place-items-center rounded-full border backdrop-blur transition hover:scale-110 ${
                  favorite
                    ? 'border-emerald-400 bg-emerald-500/30 text-emerald-300'
                    : 'border-white/15 bg-black/60 text-zinc-300 opacity-0 group-hover:opacity-100 hover:text-white'
                }`}
                title={favorite ? 'Remove from My List' : 'Add to My List'}
              >
                <Icon name={favorite ? 'check' : 'plus'} className="h-3.5 w-3.5" />
              </button>
            )}

            {hasTMDB && Number(item.rating) > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-black/70 px-2 py-0.5 text-[10px] font-bold text-amber-300 backdrop-blur">
                ★ {Number(item.rating).toFixed(1)}
              </span>
            ) : null}
          </div>

          {hasTMDB ? (
            <div className="absolute bottom-3 right-3 grid h-10 w-10 place-items-center rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-purple-600 text-white opacity-0 shadow-xl shadow-red-950/50 transition duration-300 group-hover:scale-110 group-hover:opacity-100">
              <Icon name="play" className="h-4 w-4" />
            </div>
          ) : null}

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
          <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-500">
            <span>{item.year || (item.releaseDate ? String(item.releaseDate).slice(0, 4) : '')}</span>
            <span className="text-[10px] uppercase text-zinc-600">{item.type === 'series' ? 'Series' : 'Movie'}</span>
          </div>
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

function RowStatus({ tone, children }) {
  if (!children) return null;
  const cls = tone === 'error'
    ? 'rounded-2xl border border-red-500/30 bg-red-950/20 p-3.5 text-sm text-red-200'
    : 'text-sm text-zinc-500';
  return <p className={cls}>{children}</p>;
}

/**
 * A catalogue row: one horizontal strip, its own page counter, its own "Load more".
 *
 * Two of these replace the Movies|Series tab pair. The tab switcher was a lie about the data — the
 * single `/api/tamilmv?page=1` call already returns *both* groups, so the tabs only hid half of what
 * had been downloaded. A row per group shows both and keeps the paging honest: `loadMore('movies')`
 * and `loadMore('series')` are the same per-group endpoint the sentinel used to walk.
 */
function CatalogRow({ id, label, items = [], info, status, error, onMore, onItemMatched, debug }) {
  const total = Number(info?.total) || 0;
  return (
    <section aria-labelledby={`row-${id}`} className="jv-row">
      <div className="mb-2.5 flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5">
        <div className="flex items-baseline gap-2">
          <h2 id={`row-${id}`} className="text-lg font-black tracking-tight text-white sm:text-2xl">{label}</h2>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
            {items.length}{total ? ` / ${total}` : ''}
          </span>
          {debug ? <QualityDebugLine items={items} /> : null}
        </div>
        <span className="hidden text-[11px] font-black uppercase tracking-[0.18em] text-zinc-500 sm:inline">
          {info?.hasMore ? `${Math.max(0, total - items.length)} more in the scrape` : 'end of the loaded list'}
        </span>
      </div>

      {status === 'loading' && !items.length ? <RowStatus tone="muted">Loading {label.toLowerCase()}…</RowStatus> : null}
      {error && !items.length ? <RowStatus tone="error">{error}</RowStatus> : null}

      {items.length ? (
        <div className="jv-row-strip" role="list">
          {items.map((item) => (
            <div key={`${item.type}-${item.tmdbId || item.id || item.title}`} className="jv-row-tile" role="listitem">
              <MediaCard item={item} onItemMatched={onItemMatched} />
            </div>
          ))}
          {info?.hasMore ? (
            <button
              type="button"
              onClick={onMore}
              disabled={Boolean(info?.loading)}
              className="jv-row-more"
            >
              {info?.loading ? 'Loading…' : `Load more ${label.toLowerCase()}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function LandingPage() {
  const [movies, setMovies] = useState([]);
  const [series, setSeries] = useState([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrapeStatus, setScrapeStatus] = useState('loading');
  const [scrapeError, setScrapeError] = useState('');
  const [paging, setPaging] = useState({
    movies: { page: 1, hasMore: false, loading: false, total: 0 },
    series: { page: 1, hasMore: false, loading: false, total: 0 },
  });

  const featuredItems = useMemo(() => [...movies, ...series], [movies, series]);

  // Rail OS: which title is under the ring is decided here, by the data, not by a timer. Unfinished
  // items come first because they are the ones you actually press, then the current tab's list. An
  // item with no TMDB match still gets a tile — hiding it would hide the reason to go match it.
  const libraryVersion = useLibraryVersion();
  // Read once, after mount, from localStorage: the homepage does not poll the guide, it remembers
  // /live. Read during render it would also disagree with the server HTML, which has no storage.
  const [liveNow, setLiveNow] = useState(null);
  useEffect(() => {
    setLiveNow(readLiveNow());
  }, []);
  const focusSlides = useMemo(() => {
    const slides = [];
    const seen = new Set();
    for (const entry of getHistory().filter((item) => item?.href).slice(0, 3)) {
      const key = entry.href;
      if (seen.has(key)) continue;
      seen.add(key);
      slides.push({
        id: `resume-${entry.key || key}`,
        title: entry.title || 'Untitled',
        type: entry.type || 'movie',
        href: entry.href,
        infoHref: entry.href,
        posterUrl: entry.posterUrl || entry.backdropUrl || '',
        backdropUrl: entry.backdropUrl || entry.posterUrl || '',
        chips: [],
        progress: getProgressPercent(entry),
        note: 'Where you left off',
      });
    }
    for (const item of featuredItems) {
      const backdrop = item.backdropUrl || item.posterUrl || '';
      if (!backdrop) continue;
      const href = watchHref(item);
      const key = href || `${item.type}:${item.id || item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chip = item.type === 'series' ? null : itemQualityChip(item);
      slides.push({
        id: `${item.type}-${item.tmdbId || item.id || item.title}`,
        title: item.title || 'Untitled',
        year: item.year || '',
        type: item.type || 'movie',
        href,
        infoHref: href,
        posterUrl: item.posterUrl || backdrop,
        backdropUrl: backdrop,
        chips: chip?.label ? [chip.label] : [],
        progress: 0,
        note: href ? '' : 'No TMDB match yet — bind it once to unlock every stream server',
      });
    }
    return slides.slice(0, 14);
    // `libraryVersion` is the resume half of the list: getHistory() answers from a cache the store
    // invalidates on its own, so the value is a stamp, not an input the body reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featuredItems, libraryVersion]);

  useEffect(() => {
    const cached = readSessionCache(HOME_CACHE_KEY);
    if (cached?.movies?.length || cached?.series?.length) {
      setMovies(cached.movies || []);
      setSeries(cached.series || []);
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
      paging,
      scrapeStatus,
    });
  }, [movies, series, paging, scrapeStatus]);

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

  // Two rows replaced the Movies|Series tabs, and the "Quick Filter Rail" (4K / Tamil / High rated)
  // stays deleted by request: it re-filtered only what had loaded so far, so a page boundary could make
  // the catalogue look empty. A row per group cannot lie that way — both groups are shown, each paging
  // its own endpoint. Searching is still the one honest filter, because it goes to the provider.
  const [debugQuality, setDebugQuality] = useState(false);
  useEffect(() => {
    try {
      setDebugQuality(new URLSearchParams(window.location.search).has('debugq'));
    } catch { /* SSR / odd environments */ }
  }, []);
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
    <main className="jv-rail-shift min-h-dvh overflow-x-hidden bg-[#050505] text-zinc-100">
      <RailNav
        onOpenSearch={() => setPaletteOpen(true)}
      />
      <RailFocus slides={focusSlides} eyebrow="Now on your shelf" onAir={liveNow} />

      <section className="mx-auto flex w-full max-w-[1500px] flex-col gap-7 px-4 pb-20 pt-5 sm:px-6 sm:gap-9 lg:px-8">
        {scrapeStatus === 'error' && scrapeError ? (
          <RowStatus tone="error">{scrapeError}</RowStatus>
        ) : null}
        <CatalogRow
          id="movies"
          label="Movies"
          items={movies}
          info={paging.movies}
          status={scrapeStatus}
          error={scrapeError}
          debug={debugQuality}
          onMore={() => loadMore('movies')}
          onItemMatched={handleItemMatched}
        />
        <CatalogRow
          id="series"
          label="Series"
          items={series}
          info={paging.series}
          status={scrapeStatus}
          error={scrapeError}
          onMore={() => loadMore('series')}
          onItemMatched={handleItemMatched}
        />
      </section>

      <CommandPalette open={paletteOpen} onClose={setPaletteOpen} />
    </main>
  );
}
