'use client';

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';

const PAGE_SIZE = 24;
const CLASSICS_CACHE_KEY = 'jash:classics:v1';

function Card({ item }) {
  return (
    <Link
      href={`/classics/${item.id}`}
      className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-lg shadow-black/30 transition hover:-translate-y-1 hover:border-red-500/60 sm:rounded-3xl"
    >
      <div className="relative aspect-[2/3] bg-zinc-900">
        {item.posterUrl ? (
          <img src={item.posterUrl} alt="" className="h-full w-full object-cover transition group-hover:scale-105" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm font-black text-zinc-300">{item.title}</div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
        <div className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-1 text-[10px] font-black text-white">
          {item.rating ? item.rating.toFixed(1) : 'NR'}
        </div>
        {item.year ? (
          <div className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-1 text-[10px] font-bold text-zinc-100">
            {item.year}
          </div>
        ) : null}
      </div>
      <div className="space-y-2 p-3 sm:p-4">
        <h3 className="line-clamp-2 min-h-9 text-[13px] font-black leading-4 text-white sm:text-sm sm:leading-5">{item.title}</h3>
        <div className="flex flex-wrap gap-1">
          {(item.sources || []).slice(0, 2).map((source) => (
            <span key={source} className="rounded-full border border-red-500/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-100">{source}</span>
          ))}
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-zinc-300">{item.streamsCount} streams</span>
        </div>
      </div>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-white/10 bg-zinc-950 sm:rounded-3xl">
          <div className="aspect-[2/3] animate-pulse bg-zinc-900" />
          <div className="space-y-2 p-3">
            <div className="h-4 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TamilClassicsPage() {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncSummary, setSyncSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState({ sources: [], genres: [], minYear: null, maxYear: null });
  const [filters, setFilters] = useState({ q: '', sort: 'rating.desc', source: 'Aha', genre: 'all', minRating: '', yearFrom: '', yearTo: '' });
  const sentinelRef = useRef(null);
  const autoSyncStartedRef = useRef(false);

  const buildQuery = useCallback((pageNumber) => {
    const params = new URLSearchParams({ page: String(pageNumber), limit: String(PAGE_SIZE), sort: filters.sort });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.genre !== 'all') params.set('genre', filters.genre);
    if (filters.minRating) params.set('minRating', filters.minRating);
    if (filters.yearFrom) params.set('yearFrom', filters.yearFrom);
    if (filters.yearTo) params.set('yearTo', filters.yearTo);
    return params.toString();
  }, [filters]);

  const loadPage = useCallback(async (pageNumber = 1, append = false) => {
    try {
      setStatus(append ? 'ready' : 'loading');
      setError('');
      const response = await fetch(`/api/vod?${buildQuery(pageNumber)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to load Tamil Classics');

      if (data.needsSync && !autoSyncStartedRef.current) {
        autoSyncStartedRef.current = true;
        setStatus('sync-needed');
        return;
      }

      setItems((current) => append ? [...current, ...(data.items || [])] : (data.items || []));
      setPage(data.page || pageNumber);
      setHasMore(Boolean(data.hasMore));
      setTotal(data.total || 0);
      setFacets(data.facets || { sources: [], genres: [] });
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Unable to load Tamil Classics');
      setStatus('error');
    }
  }, [buildQuery]);

  const syncNow = useCallback(async () => {
    try {
      setSyncStatus('syncing');
      setError('');
      const response = await fetch('/api/vod/sync', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data?.error || 'Sync failed');
      setSyncSummary(data);
      setSyncStatus('done');
      await loadPage(1, false);
    } catch (err) {
      setSyncStatus('error');
      setError(err.message || 'Sync failed');
    }
  }, [loadPage]);

  useEffect(() => {
    const cached = readSessionCache(CLASSICS_CACHE_KEY);
    if (cached?.items?.length) {
      setItems(cached.items || []);
      setStatus(cached.status || 'ready');
      setError(cached.error || '');
      setSyncStatus(cached.syncStatus || 'idle');
      setSyncSummary(cached.syncSummary || null);
      setPage(cached.page || 1);
      setHasMore(Boolean(cached.hasMore));
      setTotal(cached.total || 0);
      setFacets(cached.facets || { sources: [], genres: [], minYear: null, maxYear: null });
      setFilters(cached.filters || { q: '', sort: 'rating.desc', source: 'Aha', genre: 'all', minRating: '', yearFrom: '', yearTo: '' });
      restoreScroll(CLASSICS_CACHE_KEY);
      return;
    }
    loadPage(1, false);
  }, [loadPage]);

  useEffect(() => {
    writeSessionCache(CLASSICS_CACHE_KEY, { items, status, error, syncStatus, syncSummary, page, hasMore, total, facets, filters });
  }, [items, status, error, syncStatus, syncSummary, page, hasMore, total, facets, filters]);

  useEffect(() => {
    const onScroll = () => saveScroll(CLASSICS_CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      saveScroll(CLASSICS_CACHE_KEY);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (status === 'sync-needed' && syncStatus === 'idle') syncNow();
  }, [status, syncStatus, syncNow]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || status !== 'ready' || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadPage(page + 1, true);
    }, { rootMargin: '700px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [status, hasMore, page, loadPage]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  return (
    <main className="palette-nordic min-h-dvh bg-[#06110d] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BrandLogo showText />
              <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">← Home</Link>
            </div>
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Tamil Classics</p>
          </div>
          <button onClick={syncNow} disabled={syncStatus === 'syncing'} className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/20 disabled:opacity-60">
            {syncStatus === 'syncing' ? 'Syncing...' : 'Sync / Refresh'}
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 rounded-3xl border border-white/10 bg-zinc-950/80 p-4 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-black text-white sm:text-5xl">Tamil Classics</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
                ErosNow + Aha playlists combined, matched with TMDB, stored in MongoDB, and sorted by TMDB rating high to low.
              </p>
              {syncSummary ? (
                <p className="mt-2 text-xs text-green-300">
                  Synced {syncSummary.stored} titles • matched {syncSummary.matched} • unmatched {syncSummary.unmatched}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-zinc-300">
              {items.length} / {total} loaded
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <input value={filters.q} onChange={(e) => updateFilter('q', e.target.value)} placeholder="Search classics..." className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-base text-white outline-none focus:border-red-500 lg:col-span-2" />
            <select value={filters.sort} onChange={(e) => updateFilter('sort', e.target.value)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-red-500">
              <option value="rating.desc">Rating high → low</option>
              <option value="rating.asc">Rating low → high</option>
              <option value="year.desc">Year newest</option>
              <option value="year.asc">Year oldest</option>
              <option value="title.asc">Title A-Z</option>
              <option value="synced.desc">Recently synced</option>
            </select>
            <select value={filters.source} onChange={(e) => updateFilter('source', e.target.value)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-red-500">
              <option value="all">All sources</option>
              {!facets.sources?.includes('Aha') ? <option value="Aha">Aha</option> : null}
              {(facets.sources || []).map((source) => <option key={source} value={source}>{source}</option>)}
            </select>
            <input value={filters.yearFrom} onChange={(e) => updateFilter('yearFrom', e.target.value)} placeholder="Year from" inputMode="numeric" className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-red-500" />
            <input value={filters.minRating} onChange={(e) => updateFilter('minRating', e.target.value)} placeholder="Min rating" inputMode="decimal" className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-red-500" />
          </div>
        </div>

        {status === 'loading' || status === 'sync-needed' || syncStatus === 'syncing' ? (
          <div className="space-y-6">
            <div className="rounded-3xl border border-yellow-500/20 bg-yellow-500/10 p-5 text-sm leading-6 text-yellow-100">
              {syncStatus === 'syncing' ? 'First sync running. This can take time because titles are being matched with TMDB and saved to MongoDB.' : 'Loading Tamil Classics...'}
            </div>
            <SkeletonGrid />
          </div>
        ) : null}

        {status === 'error' || syncStatus === 'error' ? (
          <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-red-200">{error}</div>
        ) : null}

        {status === 'ready' ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-6">
              {items.map((item) => <Card key={item.id} item={item} />)}
            </div>
            <div ref={sentinelRef} className="mt-10 flex min-h-24 items-center justify-center">
              {hasMore ? (
                <button onClick={() => loadPage(page + 1, true)} className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-bold text-white transition hover:border-red-500">
                  Load more classics
                </button>
              ) : (
                <p className="text-sm text-zinc-500">No more classics.</p>
              )}
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}
