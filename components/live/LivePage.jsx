'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import LivePlayer from './Player';
import useIsDesktop from './hooks/useIsDesktop';
import useFavourites from './hooks/useFavourites';
import useAdminSession from './hooks/useAdminSession';
import useLiveCatalogue from './hooks/useLiveCatalogue';
import useQuickHide from './hooks/useQuickHide';
import { CatalogChips, CatalogRail, ChannelCard, HomeLink, friendlySourceLabel, groupCatalogIds } from './bits/channelBits';

const FIXED_CATALOG_IDS = new Set(LIVE_CATALOGS.map((c) => c.id));
const DEFAULT_CATALOG = 'main';

/**
 * LivePage — one locked viewport, right-rail cinema layout.
 *
 * Desktop: catalog rail (left) · big fill-height player (center) · right
 * panel whose channel list scrolls on top while the Now Watching details +
 * source ladder stay pinned at the bottom. Phones keep the stacked design:
 * chips, aspect-video player, then the channel list as the only scroll area.
 * The shell is exactly 100dvh with overflow hidden — nothing else scrolls.
 */
export default function LivePage() {
  const [activeSource, setActiveSource] = useState('all');
  const [activeCatalog, setActiveCatalog] = useState(DEFAULT_CATALOG); // all | fav | fixed id
  const [variantIdx, setVariantIdx] = useState(0);
  const [query, setQuery] = useState('');
  const [drawerCategory, setDrawerCategory] = useState('all');
  const isDesktop = useIsDesktop();
  const isAdmin = useAdminSession();
  const { favs, toggleFav } = useFavourites();
  const {
    groups, catalogs, status, error, setReloadKey, load,
    activeLogical, setActiveLogical,
  } = useLiveCatalogue();
  const searchRef = useRef(null);
  const mobileSearchRef = useRef(null);

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
    setActiveLogical(group || null);
    setVariantIdx(0);
  }, [setActiveLogical]);

  // Wrap-around zap inside the currently visible (filtered) list.
  const zap = useCallback((direction) => {
    if (!filtered.length) return;
    const idx = filtered.findIndex((g) => g.logicalId === activeLogical?.logicalId);
    const nextIdx = idx < 0 ? 0 : (idx + direction + filtered.length) % filtered.length;
    pick(filtered[nextIdx]);
  }, [filtered, activeLogical, pick]);

  const { removeChannel, hideError, setHideError } = useQuickHide(
    isAdmin, activeCatalog, filtered, pick, () => setReloadKey((k) => k + 1),
  );

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

      {/* Rail | player | right panel. Phones stack: auto player row, then the
          panel fills the remaining height and owns the only scroll. */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[158px_minmax(0,1fr)_minmax(340px,440px)] lg:grid-rows-1">
        <aside className="hidden min-h-0 overflow-y-auto border-r border-white/10 p-2.5 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
          <CatalogRail active={activeCatalog} onSelect={setActiveCatalog} counts={counts} favCount={favs.length} />
        </aside>

        {/* Center: the player fills the available height on desktop, with the
            manually switchable source ladder pinned underneath it. */}
        <section className="flex min-h-0 flex-col p-3 sm:p-4">
          <div className="min-h-0 flex-1">
            {activeLogical ? (
              <LivePlayer
                logical={activeLogical}
                variantIdx={variantIdx}
                onErrorNeedingFallback={onErrorFallback}
                onPrev={() => zap(-1)}
                onNext={() => zap(1)}
                liveBrowser={liveBrowser}
                fill={isDesktop}
                onRemoveChannel={isAdmin ? removeChannel : null}
              />
            ) : (
              <div className="grid h-full place-items-center rounded-2xl border border-white/10 bg-zinc-950 text-sm text-zinc-400">Pick a channel from the right</div>
            )}
          </div>

          {activeLogical && (activeLogical.variants || []).length > 1 ? (
            <div className="mt-2.5 shrink-0 rounded-2xl border border-white/10 bg-white/[0.045] p-2.5 sm:p-3">
              <p className="mb-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-500">
                Source ladder · tap to switch · fallback stays automatic
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
                {activeLogical.variants.map((v, i) => (
                  <button
                    key={`${v.channelId}-${i}`}
                    type="button"
                    onClick={() => setVariantIdx(i)}
                    title={`Play ${v.sourceLabel || friendlySourceLabel(v.sourceId)}`}
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition ${
                      i === variantIdx
                        ? 'border-red-500/70 bg-red-500/15 text-white'
                        : 'border-white/10 bg-black/30 text-zinc-400 hover:border-white/30 hover:text-white'
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${i === variantIdx ? 'bg-red-400 shadow-[0_0_8px_rgba(255,59,77,.9)]' : 'bg-zinc-600'}`} />
                    {v.sourceLabel || friendlySourceLabel(v.sourceId)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* Right panel: channel list scrolls, details pinned at its bottom */}
        <aside className="flex min-h-0 flex-col border-t border-white/10 bg-white/[0.025] lg:border-l lg:border-t-0">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-white/10 px-3.5 py-2.5">
            <h3 className="text-[13px] font-black">{activeTitle}</h3>
            <span className="text-[11px] text-zinc-500">{filtered.length}</span>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)}
              className="ml-auto rounded-full border border-white/10 px-2.5 py-1 text-[10.5px] font-bold text-zinc-300 hover:border-red-500/60">↻ Refresh</button>
          </div>

          <div className="order-2 min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-width:thin] lg:order-1 lg:p-3">
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
                <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-4 lg:gap-2">
                {filtered.map((group) => (
                  <ChannelCard key={group.logicalId} group={group} active={group.logicalId === activeLogical?.logicalId} onPick={pick} canHide={isAdmin} onHide={removeChannel} />
                ))}
              </div>
            ) : null}
          </div>

          {/* Now Watching — compact details pinned at the panel bottom. The
              source ladder itself lives under the player, not here. Hidden on
              phones where the stacked layout has no room. */}
          {activeLogical ? (
            <div className="order-1 shrink-0 border-t border-white/10 bg-white/[0.045] p-3.5 md:flex lg:order-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[14px] font-black leading-tight">{activeLogical.displayName}</h2>
                <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                  {groupCatalogIds(activeLogical).map((id) => catalogs.find((c) => c.id === id)?.name).filter(Boolean).join(' · ') || 'Live'} · Tamil
                </p>
              </div>
              <button type="button" onClick={() => toggleFav(activeLogical.logicalId)}
                className={`mt-2 self-start rounded-full border px-3 py-1 text-[11px] font-bold ${activeIsFav ? 'border-yellow-400/60 bg-yellow-400/10 text-yellow-300' : 'border-white/10 text-zinc-400'}`}>
                {activeIsFav ? '★ Favourite' : '☆ Favourite'}
              </button>
            </div>
          ) : null}
        </aside>
      </div>

      {hideError ? (
        <div className="fixed bottom-4 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-full border border-red-500/50 bg-red-950/90 px-4 py-2 text-[12px] font-bold text-red-100 shadow-xl backdrop-blur">
          <span>Couldn’t remove channel: {hideError}</span>
          <button type="button" onClick={() => setHideError('')} aria-label="Dismiss" className="grid h-5 w-5 place-items-center rounded-full border border-white/20">✕</button>
        </div>
      ) : null}
    </main>
  );
}
