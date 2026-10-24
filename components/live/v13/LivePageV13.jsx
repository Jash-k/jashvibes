'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import LivePlayerV13 from './LivePlayerV13';
import TvMode from './TvMode';
import MobileSheet from './MobileSheet';
import useTvMode from './useTvMode';
import { CatalogChips, CatalogRail, ChannelCard, HomeLink, friendlySourceLabel, groupCatalogIds } from './channelBits';

const FAV_KEY = 'jash_live_v13_favs';
const FIXED_CATALOG_IDS = new Set(LIVE_CATALOGS.map((c) => c.id));

export default function LivePageV13() {
  const [groups, setGroups] = useState([]);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [activeSource, setActiveSource] = useState('all');
  const [activeCatalog, setActiveCatalog] = useState('all'); // all | fav | fixed id
  const [catalogs, setCatalogs] = useState([]);
  const [activeLogical, setActiveLogical] = useState(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [drawerCategory, setDrawerCategory] = useState('all');
  const { tvMode, setTvMode } = useTvMode();
  const searchRef = useRef(null);
  const mobileSearchRef = useRef(null);
  const focusSearch = useCallback(() => {
    const input = window.innerWidth < 640 ? mobileSearchRef.current : searchRef.current;
    input?.focus?.();
  }, []);

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { /* no stored favs */ } }, []);
  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const load = useCallback(async (source = 'all', catalog = 'all') => {
    setStatus('loading');
    setError('');
    try {
      const params = new URLSearchParams({ tamilOnly: '1' });
      if (source !== 'all') params.set('source', source);
      if (FIXED_CATALOG_IDS.has(catalog)) params.set('catalog', catalog);
      const res = await fetch(`/api/live/channels?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      if (data.needSync) throw new Error(data.hint || 'No channels synced yet — open Admin → TV → Sync All Tamil');
      setCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      const playable = (data.logical || []).filter((g) => g.variants?.some((v) => !!v.url));
      setGroups(playable);
      const c = { all: playable.length };
      for (const cat of data.catalogs || []) c[cat.id] = cat.count;
      for (const g of playable) for (const sid of g.sourceIds || []) c[sid] = (c[sid] || 0) + 1;
      setCounts(c);
      if (playable.length) {
        setActiveLogical((prev) => (prev?.logicalId && playable.some((g) => g.logicalId === prev.logicalId) ? prev : playable[0]));
      } else {
        setError(catalog === 'all' ? 'No Tamil channels found — sync sources in Admin → TV.' : 'No channels in this catalog.');
      }
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(activeSource, activeCatalog); }, [activeSource, activeCatalog, load]);

  const favSet = useMemo(() => new Set(favs), [favs]);

  const filtered = useMemo(() => {
    let list = groups;
    if (activeCatalog === 'fav') list = list.filter((g) => favSet.has(g.logicalId));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((g) => `${g.displayName} ${g.category || ''}`.toLowerCase().includes(q));
    return list;
  }, [groups, activeCatalog, favSet, query]);

  const pick = useCallback((group) => {
    if (!group) return;
    setActiveLogical(group);
    setVariantIdx(0);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Wrap-around zap inside the currently visible (filtered) list.
  const zap = useCallback((direction) => {
    if (!filtered.length) return;
    const idx = filtered.findIndex((g) => g.logicalId === activeLogical?.logicalId);
    const nextIdx = idx < 0 ? 0 : (idx + direction + filtered.length) % filtered.length;
    pick(filtered[nextIdx]);
  }, [filtered, activeLogical, pick]);

  const onErrorFallback = useCallback((logical, idx) => {
    const next = idx + 1;
    if (next < (logical.variants?.length || 0)) setVariantIdx(next);
  }, []);

  // In-player ChannelDrawer contract: stable ids, friendly rows, catalog chips.
  const browserItems = useMemo(() => groups.map((g) => ({
    id: g.logicalId,
    name: g.displayName,
    logo: g.logo || '',
    catalogs: groupCatalogIds(g),
  })), [groups]);
  const liveBrowser = useMemo(() => ({
    items: browserItems,
    catalogs: LIVE_CATALOGS.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    category: drawerCategory,
    onCategory: setDrawerCategory,
    activeId: activeLogical?.logicalId || '',
    onPick: (item) => {
      const group = groups.find((g) => g.logicalId === item.id);
      if (group) pick(group);
    },
  }), [browserItems, drawerCategory, activeLogical, groups, pick]);

  const sourceOptions = useMemo(() => {
    const ids = new Set(groups.flatMap((g) => g.sourceIds || []));
    return [...ids].sort();
  }, [groups]);

  return (
    <main className="min-h-screen bg-[#07070a] pb-24 text-white lg:pb-8">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#07070a]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-5">
          <Link href="/" className="shrink-0 text-[15px] font-black tracking-[0.14em]">JASH VIBES <span className="text-red-600">LIVE</span></Link>
          <div className="ml-1 hidden min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-zinc-400 sm:flex sm:max-w-md">
            🔍
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Tamil channels…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-500" />
          </div>
          <select value={activeSource} onChange={(e) => setActiveSource(e.target.value)}
            className="ml-auto rounded-full border border-white/10 bg-black px-3 py-1.5 text-[12px] font-bold text-zinc-300 outline-none sm:ml-0">
            <option value="all">All sources</option>
            {sourceOptions.map((id) => <option key={id} value={id}>{friendlySourceLabel(id)}</option>)}
          </select>
          <button type="button" onClick={() => setTvMode(!tvMode)}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12px] font-bold text-zinc-300 hover:border-red-500/60">
            📺 TV Mode{tvMode ? ' · on' : ''}
          </button>
          <HomeLink className="h-8 w-8 shrink-0 text-sm" />
          <Link href="/admin?tab=tv" title="Admin"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-sm text-zinc-300 hover:border-red-500/60">⚙</Link>
        </div>
        {/* Mobile search */}
        <div className="px-3 pb-2.5 sm:hidden">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-zinc-400">
            🔍
            <input ref={mobileSearchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels…"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-500" />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-4 px-3 py-4 sm:px-5 lg:grid-cols-[176px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-[76px]">
            <CatalogRail active={activeCatalog} onSelect={setActiveCatalog} counts={counts} favCount={favs.length} />
          </div>
        </aside>

        <section className="min-w-0">
          {activeLogical ? (
            <div className="mb-4">
              <LivePlayerV13
                logical={activeLogical}
                variantIdx={variantIdx}
                onErrorNeedingFallback={onErrorFallback}
                onPrev={() => zap(-1)}
                onNext={() => zap(1)}
                liveBrowser={liveBrowser}
              />
              <div className="mt-2 flex items-center gap-3">
                <h1 className="truncate text-[15px] font-black">{activeLogical.displayName}</h1>
                <button type="button" onClick={() => toggleFav(activeLogical.logicalId)}
                  className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-bold ${favSet.has(activeLogical.logicalId) ? 'border-yellow-400/60 bg-yellow-400/10 text-yellow-300' : 'border-white/10 text-zinc-400'}`}>
                  {favSet.has(activeLogical.logicalId) ? '★ Favourite' : '☆ Favourite'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-4 grid place-items-center rounded-2xl border border-white/10 bg-zinc-950 p-12 text-sm text-zinc-400">Pick a channel below</div>
          )}

          <div className="lg:hidden">
            <CatalogChips active={activeCatalog} onSelect={setActiveCatalog} counts={counts} favCount={favs.length} />
          </div>

          <div className="mb-3 mt-3 flex items-center gap-3 lg:mt-2">
            <h2 className="text-sm font-black">
              {activeCatalog === 'fav' ? '★ Favorites' : activeCatalog === 'all' ? 'All Tamil channels' : (catalogs.find((c) => c.id === activeCatalog)?.name || 'Channels')}
              <span className="ml-2 text-[11px] font-bold text-zinc-500">{filtered.length}</span>
            </h2>
            <button type="button" onClick={() => setSheetOpen(true)}
              className="ml-auto rounded-full border border-white/10 px-3 py-1 text-[11px] font-bold text-red-300 lg:hidden">See all ↑</button>
          </div>

          {status === 'loading' ? <p className="p-6 text-sm text-zinc-400">Loading Tamil live…</p> : null}
          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-950/25 p-4 text-sm text-red-200">
              {error} <button type="button" onClick={() => load(activeSource, activeCatalog)} className="ml-2 underline">Retry</button>
            </p>
          ) : null}
          {status === 'ready' && !filtered.length ? (
            <p className="rounded-xl border border-white/10 bg-zinc-950 p-6 text-center text-sm text-zinc-400">No channels match this view.</p>
          ) : null}

          {status === 'ready' && filtered.length ? (
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-4 lg:gap-3">
              {filtered.map((group) => (
                <ChannelCard key={group.logicalId} group={group} active={group.logicalId === activeLogical?.logicalId} onPick={pick} />
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {/* Phone bottom tab bar */}
      <nav className="fixed inset-x-3 bottom-3 z-40 flex justify-around rounded-2xl border border-white/10 bg-[#121218]/90 p-2 backdrop-blur-md lg:hidden">
        <Link href="/" className="flex min-w-[60px] flex-col items-center gap-1 text-[10px] font-bold text-zinc-400"><span className="text-base">🏠</span>Home</Link>
        <button type="button" onClick={focusSearch}
          className="flex min-w-[60px] flex-col items-center gap-1 text-[10px] font-bold text-zinc-400"><span className="text-base">🔍</span>Search</button>
        <button type="button" onClick={() => setActiveCatalog('fav')}
          className="flex min-w-[60px] flex-col items-center gap-1 text-[10px] font-bold text-zinc-400"><span className="text-base">★</span>Favs</button>
        <button type="button" onClick={() => setTvMode(true)}
          className="flex min-w-[60px] flex-col items-center gap-1 text-[10px] font-bold text-zinc-400"><span className="text-base">📺</span>TV</button>
      </nav>

      <MobileSheet open={sheetOpen} title={activeCatalog === 'fav' ? 'Favorites' : 'Channels'} groups={filtered}
        activeId={activeLogical?.logicalId} onPick={pick} onClose={() => setSheetOpen(false)} />

      <TvMode
        open={tvMode}
        onClose={() => setTvMode(false)}
        groups={groups}
        favIds={favs}
        activeId={activeLogical?.logicalId}
        onTune={pick}
        onZap={zap}
      />

    </main>
  );
}
