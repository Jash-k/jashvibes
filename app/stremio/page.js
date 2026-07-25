'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

function StremioCard({ item }) {
  return (
    <Link
      href={`/stremio/${item.type}/${encodeURIComponent(item.id)}`}
      className="group overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-xl shadow-black/30 transition hover:-translate-y-1 hover:border-fuchsia-400/50 sm:rounded-3xl"
    >
      <div className="relative aspect-[2/3] bg-zinc-900">
        {item.posterUrl ? <img src={item.posterUrl} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /> : <div className="grid h-full place-items-center p-4 text-center text-sm font-black text-zinc-300">{item.title}</div>}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
        <div className="absolute left-2 top-2 rounded-full bg-fuchsia-500 px-2 py-1 text-[10px] font-black uppercase text-black">{item.type === 'series' ? 'Series' : 'Movie'}</div>
        {item.releaseInfo ? <div className="absolute right-2 top-2 rounded-full bg-black/75 px-2 py-1 text-[10px] font-black text-white">{item.releaseInfo}</div> : null}
      </div>
      <div className="space-y-2 p-3 sm:p-4">
        <h3 className="line-clamp-2 min-h-9 text-sm font-black leading-5 text-white">{item.title}</h3>
        <div className="flex flex-wrap gap-1">
          {item.rating ? <span className="rounded-full border border-yellow-300/25 bg-yellow-300/10 px-2 py-0.5 text-[10px] font-bold text-yellow-100">IMDb {item.rating}</span> : null}
          {(item.genres || []).slice(0, 2).map((genre) => <span key={genre} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-zinc-300">{genre}</span>)}
        </div>
      </div>
    </Link>
  );
}

function Section({ title, subtitle, items, loading, error, hasMore, onMore }) {
  return (
    <section className="rounded-[2rem] border border-fuchsia-400/15 bg-white/[0.035] p-4 sm:p-5">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black text-white sm:text-3xl">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs font-semibold text-zinc-500">{subtitle}</p> : null}
        </div>
        {hasMore ? <button type="button" onClick={onMore} disabled={loading} className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-black text-fuchsia-100 disabled:opacity-60">More</button> : null}
      </div>
      {error ? <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{error}</div> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {items.map((item) => <StremioCard key={`${item.type}-${item.id}`} item={item} />)}
        {loading ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:rounded-3xl"><div className="aspect-[2/3] animate-pulse bg-zinc-900" /><div className="space-y-2 p-3"><div className="h-4 animate-pulse rounded bg-zinc-800" /><div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" /></div></div>) : null}
      </div>
      {!loading && !items.length && !error ? <p className="rounded-2xl border border-white/10 bg-black/25 p-5 text-center text-sm text-zinc-400">No Stremio items found.</p> : null}
    </section>
  );
}

export default function StremioPage() {
  const [manifest, setManifest] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [movies, setMovies] = useState({ items: [], skip: 0, hasMore: false, loading: false, error: '' });
  const [series, setSeries] = useState({ items: [], skip: 0, hasMore: false, loading: false, error: '' });
  const sentinelRef = useRef(null);

  const loadCatalog = useCallback(async (type, append = false) => {
    const setter = type === 'series' ? setSeries : setMovies;
    const current = type === 'series' ? series : movies;
    const skip = append ? current.items.length : 0;
    try {
      setter((value) => ({ ...value, loading: true, error: '' }));
      const response = await fetch(`/api/stremio/catalog?type=${type}&skip=${skip}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Catalog failed');
      setter((value) => ({
        items: append ? [...value.items, ...(data.items || [])] : (data.items || []),
        skip: skip + (data.count || 0),
        hasMore: Boolean(data.hasMore),
        loading: false,
        error: '',
        catalogName: data.catalogName,
      }));
    } catch (err) {
      setter((value) => ({ ...value, loading: false, error: err.message || 'Catalog failed' }));
    }
  }, [movies, series]);

  useEffect(() => {
    async function load() {
      try {
        setStatus('loading');
        const response = await fetch('/api/stremio/manifest', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data?.error || 'Stremio manifest failed');
        setManifest(data.manifest);
        setStatus('ready');
        await Promise.all([loadCatalog('movie', false), loadCatalog('series', false)]);
      } catch (err) {
        setError(err.message || 'Stremio is not configured');
        setStatus('error');
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      if (movies.hasMore && !movies.loading) loadCatalog('movie', true);
      if (series.hasMore && !series.loading) loadCatalog('series', true);
    }, { rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [movies.hasMore, movies.loading, series.hasMore, series.loading, loadCatalog]);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[radial-gradient(circle_at_12%_0%,rgba(217,70,239,0.20),transparent_30%),linear-gradient(180deg,#080014,#050505_55%,#090014)] pb-10 text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-fuchsia-400/10 bg-[#080008]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white">← Home</Link>
          <p className="text-[10px] font-black uppercase tracking-[0.30em] text-fuchsia-300">Stremio</p>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-fuchsia-400/20 bg-white/[0.04] p-6 shadow-2xl shadow-fuchsia-950/20 sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-fuchsia-300/80">Authorized Addon</p>
          <h1 className="mt-3 text-4xl font-black text-white sm:text-6xl">Stremio</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Tamil movie and series catalog from your configured Stremio addon. Direct playback is enabled only for HTTPS streams returned by your authorized addon host.</p>
          {manifest?.name ? <p className="mt-3 text-xs font-bold text-zinc-500">Addon: {manifest.name} • {manifest.version}</p> : null}
        </div>

        {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-5 text-red-200">{error}<p className="mt-2 text-xs text-zinc-500">Set STREMIO to your addon manifest URL.</p></div> : null}
        {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">Loading Stremio addon...</div> : null}

        <Section title="Tamil Movies" subtitle={movies.catalogName || 'Movie catalog'} items={movies.items} loading={movies.loading} error={movies.error} hasMore={movies.hasMore} onMore={() => loadCatalog('movie', true)} />
        <Section title="Tamil Series" subtitle={series.catalogName || 'Series catalog'} items={series.items} loading={series.loading} error={series.error} hasMore={series.hasMore} onMore={() => loadCatalog('series', true)} />
        <div ref={sentinelRef} className="h-12" />
      </section>
    </main>
  );
}
