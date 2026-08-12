'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';

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

function MediaCard({ item }) {
  const hasTMDB = Boolean(item.tmdbId);
  const canWatch = hasTMDB || Boolean(item.title);
  const ottParams = new URLSearchParams({
    provider: 'tamilott',
    title: item.title || '',
  });
  if (item.year || item.releaseDate) ottParams.set('year', String(item.year || String(item.releaseDate).slice(0, 4)));
  if (item.season) ottParams.set('season', String(item.season));
  if (item.episode) ottParams.set('episode', String(item.episode));
  if (item.streamId) ottParams.set('ottStreamId', String(item.streamId));

  const href = hasTMDB
    ? `/watch/${item.type}/${item.tmdbId}${item.type === 'series' && (item.season || item.episode) ? `?season=${item.season || 1}&episode=${item.episode || 1}` : ''}`
    : `/watch/${item.type === 'series' ? 'series' : 'movie'}/ott?${ottParams.toString()}`;
  const Wrapper = canWatch ? Link : 'div';

  return (
    <Wrapper
      href={canWatch ? href : undefined}
      className="group block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-lg shadow-black/25 transition duration-300 active:scale-[0.99] hover:-translate-y-1 hover:border-red-500/60 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-red-500 sm:rounded-3xl sm:shadow-xl"
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
          <div className="flex h-full min-h-48 items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black p-4 text-center sm:min-h-64 sm:p-5">
            <span className="text-sm font-black text-zinc-200 sm:text-base">{item.title}</span>
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent opacity-95" />
        <div className="absolute left-2 top-2 sm:left-3 sm:top-3">
          <span className="rounded-full bg-black/75 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur sm:px-2.5 sm:py-1 sm:text-[10px]">
            {item.type === 'series' ? 'Series' : 'Movie'}
          </span>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <h3 className="line-clamp-2 min-h-9 text-[13px] font-black leading-4 text-white sm:min-h-10 sm:text-sm sm:leading-5">
          {item.title}
        </h3>
      </div>
    </Wrapper>
  );
}

function MediaGrid({ items }) {
  if (!items?.length) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-zinc-400">
        No titles found.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => (
        <MediaCard key={`${item.type}-${item.tmdbId || item.id || item.title}`} item={item} />
      ))}
    </div>
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
          ? 'border-red-500/60 bg-red-600 text-white shadow-lg shadow-red-950/30'
          : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/40 hover:text-white'
      }`}
    >
      <span className="block text-[10px] font-black uppercase tracking-[0.22em] opacity-75 sm:text-xs sm:tracking-[0.25em]">{children}</span>
      <span className="mt-1 block text-xl font-black sm:text-2xl">{count}</span>
    </button>
  );
}

export default function LandingPage() {
  const [catalogMode, setCatalogMode] = useState('tamilmv');
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

  const [ottSource, setOttSource] = useState('movies');
  const [ottItems, setOttItems] = useState([]);
  const [ottStatus, setOttStatus] = useState('idle');
  const [ottError, setOttError] = useState('');
  const [ottPaging, setOttPaging] = useState({ page: 1, hasMore: false, loading: false, total: 0 });
  const [ottUpdatedAt, setOttUpdatedAt] = useState(null);

  const sentinelRef = useRef(null);

  useEffect(() => {
    const cached = readSessionCache(HOME_CACHE_KEY);
    if (cached?.movies?.length || cached?.series?.length || cached?.ottItems?.length) {
      setCatalogMode(cached.catalogMode || 'tamilmv');
      setMovies(cached.movies || []);
      setSeries(cached.series || []);
      setActiveTab(cached.activeTab || 'movies');
      setUpdatedAt(cached.updatedAt || null);
      setPaging(cached.paging || {
        movies: { page: 1, hasMore: false, loading: false, total: 0 },
        series: { page: 1, hasMore: false, loading: false, total: 0 },
      });
      setOttSource(cached.ottSource || 'movies');
      setOttItems(cached.ottItems || []);
      setOttPaging(cached.ottPaging || { page: 1, hasMore: false, loading: false, total: 0 });
      setOttUpdatedAt(cached.ottUpdatedAt || null);
      setScrapeStatus(cached.scrapeStatus || 'ready');
      setOttStatus(cached.ottStatus || 'idle');
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
      catalogMode,
      movies,
      series,
      activeTab,
      updatedAt,
      paging,
      scrapeStatus,
      ottSource,
      ottItems,
      ottPaging,
      ottUpdatedAt,
      ottStatus,
    });
  }, [catalogMode, movies, series, activeTab, updatedAt, paging, scrapeStatus, ottSource, ottItems, ottPaging, ottUpdatedAt, ottStatus]);

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
      setCatalogMode('tamilmv');
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

  const loadOttCatalog = useCallback(async ({ source = ottSource, page = 1, append = false } = {}) => {
    if (append) {
      if (ottPaging.loading || !ottPaging.hasMore) return;
      setOttPaging((prev) => ({ ...prev, loading: true }));
    } else {
      setOttStatus('loading');
      setOttError('');
      setOttItems([]);
      setOttPaging({ page: 1, hasMore: false, loading: false, total: 0 });
    }

    try {
      const response = await fetch(`/api/ott?source=${encodeURIComponent(source)}&page=${page}&limit=${PAGE_SIZE}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to load OTT catalog');

      setOttItems((items) => append ? mergeUnique(items, data.items || []) : (data.items || []));
      setOttUpdatedAt(data.updatedAt || null);
      setOttPaging({
        page: data.page || page,
        hasMore: Boolean(data.hasMore),
        loading: false,
        total: data.total || 0,
      });
      setOttStatus('ready');
    } catch (error) {
      setOttError(error.message || 'Unable to load OTT catalog');
      setOttPaging((prev) => ({ ...prev, loading: false }));
      setOttStatus('error');
    }
  }, [ottSource, ottPaging.loading, ottPaging.hasMore]);

  useEffect(() => {
    if (catalogMode !== 'ott') return;
    loadOttCatalog({ source: ottSource, page: 1, append: false });
  }, [catalogMode, ottSource]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (catalogMode === 'ott') loadOttCatalog({ source: ottSource, page: ottPaging.page + 1, append: true });
        else if (scrapeStatus === 'ready') loadMore(activeTab);
      },
      { rootMargin: '700px 0px' },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [catalogMode, activeTab, loadMore, scrapeStatus, loadOttCatalog, ottSource, ottPaging.page]);

  const activeItems = activeTab === 'movies' ? movies : series;
  const activePaging = paging[activeTab];
  const showOtt = catalogMode === 'ott';
  const currentItems = showOtt ? ottItems : activeItems;
  const currentPaging = showOtt ? ottPaging : activePaging;
  const currentStatus = showOtt ? ottStatus : scrapeStatus;
  const currentError = showOtt ? ottError : scrapeError;

  return (
    <main className={`min-h-dvh overflow-x-hidden text-zinc-100 ${showOtt ? 'palette-deepsea bg-[#021015]' : 'palette-recent bg-[#050505]'}`}>
      <section className="relative overflow-visible border-b border-white/10">
        <div className={`absolute inset-0 ${showOtt ? 'bg-[radial-gradient(circle_at_20%_0%,_rgba(20,184,166,0.30),_transparent_34%),radial-gradient(circle_at_85%_20%,_rgba(56,189,248,0.16),_transparent_30%),linear-gradient(to_bottom,_rgba(0,0,0,0),_#021015)]' : 'bg-[radial-gradient(circle_at_20%_0%,_rgba(220,38,38,0.28),_transparent_34%),radial-gradient(circle_at_85%_20%,_rgba(234,179,8,0.12),_transparent_30%),linear-gradient(to_bottom,_rgba(0,0,0,0),_#050505)]'}`} />
        <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-4xl">
              {showOtt ? (
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.32em] text-cyan-300 sm:mb-4 sm:text-xs sm:tracking-[0.45em]">
                  MiX💿
                </p>
              ) : null}
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
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCatalogMode('tamilmv')}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition ${!showOtt ? 'border-red-500 bg-red-600 text-white' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/40'}`}
                >
                  Recent📀
                </button>
                <button
                  type="button"
                  onClick={() => setCatalogMode('ott')}
                  className={`rounded-full border px-4 py-2 text-sm font-black transition ${showOtt ? 'border-red-500 bg-red-600 text-white' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/40'}`}
                >
                  MiX💿
                </button>
                <Link
                  href="/music"
                  aria-label="Music"
                  title="ராக வானம்"
                  className="grid h-10 w-10 place-items-center rounded-full border border-emerald-400/30 bg-emerald-400/10 text-xl font-black text-emerald-200 shadow-lg shadow-emerald-950/20 transition hover:border-emerald-300 hover:bg-emerald-400/20 hover:text-emerald-100"
                >
                  ♫
                </Link>
                <Link
                  href="/sports"
                  className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-black text-emerald-100 transition hover:border-emerald-400/70 hover:bg-emerald-500/20"
                >
                  SPoRTS🏏
                </Link>
                <Link
                  href="/live"
                  className="rounded-full border border-green-500/25 bg-green-500/10 px-4 py-2 text-sm font-black text-green-100 transition hover:border-green-400/70 hover:bg-green-500/20"
                >
                  LiVe📺
                </Link>
                <a
                  href="/stremio?home=1"
                  onClick={(event) => { event.preventDefault(); window.location.assign('/stremio?home=1'); }}
                  className="rounded-full border border-fuchsia-500/25 bg-fuchsia-500/10 px-4 py-2 text-sm font-black text-fuchsia-100 transition hover:border-fuchsia-400/70 hover:bg-fuchsia-500/20"
                >
                  StReMiO📡
                </a>
                <CleanEmbedButtons />
              </div>
            </div>

            <div className="sticky top-2 z-40 w-full lg:top-6 lg:max-w-md">
              <SearchBox />
            </div>
          </div>

        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6 rounded-2xl border border-white/10 bg-zinc-950/70 p-4 shadow-2xl shadow-black/20 sm:mb-8 sm:rounded-3xl sm:p-5">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-black text-white">{showOtt ? 'MiX Catalog' : 'Latest Releases'}</h2>
                {!showOtt ? (
                  <button
                    type="button"
                    onClick={syncLatestReleases}
                    disabled={syncStatus === 'syncing'}
                    className="rounded-full border border-yellow-400/25 bg-yellow-400/10 px-3 py-1.5 text-xs font-black text-yellow-100 transition hover:border-yellow-300 hover:bg-yellow-400/20 disabled:cursor-wait disabled:opacity-60"
                  >
                    {syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'ready' ? 'Synced' : 'Sync'}
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {showOtt
                  ? `Tamil movies and dubbed titles. Last loaded: ${formatDateTime(ottUpdatedAt)}.`
                  : `Fresh movies and series. Last update: ${formatDateTime(updatedAt)}.`}
              </p>
            </div>

            {showOtt ? (
              <div className="sticky top-16 z-30 -mx-1 grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-[#050505]/90 p-1.5 backdrop-blur sm:static sm:mx-0 sm:min-w-96 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
                <TabButton active={ottSource === 'movies'} count={ottSource === 'movies' ? ottItems.length : 0} onClick={() => setOttSource('movies')}>
                  Movies
                </TabButton>
                <TabButton active={ottSource === 'dubbed'} count={ottSource === 'dubbed' ? ottItems.length : 0} onClick={() => setOttSource('dubbed')}>
                  Dubbed
                </TabButton>
              </div>
            ) : (
              <div className="sticky top-16 z-30 -mx-1 grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-[#050505]/90 p-1.5 backdrop-blur sm:static sm:mx-0 sm:min-w-96 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0">
                <TabButton active={activeTab === 'movies'} count={movies.length} onClick={() => setActiveTab('movies')}>
                  Movies
                </TabButton>
                <TabButton active={activeTab === 'series'} count={series.length} onClick={() => setActiveTab('series')}>
                  Series
                </TabButton>
              </div>
            )}
          </div>

          {currentStatus === 'loading' ? (
            <p className="mt-4 text-sm text-zinc-500">Loading {showOtt ? 'OTT catalog' : 'latest scraped titles'}...</p>
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
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-500 sm:text-xs sm:tracking-[0.28em]">
                  {showOtt ? (ottSource === 'dubbed' ? 'Dubbed' : 'Movies') : activeTab === 'movies' ? 'Movies' : 'Series'}
                </p>
                <h2 className="mt-1 text-2xl font-black text-white sm:mt-2 sm:text-3xl">
                  {showOtt ? 'MiX' : activeTab === 'movies' ? 'Movies' : 'Series'}
                </h2>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-zinc-400 sm:px-3 sm:text-sm">
                {currentItems.length}{currentPaging.total ? ` / ${currentPaging.total}` : ''} loaded
              </span>
            </div>

            <MediaGrid items={currentItems} />

            <div ref={sentinelRef} className="mt-10 flex min-h-24 items-center justify-center">
              {currentPaging.loading ? (
                <div className="flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-zinc-300 sm:w-auto">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-red-500" />
                  Loading more {showOtt ? 'OTT titles' : activeTab}...
                </div>
              ) : currentPaging.hasMore ? (
                <button
                  type="button"
                  onClick={() => showOtt ? loadOttCatalog({ source: ottSource, page: ottPaging.page + 1, append: true }) : loadMore(activeTab)}
                  className="w-full rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-red-500 hover:bg-red-500/10 sm:w-auto"
                >
                  Load more {showOtt ? 'OTT titles' : activeTab}
                </button>
              ) : (
                <p className="text-sm text-zinc-500">No more {showOtt ? 'OTT titles' : activeTab} in the current catalog.</p>
              )}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
