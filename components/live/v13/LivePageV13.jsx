'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import LivePlayerV13 from './LivePlayerV13';
import TvMode from './TvMode';
import useTvMode from './useTvMode';
import { CatalogChips, CatalogRail, ChannelCard, HomeLink, friendlySourceLabel, groupCatalogIds } from './channelBits';
import { pickLandingGroup } from '@/lib/live/landing';

const FAV_KEY = 'jash_live_v13_favs';
const FIXED_CATALOG_IDS = new Set(LIVE_CATALOGS.map((c) => c.id));
const DEFAULT_CATALOG = 'main';

/**
 * LivePageV13 — Design A "Cinema Split", one locked viewport.
 *
 * The shell is exactly 100dvh with overflow hidden: header, catalog rail and
 * the hero/channel panel all fit the screen. The ONLY scrolling region is the
 * channel panel itself (and the horizontal rail on phones). On mobile the
 * rail becomes catalog chips and the info card collapses away.
 */
export default function LivePageV13() {
  const [groups, setGroups] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeSource, setActiveSource] = useState('all');
  const [activeCatalog, setActiveCatalog] = useState(DEFAULT_CATALOG); // all | fav | fixed id
  const [activeLogical, setActiveLogical] = useState(null);
  const [variantIdx, setVariantIdx] = useState(0);
  const [query, setQuery] = useState('');
  const [favs, setFavs] = useState([]);
  const [drawerCategory, setDrawerCategory] = useState('all');
  const { tvMode, setTvMode } = useTvMode();
  const searchRef = useRef(null);
  const mobileSearchRef = useRef(null);

  useEffect(() => { try { setFavs(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { /* no stored favs */ } }, []);
  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  // Single full-catalogue fetch. Catalog/source/search switches are pure
  // client-side filtering afterwards, so tab changes make zero network calls.
  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/live/channels?tamilOnly=1', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      if (data.needSync) throw new Error(data.hint || 'No channels synced yet — open Admin → TV → Sync All Tamil');
      setCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      const playable = (data.logical || []).filter((g) => g.variants?.some((v) => !!v.url));
      setGroups(playable);
      setActiveLogical((prev) => {
        if (prev?.logicalId && playable.some((g) => g.logicalId === prev.logicalId)) return prev;
        return pickLandingGroup(playable);
      });
      if (!playable.length) setError('No Tamil channels found — sync sources in Admin → TV.');
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  const favSet = useMemo(() => new Set(favs), [favs]);

  const counts = useMemo(() => {
    const c = { all: groups.length };
    for (const cat of LIVE_CATALOGS) c[cat.id] = groups.filter((g) => groupCatalogIds(g).includes(cat.id)).length;
    for (const g of groups) for (const sid of g.sourceIds || []) c[sid] = (c[sid] || 0) + 1;
    return c;
  }, [groups]);

  const filtered = useMemo(() => {
    let list = groups;
    if (activeCatalog === 'fav') list = list.filter((g) => favSet.has(g.logicalId));
    else if (FIXED_CATALOG_IDS.has(activeCatalog)) list = list.filter((g) => groupCatalogIds(g).includes(activeCatalog));
    if (activeSource !== 'all') list = list.filter((g) => (g.sourceIds || []).includes(activeSource));
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((g) => `${g.displayName} ${g.category || ''}`.toLowerCase().includes(q));
    return list;
  }, [groups, activeCatalog, activeSource, favSet, query]);

  const pick = useCallback((group) => {
    if (!group) return;
    setActiveLogical(group);
    setVariantIdx(0);
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

  const sourceOptions = useMemo(() => [...new Set(groups.flatMap((g) => g.sourceIds || []))].sort(), [groups]);
  const activeTitle = activeCatalog === 'fav'
    ? '★ Favorites'
    : activeCatalog === 'all'
      ? 'All Tamil channels'
      : (catalogs.find((c) => c.id === activeCatalog)?.name || 'Channels');
  const activeIsFav = activeLogical ? favSet.has(activeLogical.logicalId) : false;

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-[#07070a] text-white">
      <header className="z-30 shrink-0 border-b border-white/10 bg-[#07070a]/90 backdrop-blur-md">
        <div className="flex items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <Link href="/" className="shrink-0 text-[14px] font-black tracking-[0.14em]">JASH VIBES <span className="text-red-600">LIVE</span></Link>
          <div className="ml-1 hidden min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-zinc-400 sm:flex sm:max-w-md">
            🔍
            <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Tamil channels…"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-zinc-500" />
          </div>
          <select value={activeSource} onChange={(e) => setActiveSource(e.target.value)}
            className="ml-auto rounded-full border border-white/10 bg-black px-2.5 py-1.5 text-[11.5px] font-bold text-zinc-300 outline-none sm:ml-0">
            <option value="all">All sources</option>
            {sourceOptions.map((id) => <option key={id} value={id}>{friendlySourceLabel(id)}</option>)}
          </select>
          <button type="button" onClick={() => setTvMode(!tvMode)}
            className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-bold text-zinc-300 hover:border-red-500/60">
            📺 <span className="hidden sm:inline">TV Mode</span>{tvMode ? ' · on' : ''}
          </button>
          <HomeLink className="h-8 w-8 shrink-0 text-sm" />
          <Link href="/admin?tab=tv" title="Admin"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-sm text-zinc-300 hover:border-red-500/60">⚙</Link>
        </div>
        {/* Mobile search + catalog chips — horizontal only, never scrolls the page */}
        <div className="px-3 pb-2 sm:hidden">
          <div className="mb-1.5 flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-zinc-400">
            🔍
            <input ref={mobileSearchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels…"
              className="w-full bg-transparent text-[12.5px] outline-none placeholder:text-zinc-500" />
          </div>
          <CatalogChips active={activeCatalog} onSelect={setActiveCatalog} counts={counts} favCount={favs.length} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[158px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-white/10 p-2.5 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
          <CatalogRail active={activeCatalog} onSelect={setActiveCatalog} counts={counts} favCount={favs.length} />
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2.5 p-3 sm:gap-3.5 sm:p-4">
          {/* Hero: player + compact info card */}
          <div className="grid min-h-0 grid-cols-1 gap-2.5 md:grid-cols-[minmax(0,1.7fr)_minmax(230px,.78fr)] sm:gap-3.5">
            <div className="min-h-0">
              {activeLogical ? (
                <LivePlayerV13
                  logical={activeLogical}
                  variantIdx={variantIdx}
                  onErrorNeedingFallback={onErrorFallback}
                  onPrev={() => zap(-1)}
                  onNext={() => zap(1)}
                  liveBrowser={liveBrowser}
                />
              ) : (
                <div className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-zinc-950 text-sm text-zinc-400">Pick a channel below</div>
              )}
            </div>

            {activeLogical ? (
              <aside className="hidden min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-3.5 md:flex">
                <h2 className="text-[15px] font-black leading-tight">{activeLogical.displayName}</h2>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {groupCatalogIds(activeLogical).map((id) => catalogs.find((c) => c.id === id)?.name).filter(Boolean).join(' · ') || 'Live'} · Tamil
                </p>
                <button type="button" onClick={() => toggleFav(activeLogical.logicalId)}
                  className={`mt-2 self-start rounded-full border px-3 py-1 text-[11px] font-bold ${activeIsFav ? 'border-yellow-400/60 bg-yellow-400/10 text-yellow-300' : 'border-white/10 text-zinc-400'}`}>
                  {activeIsFav ? '★ Favourite' : '☆ Favourite'}
                </button>
                <p className="mt-auto pt-2 text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">Source ladder · automatic</p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {(activeLogical.variants || []).slice(0, 4).map((v, i) => (
                    <div key={`${v.channelId}-${i}`} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11.5px] ${i === variantIdx ? 'border-red-500/55 bg-red-500/10 font-bold' : 'border-white/10 text-zinc-400'}`}>
                      <span className={`h-2 w-2 rounded-full ${i === variantIdx ? 'bg-red-400 shadow-[0_0_8px_rgba(255,59,77,.9)]' : 'bg-zinc-600'}`} />
                      {v.sourceLabel || friendlySourceLabel(v.sourceId)}
                      <em className="ml-auto not-italic text-[10px] text-zinc-500">{i === variantIdx ? 'playing · auto' : 'fallback'}</em>
                    </div>
                  ))}
                </div>
              </aside>
            ) : null}
          </div>

          {/* Channel panel — the page's only scrolling region */}
          <div className="flex min-h-0 flex-col rounded-2xl border border-white/10 bg-white/[0.025]">
            <div className="flex shrink-0 items-center gap-2.5 border-b border-white/10 px-3.5 py-2.5">
              <h3 className="text-[13px] font-black">{activeTitle}</h3>
              <span className="text-[11px] text-zinc-500">{filtered.length}</span>
              <button type="button" onClick={() => setReloadKey((k) => k + 1)}
                className="ml-auto rounded-full border border-white/10 px-2.5 py-1 text-[10.5px] font-bold text-zinc-300 hover:border-red-500/60">↻ Refresh</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:thin]">
              {status === 'loading' ? <p className="p-6 text-center text-[12.5px] text-zinc-400">Loading Tamil live…</p> : null}
              {error ? (
                <p className="m-3 rounded-xl border border-red-500/30 bg-red-950/25 p-3.5 text-[12.5px] text-red-200">
                  {error} <button type="button" onClick={load} className="ml-2 underline">Retry</button>
                </p>
              ) : null}
              {status === 'ready' && !filtered.length ? (
                <p className="p-6 text-center text-[12.5px] text-zinc-400">No channels match this view.</p>
              ) : null}
              {status === 'ready' && filtered.length ? (
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-6 lg:gap-2.5">
                  {filtered.map((group) => (
                    <ChannelCard key={group.logicalId} group={group} active={group.logicalId === activeLogical?.logicalId} onPick={pick} />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </div>

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
