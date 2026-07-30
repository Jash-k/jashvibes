'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SELECTED_CATALOGS_KEY = 'jash:stremio:selectedCatalogs:v1';

async function readJsonResponse(response, fallbackMessage = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    const isHtml = /^\s*</.test(text) || contentType.includes('text/html');
    throw new Error(isHtml
      ? 'Stremio API route returned an HTML page instead of JSON. Deploy the latest Stremio API files and set STREMIO env.'
      : `${fallbackMessage}: server returned ${contentType || 'non-JSON response'}`);
  }
  return response.json();
}

function catalogKey(catalog = {}) {
  return `${catalog.type || 'movie'}:${catalog.id || ''}`;
}

function catalogLabel(catalog = {}) {
  const typeLabel = catalog.type === 'series' ? 'Series' : 'Movies';
  return `${catalog.name || catalog.id || 'Catalog'} ${typeLabel}`;
}

function normalizeCatalog(catalog = {}) {
  return {
    id: catalog.id || '',
    type: catalog.type === 'series' ? 'series' : 'movie',
    name: catalog.name || catalog.id || 'Catalog',
    extraSupported: catalog.extraSupported || [],
  };
}

function StremioCard({ item }) {
  return (
    <Link
      href={`/stremio-watch/${item.type}/${encodeURIComponent(item.id)}?source=catalog`}
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

function getDefaultCatalogs(options = [], tamilCatalogs = {}) {
  const defaults = [];
  const movie = options.find((item) => item.type === 'movie' && item.id === tamilCatalogs.movie)
    || options.find((item) => item.type === 'movie' && String(item.name || '').toLowerCase().includes('tamil'))
    || options.find((item) => item.type === 'movie');
  const series = options.find((item) => item.type === 'series' && item.id === tamilCatalogs.series)
    || options.find((item) => item.type === 'series' && String(item.name || '').toLowerCase().includes('tamil'))
    || options.find((item) => item.type === 'series');
  if (movie) defaults.push(movie);
  if (series && catalogKey(series) !== catalogKey(movie)) defaults.push(series);
  return defaults;
}

export default function StremioPage() {
  const [manifest, setManifest] = useState(null);
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [selectedCatalogs, setSelectedCatalogs] = useState([]);
  const [activeKey, setActiveKey] = useState('');
  const [pickerValue, setPickerValue] = useState('');
  const [catalogState, setCatalogState] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const sentinelRef = useRef(null);

  const activeCatalog = useMemo(() => selectedCatalogs.find((catalog) => catalogKey(catalog) === activeKey) || selectedCatalogs[0] || null, [selectedCatalogs, activeKey]);
  const activeState = activeCatalog ? (catalogState[catalogKey(activeCatalog)] || { items: [], skip: 0, hasMore: false, loading: false, error: '' }) : { items: [], skip: 0, hasMore: false, loading: false, error: '' };

  const loadCatalog = useCallback(async (catalog, append = false) => {
    if (!catalog?.id) return;
    const key = catalogKey(catalog);
    const current = catalogState[key] || { items: [], skip: 0, hasMore: false, loading: false, error: '' };
    const skip = append ? current.items.length : 0;
    try {
      setCatalogState((state) => ({ ...state, [key]: { ...(state[key] || {}), loading: true, error: '' } }));
      const params = new URLSearchParams({ source: 'catalog', type: catalog.type, catalog: catalog.id, skip: String(skip) });
      const response = await fetch(`/api/stremio/catalog?${params.toString()}`, { cache: 'no-store' });
      const data = await readJsonResponse(response, 'Stremio request failed');
      if (!response.ok) throw new Error(data?.error || 'Catalog failed');
      setCatalogState((state) => {
        const previous = state[key]?.items || [];
        const nextItems = append ? [...previous, ...(data.items || [])] : (data.items || []);
        const seen = new Set();
        const deduped = nextItems.filter((item) => {
          const itemKey = `${item.type}:${item.id}`;
          if (seen.has(itemKey)) return false;
          seen.add(itemKey);
          return true;
        });
        return {
          ...state,
          [key]: {
            items: deduped,
            skip: skip + (data.count || 0),
            hasMore: Boolean(data.hasMore),
            loading: false,
            error: '',
            catalogName: data.catalogName,
          },
        };
      });
    } catch (err) {
      setCatalogState((state) => ({ ...state, [key]: { ...(state[key] || {}), loading: false, error: err.message || 'Catalog failed' } }));
    }
  }, [catalogState]);

  useEffect(() => {
    async function loadManifest() {
      try {
        setStatus('loading');
        setError('');
        const response = await fetch('/api/stremio/manifest?source=catalog', { cache: 'no-store' });
        const data = await readJsonResponse(response, 'Stremio request failed');
        if (!response.ok || !data.ok) throw new Error(data?.error || 'Stremio manifest failed');
        const options = (data.manifest?.catalogs || [])
          .filter((catalog) => catalog.type === 'movie' || catalog.type === 'series')
          .map(normalizeCatalog)
          .filter((catalog) => catalog.id);
        const uniqueOptions = [];
        const seen = new Set();
        for (const option of options) {
          const key = catalogKey(option);
          if (!seen.has(key)) {
            seen.add(key);
            uniqueOptions.push(option);
          }
        }

        const savedKeys = JSON.parse(window.localStorage.getItem(SELECTED_CATALOGS_KEY) || '[]');
        const saved = Array.isArray(savedKeys)
          ? savedKeys.map((key) => uniqueOptions.find((option) => catalogKey(option) === key)).filter(Boolean)
          : [];
        const defaults = saved.length ? saved : getDefaultCatalogs(uniqueOptions, data.tamilCatalogs || {});

        setManifest(data.manifest);
        setCatalogOptions(uniqueOptions);
        setSelectedCatalogs(defaults);
        setActiveKey(defaults[0] ? catalogKey(defaults[0]) : '');
        setPickerValue(uniqueOptions[0] ? catalogKey(uniqueOptions[0]) : '');
        setStatus('ready');
      } catch (err) {
        setError(err.message || 'Stremio is not configured');
        setStatus('error');
      }
    }
    loadManifest();
  }, []);

  useEffect(() => {
    if (!activeCatalog) return;
    const state = catalogState[catalogKey(activeCatalog)];
    if (!state?.items?.length && !state?.loading && !state?.error) loadCatalog(activeCatalog, false);
  }, [activeCatalog, catalogState, loadCatalog]);

  useEffect(() => {
    if (!selectedCatalogs.length) return;
    try { window.localStorage.setItem(SELECTED_CATALOGS_KEY, JSON.stringify(selectedCatalogs.map(catalogKey))); } catch {}
  }, [selectedCatalogs]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !activeCatalog) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries[0]?.isIntersecting) return;
      const state = catalogState[catalogKey(activeCatalog)] || {};
      if (state.hasMore && !state.loading) loadCatalog(activeCatalog, true);
    }, { rootMargin: '900px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeCatalog, catalogState, loadCatalog]);

  function addSelectedCatalog() {
    const option = catalogOptions.find((catalog) => catalogKey(catalog) === pickerValue);
    if (!option) return;
    setSelectedCatalogs((current) => {
      if (current.some((catalog) => catalogKey(catalog) === catalogKey(option))) return current;
      return [...current, option];
    });
    setActiveKey(catalogKey(option));
  }

  function removeSelectedCatalog(key) {
    setSelectedCatalogs((current) => {
      const next = current.filter((catalog) => catalogKey(catalog) !== key);
      if (activeKey === key) setActiveKey(next[0] ? catalogKey(next[0]) : '');
      return next;
    });
  }

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[radial-gradient(circle_at_12%_0%,rgba(217,70,239,0.20),transparent_30%),linear-gradient(180deg,#080014,#050505_55%,#090014)] pb-10 text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-fuchsia-400/10 bg-[#080008]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white">← Home</Link>
          <p className="text-[10px] font-black uppercase tracking-[0.30em] text-fuchsia-300">Stremio</p>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-fuchsia-400/20 bg-white/[0.04] p-5 shadow-2xl shadow-fuchsia-950/20 sm:p-7">
          <p className="text-xs font-black uppercase tracking-[0.35em] text-fuchsia-300/80">Authorized Addon</p>
          <h1 className="mt-3 text-4xl font-black text-white sm:text-6xl">Stremio</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">Choose which catalogs from your manifest should appear. Click a catalog button to lazy-load posters for that catalog.</p>
          {manifest?.name ? <p className="mt-3 text-xs font-bold text-zinc-500">Addon: {manifest.name} • {manifest.version}</p> : null}

          <div className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <select value={pickerValue} onChange={(event) => setPickerValue(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm font-bold text-white outline-none focus:border-fuchsia-300">
              {catalogOptions.map((catalog) => <option key={catalogKey(catalog)} value={catalogKey(catalog)}>{catalogLabel(catalog)}</option>)}
            </select>
            <button type="button" onClick={addSelectedCatalog} className="rounded-2xl border border-fuchsia-300/30 bg-fuchsia-500/10 px-5 py-3 text-sm font-black text-fuchsia-100 hover:border-fuchsia-300/70">Add</button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {selectedCatalogs.map((catalog) => {
              const key = catalogKey(catalog);
              const active = key === activeKey;
              return (
                <div key={key} className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 transition ${active ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-50' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}>
                  <button type="button" onClick={() => setActiveKey(key)} className="px-2 py-1 text-xs font-black">{catalogLabel(catalog)}</button>
                  <button type="button" onClick={() => removeSelectedCatalog(key)} className="grid h-6 w-6 place-items-center rounded-full text-xs font-black text-zinc-400 hover:bg-black/30 hover:text-white" title="Remove catalog">×</button>
                </div>
              );
            })}
          </div>
        </div>

        {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-5 text-red-200">{error}<p className="mt-2 text-xs text-zinc-500">Set STREMIO/STREMIO_HOME/STREMIO_CATALOG to your addon manifest URL.</p></div> : null}
        {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">Loading Stremio addon...</div> : null}

        {activeCatalog ? (
          <section className="rounded-[2rem] border border-fuchsia-400/15 bg-white/[0.035] p-4 sm:p-5">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black text-white sm:text-3xl">{catalogLabel(activeCatalog)}</h2>
                <p className="mt-1 text-xs font-semibold text-zinc-500">{activeState.catalogName || activeCatalog.name} • {activeState.items.length} loaded</p>
              </div>
              {activeState.hasMore ? <button type="button" onClick={() => loadCatalog(activeCatalog, true)} disabled={activeState.loading} className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-black text-fuchsia-100 disabled:opacity-60">More</button> : null}
            </div>
            {activeState.error ? <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{activeState.error}</div> : null}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {activeState.items.map((item) => <StremioCard key={`${item.type}-${item.id}`} item={item} />)}
              {activeState.loading ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:rounded-3xl"><div className="aspect-[2/3] animate-pulse bg-zinc-900" /><div className="space-y-2 p-3"><div className="h-4 animate-pulse rounded bg-zinc-800" /><div className="h-3 w-2/3 animate-pulse rounded bg-zinc-900" /></div></div>) : null}
            </div>
            {!activeState.loading && !activeState.items.length && !activeState.error ? <p className="rounded-2xl border border-white/10 bg-black/25 p-5 text-center text-sm text-zinc-400">No items loaded. Click this catalog button again or choose another catalog.</p> : null}
          </section>
        ) : status === 'ready' ? <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-center text-sm text-zinc-400">Select catalogs from the dropdown above.</div> : null}
        <div ref={sentinelRef} className="h-12" />
      </section>
    </main>
  );
}
