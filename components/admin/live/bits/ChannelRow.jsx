'use client';
/**
 * Presentational bits for Admin → TV → Channels. Split out of
 * LiveChannelManager so the container owns data/writes while these own
 * rendering only; every input arrives via props.
 */
import { memo, useState } from 'react';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import { SOURCE_REGISTRY } from '@/lib/live/registry';

export const EMPTY_SET = new Set();

export const isLiveCatalog = (value) => LIVE_CATALOGS.some((item) => item.id === value);

function Logo({ channel }) {
  const src = channel.customLogo || channel.logo;
  return (
    <div className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-black">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
      ) : <span className="text-xs">📺</span>}
    </div>
  );
}

function LadderEditor({ channel, knownSourceIds, onSave, onCancel }) {
  const [ladder, setLadder] = useState(Array.isArray(channel.ladderOrder) ? channel.ladderOrder : []);
  const move = (index, dir) => {
    const next = [...ladder];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setLadder(next);
  };
  const addSource = (sourceId) => {
    if (!sourceId || ladder.includes(sourceId)) return;
    setLadder([...ladder, sourceId]);
  };
  const labelOf = (id) => SOURCE_REGISTRY[id]?.label || (id === 'manual' ? 'Manual' : id);
  const available = (knownSourceIds || []).filter((id) => !ladder.includes(id));

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950 p-3">
      <p className="mb-1.5 text-[11px] font-black text-zinc-300">Source ladder for “{channel.name}” — listed sources play first in this order; the rest keep their default priority</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {ladder.map((id, index) => (
          <span key={id} className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-bold">
            {index + 1}. {labelOf(id)}
            <button type="button" onClick={() => move(index, -1)} className="text-zinc-400">↑</button>
            <button type="button" onClick={() => move(index, 1)} className="text-zinc-400">↓</button>
            <button type="button" onClick={() => setLadder(ladder.filter((x) => x !== id))} className="text-red-300">✕</button>
          </span>
        ))}
        {!ladder.length ? <span className="text-[11px] text-zinc-500">Default order (source priority) — add sources to pin this channel&apos;s ladder</span> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value="" onChange={(e) => addSource(e.target.value)} className="rounded-full border border-white/10 bg-black px-3 py-1 text-[11px]">
          <option value="">Add source…</option>
          {available.map((id) => <option key={id} value={id}>{labelOf(id)}</option>)}
        </select>
        <button type="button" onClick={() => onSave(ladder)} className="rounded-full bg-red-600 px-3 py-1 text-[11px] font-black text-white">Save ladder</button>
        <button type="button" onClick={onCancel} className="rounded-full border border-white/10 px-3 py-1 text-[11px]">Cancel</button>
      </div>
    </div>
  );
}

/**
 * One catalogue row. memo'd: parent state changes (search text, selection of
 * another row) never re-render rows whose props are unchanged.
 */
const ChannelRow = memo(function ChannelRow({
  channel, checked, reorderEnabled, busy, ladderOpen, previewOpen,
  catalogIdSet, knownSourceIds, onToggleSelect, onDragStart, onDragOver, onDrop,
  onMove, onPreview, onLadder, onEdit, onHideToggle, onDelete, onToggleCatalog,
  onSaveLadder, onCancelLadder,
}) {
  return (
    <div draggable={reorderEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`rounded-2xl border p-2.5 ${checked ? 'border-red-500/60 bg-red-950/15' : 'border-white/10 bg-zinc-900/70'}`}>
      <div className="flex items-center gap-2.5">
        <input type="checkbox" checked={checked} onChange={onToggleSelect} className="h-4 w-4 shrink-0 accent-red-600" aria-label="Select channel" />
        {reorderEnabled ? <span title="Drag to reorder" className="cursor-grab select-none text-zinc-500">⠿</span> : null}
        <Logo channel={channel} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">
            {channel.customName || channel.name}
            {channel.hidden ? <span className="ml-2 rounded-full bg-zinc-700 px-2 py-0.5 text-[9px]">hidden</span> : null}
            {channel.religious ? <span className="ml-2 rounded-full border border-amber-400/40 px-2 py-0.5 text-[9px] font-black text-amber-300">religious · hidden from /live</span> : null}
          </p>
          <p className="truncate text-[11px] text-zinc-400">{channel.source} · {String(channel.format || 'unknown').toUpperCase()} · {channel.category}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {reorderEnabled ? (
            <>
              <button type="button" onClick={() => onMove(-1)} title="Move up" className="rounded-full border border-white/10 px-2 py-1 text-xs">↑</button>
              <button type="button" onClick={() => onMove(1)} title="Move down" className="rounded-full border border-white/10 px-2 py-1 text-xs">↓</button>
            </>
          ) : null}
          <button type="button" onClick={onPreview} title="Preview with the real /live player" className="rounded-full border border-red-500/40 px-2.5 py-1 text-xs font-bold text-red-200" aria-current={previewOpen}>▶ Preview</button>
          <button type="button" onClick={onLadder} title="Source ladder" className="rounded-full border border-white/10 px-2 py-1 text-xs" aria-current={ladderOpen}>🪜</button>
          <button type="button" onClick={onEdit} className="rounded-full border border-white/10 px-2 py-1 text-xs">Edit</button>
          <button type="button" onClick={onHideToggle} disabled={busy} className="rounded-full border border-white/10 px-2 py-1 text-xs disabled:opacity-40">{channel.hidden ? 'Unhide' : 'Hide'}</button>
          <button type="button" onClick={onDelete} className="rounded-full border border-red-500/40 px-2 py-1 text-xs text-red-200">Delete</button>
        </div>
      </div>

      {ladderOpen ? (
        <LadderEditor channel={channel} knownSourceIds={knownSourceIds} onSave={onSaveLadder} onCancel={onCancelLadder} />
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {LIVE_CATALOGS.map((item) => {
          const active = catalogIdSet.has(item.id);
          return (
            <button key={item.id} type="button" onClick={() => onToggleCatalog(item.id)} disabled={busy}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${active ? 'border-red-500 bg-red-600/20 text-red-100' : 'border-white/10 bg-black/40 text-zinc-400'}`}>
              {item.icon} {item.name}
            </button>
          );
        })}
      </div>
    </div>
  );
});

export default ChannelRow;
