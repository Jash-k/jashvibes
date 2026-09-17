import { memo, useEffect, useMemo, useRef, useState } from 'react';

/**
 * In-player channel drawer (the fullscreen Side Drawer): search + catalog chips + rows with
 * now-playing titles and progress hairlines. It renders inside the player root, so it survives
 * fullscreen; the page feeds precomputed items and owns tuning, the drawer only reports picks.
 *
 * Two rules from the chrome around it:
 *  • keys are handled with a NATIVE listener, because the player's own keydown listener sits on
 *    an ancestor — a React bubbling handler would run after the player already ate the key;
 *  • a keyboard pick closes the drawer (a TV viewer pressing Enter wants the video back), while
 *    a pointer pick leaves it open for zapping through the list.
 */

const PAGE = 100;

export const ChannelDrawer = memo(function ChannelDrawer({
  open = false,
  items = [],
  catalogs = [],
  category = 'all',
  onCategory,
  activeId = '',
  onPick,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const rootRef = useRef(null);

  useEffect(() => {
    setShown(PAGE);
  }, [query, category, items]);

  useEffect(() => {
    if (!open) return undefined;
    setShown(PAGE);
    setQuery('');
    // Focus the panel (not the search box) so arrows zap immediately on a TV remote.
    rootRef.current?.focus?.({ preventScroll: true });
    rootRef.current?.querySelector?.('[data-active="1"]')?.scrollIntoView?.({ block: 'nearest' });
    return undefined;
  }, [open ]);

  // The channel can change under an open drawer (wall pick, prev/next); follow it.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector?.('[data-active="1"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeId]);

  const filtered = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    return (items || []).filter((item) => {
      if (!item) return false;
      if (category !== 'all' && !(item.catalogs || []).includes(category)) return false;
      if (q && !`${item.name || ''} ${item.nowTitle || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, category, query]);
  const visible = filtered.slice(0, shown);

  useEffect(() => {
    if (!open) return undefined;
    const node = rootRef.current;
    if (!node) return undefined;
    const onKey = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const rows = Array.from(node.querySelectorAll('[data-ch]'));
        if (!rows.length) return;
        event.preventDefault();
        event.stopPropagation();
        const index = rows.indexOf(document.activeElement);
        const next = index < 0
          ? rows[event.key === 'ArrowDown' ? 0 : rows.length - 1]
          : rows[event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)];
        next?.focus?.({ preventScroll: true });
        next?.scrollIntoView?.({ block: 'nearest' });
      } else if (event.key === 'Enter') {
        const el = document.activeElement;
        const id = el?.getAttribute?.('data-id');
        // Only Enter ON a row tunes; Enter in the search box must not pick row one.
        if (!id) return;
        const item = (items || []).find((row) => String(row?.id) === id);
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        onPick?.(item, { via: 'keyboard' });
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose?.();
      }
      // PageUp/PageDown deliberately bubble: zapping prev/next while browsing is a feature.
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, items, onPick, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Channels"
      data-dvp="controls"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      className="absolute inset-y-0 right-0 z-30 flex w-72 max-w-[86%] flex-col border-l border-white/10 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur outline-none sm:w-80"
    >
      <div className="flex items-center gap-2 border-b border-white/10 p-3">
        <p className="min-w-0 flex-1 truncate text-xs font-black uppercase tracking-[0.18em] text-zinc-300">
          Channels · {filtered.length} <span className="text-zinc-600">· K5</span>
        </p>
        <button
          type="button"
          onClick={() => onClose?.()}
          aria-label="Close channels"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg font-black leading-none text-zinc-400 transition hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
      <div className="border-b border-white/10 p-3 pt-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels or shows"
          aria-label="Search channels"
          className="w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-500"
        />
        {catalogs?.length ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            <button
              key="all"
              type="button"
              onClick={() => onCategory?.('all')}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black transition ${category === 'all' ? 'border-red-500 bg-red-500/20 text-red-100' : 'border-white/10 text-zinc-400 hover:text-white'}`}
            >
              All
            </button>
            {catalogs.map((catalog) => (
              <button
                key={catalog.id}
                type="button"
                onClick={() => onCategory?.(catalog.id)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black transition ${category === catalog.id ? 'border-red-500 bg-red-500/20 text-red-100' : 'border-white/10 text-zinc-400 hover:text-white'}`}
              >
                {catalog.icon ? `${catalog.icon} ` : ''}{catalog.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="Channel list">
        {visible.map((item) => {
          const isActive = String(item.id) === String(activeId);
          const progress = Math.min(1, Math.max(0, Number(item.progress) || 0));
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={isActive}
              data-ch
              data-id={item.id}
              data-active={isActive ? '1' : undefined}
              onClick={() => onPick?.(item, { via: 'pointer' })}
              className={`flex w-full items-center gap-2.5 rounded-xl border p-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 ${
                isActive ? 'border-red-500/70 bg-red-500/10' : 'border-transparent hover:border-white/15 hover:bg-white/[0.05]'
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/5">
                {item.logo ? <img src={item.logo} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] font-black text-zinc-500">TV</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[13px] font-black ${isActive ? 'text-white' : 'text-zinc-100'}`}>{item.name || 'Channel'}</span>
                {item.nowTitle ? <span className="block truncate text-[11px] font-semibold text-zinc-400">{item.nowTitle}</span> : null}
                {progress > 0 ? (
                  <span className="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-white/10">
                    <span className="block h-full rounded-full bg-gradient-to-r from-red-600 to-red-400" style={{ width: `${Math.round(progress * 100)}%` }} />
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? <p className="p-4 text-center text-xs font-semibold text-zinc-500">No channels match.</p> : null}
        {filtered.length > shown ? (
          <button
            type="button"
            onClick={() => setShown((value) => value + PAGE)}
            className="mt-1 w-full rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-red-500/50 hover:text-white"
          >
            Show more · {filtered.length - shown} hidden
          </button>
        ) : null}
      </div>
    </div>
  );
});
