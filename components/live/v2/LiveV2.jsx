'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useIsDesktop from '../hooks/useIsDesktop';
import useFavourites from '../hooks/useFavourites';
import useV2Catalogue from './useV2Catalogue';
import V2Player from './V2Player';

const ALL = 'all';
const FAV = 'fav';
// Owner rule: V2 opens inside the Tamil category (the pinned head group),
// never the unfiltered All view. Fall back to All only if a feed ever lacks
// a Tamil group.
const TAMIL = 'v2-cat-tamil';

/**
 * LiveV2 — the PlugX-style fast source rendered inside the SAME locked
 * viewport shell as V1: desktop rail · fill-height player · scrolling list,
 * and stacked chips · 16:9 player · list on phones. The header (and its V1/V2
 * toggle) stays owned by LivePage, so this component starts at the grid.
 */
export default function LiveV2() {
  const isDesktop = useIsDesktop();
  const { groups, flat, tokenState, status, error, reload } = useV2Catalogue();
  const { favs, toggleFav } = useFavourites();
  const [activeCat, setActiveCat] = useState(TAMIL);
  const [activeId, setActiveId] = useState('');
  const [query, setQuery] = useState('');

  const favSet = useMemo(() => new Set(favs), [favs]);

  // Defensive: if a feed ever ships without a Tamil group, the default chip
  // would filter to an empty list — drop back to All once the groups arrive.
  useEffect(() => {
    if (!groups.length) return;
    if (activeCat === TAMIL && !groups.some((g) => g.id === TAMIL)) setActiveCat(ALL);
  }, [groups, activeCat]);

  // Land on the first channel of the first owner-ordered category (Tamil when present).
  useEffect(() => {
    if (activeId || !flat.length) return;
    const firstGroup = groups[0]?.channels?.[0];
    setActiveId(firstGroup?.id || flat[0].id);
  }, [flat, groups, activeId]);

  const counts = useMemo(() => {
    const c = { [ALL]: flat.length, [FAV]: flat.filter((r) => favSet.has(r.id)).length };
    for (const g of groups) c[g.id] = g.count;
    return c;
  }, [flat, groups, favSet]);

  const filtered = useMemo(() => {
    let list = flat;
    if (activeCat === FAV) list = list.filter((r) => favSet.has(r.id));
    else if (activeCat !== ALL) list = list.filter((r) => `v2-cat-${String(r.category || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === activeCat);
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((r) => `${r.name} ${r.category}`.toLowerCase().includes(q));
    return list;
  }, [flat, activeCat, favSet, query]);

  const active = useMemo(() => flat.find((r) => r.id === activeId) || null, [flat, activeId]);

  const pick = useCallback((channel) => setActiveId(channel?.id || ''), []);

  const zap = useCallback((direction) => {
    if (!filtered.length) return;
    const idx = filtered.findIndex((r) => r.id === activeId);
    const nextIdx = idx < 0 ? 0 : (idx + direction + filtered.length) % filtered.length;
    setActiveId(filtered[nextIdx].id);
  }, [filtered, activeId]);

  const chipDefs = useMemo(() => [
    { id: ALL, label: 'All' },
    { id: FAV, label: '♥ Favs' },
    ...groups.map((g) => ({ id: g.id, label: g.name })),
  ], [groups]);

  if (status === 'loading') {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <div className="flex flex-col items-center gap-3 text-zinc-400">
          <div className="h-9 w-9 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
          <span className="text-[11px] font-bold uppercase tracking-[0.22em]">Loading V2 source</span>
        </div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <div className="max-w-sm rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-center">
          <p className="text-sm text-red-200">{error}</p>
          <button type="button" onClick={reload} className="mt-3 rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black">Retry</button>
        </div>
      </div>
    );
  }

  const chips = (
    <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
      {chipDefs.map((chip) => (
        <button
          key={chip.id}
          type="button"
          data-v2-chip="1"
          onClick={() => setActiveCat(chip.id)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11.5px] font-bold transition ${
            activeCat === chip.id ? 'border-red-500 bg-red-600 text-white' : 'border-white/10 bg-white/[0.04] text-zinc-300'
          }`}
        >
          {chip.label}
          <span className="rounded-full bg-black/40 px-1.5 text-[10px]">{counts[chip.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );

  const card = (channel) => (
    <button
      key={channel.id}
      type="button"
      data-v2-card="1"
      onClick={() => pick(channel)}
      className={`group w-full overflow-hidden rounded-xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
        activeId === channel.id ? 'border-red-500 bg-red-950/25 ring-1 ring-red-500/60' : 'border-white/10 bg-white/[0.04] hover:border-white/25'
      }`}
    >
      <div className="relative grid aspect-[16/10] place-items-center overflow-hidden bg-black">
        {channel.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={channel.logo} alt="" loading="lazy" className="max-h-[75%] max-w-[80%] object-contain" />
        ) : <span className="text-[10px] font-black text-zinc-500">TV</span>}
        <span
          role="button"
          tabIndex={-1}
          aria-label={favSet.has(channel.id) ? 'Remove favourite' : 'Add favourite'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFav(channel.id); }}
          className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/70 text-[11px] backdrop-blur"
        >
          {favSet.has(channel.id) ? '♥' : '☆'}
        </span>
      </div>
      <div className="px-2.5 py-2">
        <p className="line-clamp-1 text-xs font-semibold text-zinc-100">{channel.name}</p>
        <p className="line-clamp-1 text-[10px] text-zinc-500">{channel.category}</p>
      </div>
    </button>
  );

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[158px_minmax(0,1fr)_minmax(340px,440px)] lg:grid-rows-1">
      {/* Desktop category rail */}
      <aside className="hidden min-h-0 overflow-y-auto border-r border-white/10 p-2.5 [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
        {chipDefs.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => setActiveCat(chip.id)}
            className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-[12.5px] font-bold transition ${
              activeCat === chip.id ? 'bg-red-600 text-white' : 'text-zinc-300 hover:bg-white/5'
            }`}
          >
            <span className="truncate">{chip.label}</span>
            <span className="ml-2 text-[10px] opacity-80">{counts[chip.id] ?? 0}</span>
          </button>
        ))}
      </aside>

      {/* Center: player */}
      <section className="flex min-h-0 min-w-0 flex-col gap-2 p-3 sm:p-4">
        <div className="min-w-0 sm:hidden">{chips}</div>
        <div className="min-h-0 flex-1">
          {active ? (
            <V2Player
              channel={active}
              fill={isDesktop}
              onPrev={() => zap(-1)}
              onNext={() => zap(1)}
            />
          ) : (
            <div className="grid h-full place-items-center rounded-2xl border border-white/10 bg-zinc-950 text-sm text-zinc-400">Pick a channel to start watching</div>
          )}
        </div>
        {!tokenState?.hasToken ? (
          <p className="shrink-0 rounded-lg border border-amber-400/30 bg-amber-950/30 px-3 py-1.5 text-[10.5px] text-amber-200">
            Pre-baked token not harvested yet — first tune may take a little longer while the server fetches one.
          </p>
        ) : null}
      </section>

      {/* Right: channel list (the only scrolling surface on phones) */}
      <aside className="flex min-h-0 min-w-0 flex-col border-t border-white/10 bg-white/[0.025] lg:border-l lg:border-t-0">
        <div className="flex shrink-0 items-center justify-between gap-2.5 border-b border-white/10 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-black">{activeCat === FAV ? 'Favourites' : activeCat === ALL ? 'All V2 channels' : chipDefs.find((c) => c.id === activeCat)?.label}</p>
            <p className="text-[10.5px] text-zinc-500">{filtered.length} channels</p>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-28 rounded-full border border-white/10 bg-black px-3 py-1.5 text-[11px] outline-none placeholder:text-zinc-500"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-width:thin] lg:p-3">
          {filtered.length ? (
            <div className="grid grid-cols-3 gap-2 md:grid-cols-4 lg:grid-cols-4">{filtered.map(card)}</div>
          ) : (
            <p className="p-4 text-center text-xs text-zinc-500">No channels match this filter.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
