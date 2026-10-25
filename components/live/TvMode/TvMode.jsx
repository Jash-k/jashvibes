'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import { ChannelCard, groupCatalogIds } from '../bits/channelBits';

/**
 * TvMode — 10-foot leanback overlay for Android TV / Fire TV / smart-TV browsers.
 *
 * Full remote coverage:
 *   D-pad arrows  spatial focus: catalog rail <-> channel rows <-> cards
 *   OK / Enter    tune the focused channel, then hand focus to the player so
 *                 its own key map owns playback (play/pause, G guide, volume,
 *                 fullscreen, media keys, PageUp/PageDown channel zap)
 *   Back          card -> rail; rail -> leave TV browsing
 *   Channel rocker (PageUp/PageDown) zaps with wrap-around while browsing
 * Media keys (MediaPlayPause, MediaTrackNext…) are never intercepted here —
 * they pass to the player once it holds focus.
 */
export default function TvMode({ open, onClose, groups = [], favIds, activeId, onTune, onZap }) {
  const rootRef = useRef(null);
  const [zone, setZone] = useState('rail'); // rail | rows | player
  const [railIdx, setRailIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [colIdx, setColIdx] = useState(0);

  const favSet = useMemo(() => new Set(favIds || []), [favIds]);
  const rows = useMemo(() => {
    const out = [];
    const favs = groups.filter((g) => favSet.has(g.logicalId));
    if (favs.length) out.push({ id: 'fav', name: 'Favorites', icon: '♥', groups: favs });
    for (const catalog of LIVE_CATALOGS) {
      const members = groups.filter((g) => groupCatalogIds(g).includes(catalog.id));
      if (members.length) out.push({ id: catalog.id, name: catalog.name, icon: catalog.icon, groups: members });
    }
    if (!out.length && groups.length) out.push({ id: 'all', name: 'All Tamil', icon: '★', groups });
    return out;
  }, [groups, favSet]);

  const railItems = rows;

  const focusCard = useCallback((r, c) => {
    const rowEl = rootRef.current?.querySelectorAll('[data-tv-row]')[r];
    const card = rowEl?.querySelectorAll('[data-ch-card]')[Math.min(c, rowEl.querySelectorAll('[data-ch-card]').length - 1)];
    card?.focus?.({ preventScroll: true });
    card?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, []);

  const focusRail = useCallback((index) => {
    const btn = rootRef.current?.querySelectorAll('[data-tv-rail]')[index];
    btn?.focus?.({ preventScroll: true });
    btn?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  // After tuning, move focus onto the player root (data-dvp="root",
  // tabIndex=-1) so its own key map owns every remote key — play/pause, guide,
  // volume, fullscreen, media keys and the channel rocker. The timeout lets
  // the per-channel remount settle before we grab the new node.
  const handFocusToPlayer = useCallback(() => {
    setTimeout(() => {
      const root = document.querySelector('[data-dvp="root"]');
      if (root) root.focus?.({ preventScroll: true });
      else document.activeElement?.blur?.();
    }, 60);
  }, []);

  // Re-paint focus when the model changes.
  useEffect(() => {
    if (!open) return;
    if (zone === 'rail') focusRail(Math.min(railIdx, railItems.length - 1));
    else if (zone === 'rows') focusCard(rowIdx, colIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, zone, railIdx, rowIdx, colIdx, rows.length]);

  useEffect(() => {
    if (open) { setZone('rail'); setRailIdx(0); setRowIdx(0); setColIdx(0); }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const node = rootRef.current;
    if (!node) return undefined;
    const onKey = (event) => {
      const key = event.key;
      const isMedia = /^Media/i.test(key);
      if (isMedia) return; // let the player handle playback media keys
      const rowCount = rows.length;
      if (zone === 'player') {
        if (key === 'Backspace' || key === 'GoBack' || key === 'BrowserBack') {
          event.preventDefault();
          setZone('rail');
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'PageUp', 'PageDown', 'Escape', 'Backspace', 'GoBack'].includes(key)) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (zone === 'rail') {
        if (key === 'ArrowDown') setRailIdx((i) => Math.min(i + 1, railItems.length - 1));
        else if (key === 'ArrowUp') setRailIdx((i) => Math.max(i - 1, 0));
        else if (key === 'ArrowRight' || key === 'Enter') {
          const target = Math.min(railIdx, rowCount - 1);
          setRowIdx(target); setColIdx(0); setZone('rows');
        } else if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
          onClose?.();
        } else if (key === 'PageDown' || key === 'PageUp') {
          onZap?.(key === 'PageDown' ? 1 : -1);
        }
        return;
      }
      // zone === rows
      const cardCount = rows[rowIdx]?.groups.length || 0;
      if (key === 'ArrowRight') setColIdx((c) => Math.min(c + 1, cardCount - 1));
      else if (key === 'ArrowLeft') {
        if (colIdx > 0) setColIdx((c) => c - 1);
        else { setZone('rail'); }
      } else if (key === 'ArrowDown') setRowIdx((r) => Math.min(r + 1, rowCount - 1));
      else if (key === 'ArrowUp') {
        if (rowIdx > 0) setRowIdx((r) => r - 1);
        else setZone('rail');
      } else if (key === 'Enter') {
        const group = rows[rowIdx]?.groups[Math.min(colIdx, cardCount - 1)];
        if (group) {
          onTune?.(group);
          setZone('player');
          handFocusToPlayer();
        }
      } else if (key === 'Escape' || key === 'Backspace' || key === 'GoBack') {
        setZone('rail');
      } else if (key === 'PageDown' || key === 'PageUp') {
        onZap?.(key === 'PageDown' ? 1 : -1);
      }
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, zone, railIdx, rowIdx, colIdx, rows, railItems.length, onClose, onTune, onZap]);

  if (!open) return null;

  // While the player owns the remote, the guide stays mounted (so Back returns
  // instantly) but becomes transparent and click-through.
  const playerOwnsRemote = zone === 'player';

  return (
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-label="Live TV guide" aria-hidden={playerOwnsRemote}
      className={`fixed inset-0 z-[80] overflow-hidden bg-[#050507]/98 outline-none transition-opacity duration-300 ${playerOwnsRemote ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
      <div className="flex h-full flex-col">
        <header className="flex items-center gap-5 border-b border-white/10 px-10 py-5">
          <span className="text-xl font-black tracking-[0.14em]">JASH VIBES <span className="text-red-600">LIVE</span></span>
          <span className="rounded-full border border-white/15 px-3 py-1.5 text-sm font-bold text-zinc-300">📺 TV Mode</span>
          <Link href="/" className="ml-2 grid h-11 w-11 place-items-center rounded-2xl border border-white/15 text-lg text-zinc-300 hover:border-red-500/60 hover:text-white">🏠</Link>
          <button type="button" onClick={onClose} className="ml-auto rounded-full border border-white/15 px-5 py-2 text-sm font-bold text-zinc-300 hover:border-red-500/60 hover:text-white">
            Exit TV · Back
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className="w-40 shrink-0 overflow-y-auto border-r border-white/10 p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {railItems.map((item, index) => (
              <button key={item.id} data-tv-rail type="button"
                onClick={() => { setRailIdx(index); setRowIdx(Math.min(index, rows.length - 1)); setColIdx(0); setZone('rows'); }}
                className="mb-1.5 flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 py-3.5 text-sm font-bold text-zinc-400 transition focus:bg-red-600/20 focus:text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                <span className="text-2xl">{item.icon}</span>
                {item.name}
                <span className="rounded-full bg-white/10 px-2 text-[10px] text-zinc-300">{item.groups.length}</span>
              </button>
            ))}
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto px-8 py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {rows.map((row, rIndex) => (
              <section key={row.id} data-tv-row className="mb-8">
                <h3 className="mb-3 text-base font-black text-zinc-200">{row.icon} {row.name} <span className="ml-1 text-xs font-bold text-zinc-500">{row.groups.length}</span></h3>
                <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {row.groups.map((group) => (
                    <div key={group.logicalId} className="w-52 shrink-0">
                      <ChannelCard group={group} tv active={group.logicalId === activeId} onPick={(g) => { onTune(g); setZone('player'); handFocusToPlayer(); }} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </main>
        </div>

        <footer className="flex items-center gap-7 border-t border-white/10 px-10 py-4 text-sm font-bold text-zinc-400">
          <span>▲▼◀▶ Move</span><span>OK Play</span><span>CH ▲▼ Zap</span><span>Back Return</span>
          <span className="ml-auto text-red-400">Focus ring = remote selection</span>
        </footer>
      </div>
    </div>
  );
}
