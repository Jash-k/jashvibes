'use client';
/**
 * AdminLivePreview — Admin → TV → Channels → Preview workspace.
 *
 * A full mapping workstation built on the REAL live player
 * (LivePlayer → /api/live/resolve → live policy, ClearKey/Widevine and
 * the source fallback ladder). The owner verifies a stream, maps it to
 * catalogs, hides it or favourites it, then zaps to the NEXT channel of the
 * current filtered list WITHOUT closing the modal — no open/close cycle per
 * channel. Navigation wraps and is also reachable via ←/→ keys and the
 * player's own ⏮/⏭ buttons (PageUp/PageDown).
 */
import { useEffect, useMemo, useState } from 'react';
import LivePlayer from '@/components/live/Player';
import { channelDocToLogicalGroup } from '@/lib/live/preview';
import { LIVE_CATALOGS, getChannelCatalogIds } from '@/lib/liveCatalogs';

export default function AdminLivePreview({ channels = [], channel, onNavigate, onClose, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');

  const logical = useMemo(() => (channel ? channelDocToLogicalGroup(channel) : null), [channel]);
  const memberships = useMemo(() => new Set(channel ? getChannelCatalogIds(channel) : []), [channel]);
  const position = useMemo(() => channels.findIndex((row) => row.channelId === channel?.channelId), [channels, channel]);

  const go = (direction) => {
    if (!channels.length) return;
    let nextIndex;
    if (position < 0) nextIndex = direction > 0 ? 0 : channels.length - 1;
    else nextIndex = (position + direction + channels.length) % channels.length; // wrap-around
    const next = channels[nextIndex];
    if (next) {
      setMsg('');
      onNavigate?.(next);
    }
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, position, channel]);

  if (!channel || !logical) return null;

  const api = async (action, extra = {}) => {
    setBusy(action);
    setMsg('');
    try {
      const res = await fetch('/api/live/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.channelId, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg('Saved.');
      onChanged?.();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  const inMain = memberships.has('main');

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#101016] shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <button type="button" onClick={() => go(-1)} title="Previous channel (←)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-200 hover:border-red-500/60">⏮</button>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black">Preview — {channel.customName || channel.name}</h3>
            <p className="truncate text-[11px] text-zinc-400">
              {channel.source} · {position >= 0 ? `${position + 1} / ${channels.length}` : 'outside current filter'} · same player as /live
            </p>
          </div>
          <button type="button" onClick={() => go(1)} title="Next channel (→)"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-200 hover:border-red-500/60">⏭</button>
          <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-300 hover:border-red-500/60" aria-label="Close preview">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {/* key remounts the engine per channel, exactly like /live zapping */}
          <LivePlayer
            key={channel.channelId}
            logical={logical}
            variantIdx={0}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
          />
        </div>

        <div className="shrink-0 space-y-2.5 border-t border-white/10 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {LIVE_CATALOGS.map((item) => {
              const active = memberships.has(item.id);
              return (
                <button key={item.id} type="button" disabled={busy !== null}
                  onClick={() => api('setCatalog', { catalogId: item.id, enabled: !active })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40 ${active ? 'border-red-500 bg-red-600/20 text-red-100' : 'border-white/10 bg-black/40 text-zinc-400 hover:border-white/30'}`}>
                  {active ? '✓ ' : ''}{item.icon} {item.name}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => api('setCatalog', { catalogId: 'main', enabled: !inMain })} disabled={busy !== null}
              className="rounded-full bg-red-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">
              {inMain ? '✓ In Main catalog' : 'Keep in Main'}
            </button>
            <button type="button" onClick={() => api(channel.hidden ? 'unhide' : 'hide')} disabled={busy !== null}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-zinc-200 disabled:opacity-40">
              {channel.hidden ? '👁 Unhide' : '🚫 Hide from /live'}
            </button>
            <button type="button" onClick={() => api(channel.favorite ? 'unfavorite' : 'favorite')} disabled={busy !== null}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-zinc-200 disabled:opacity-40">
              {channel.favorite ? '★ Favourited' : '☆ Favourite'}
            </button>
            <button type="button" onClick={() => api(channel.heroBanner ? 'unhero' : 'hero')} disabled={busy !== null}
              className="rounded-full border border-red-500/50 px-4 py-2 text-xs font-bold text-red-100 disabled:opacity-40">
              {channel.heroBanner ? '↩ Restore movie hero' : '🏠 Replace home hero'}
            </button>
            {msg ? <span className="text-[11.5px] font-bold text-amber-200">{msg}</span> : null}
            <span className="ml-auto hidden text-[10.5px] text-zinc-500 sm:block">← / → zaps channels · Esc closes</span>
          </div>
        </div>
      </div>
    </div>
  );
}
