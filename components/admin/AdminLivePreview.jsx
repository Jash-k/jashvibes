'use client';
/**
 * AdminLivePreview — Admin → TV → Channels → Preview.
 *
 * Opens the REAL live player (LivePlayerV13 → /api/live/resolve → live policy,
 * ClearKey/Widevine and the source fallback ladder) against one stored channel
 * row, inside a modal. The owner verifies the stream, then keeps it in the
 * Main catalog or hides it without leaving the dialog. Same code path as
 * /live, so a green preview means the public page plays it too.
 */
import { useEffect, useMemo, useState } from 'react';
import LivePlayerV13 from '@/components/live/v13/LivePlayerV13';
import { channelDocToLogicalGroup } from '@/lib/live/preview';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';

export default function AdminLivePreview({ channel, onClose, onChanged }) {
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const logical = useMemo(() => (channel ? channelDocToLogicalGroup(channel) : null), [channel]);
  const inMain = useMemo(() => (channel?.catalogs || []).some((item) => (typeof item === 'string' ? item : item?.catalogId) === 'main'), [channel]);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!channel || !logical) return null;

  const api = async (action, extra = {}) => {
    setBusy(action);
    setMsg('');
    try {
      const res = await fetch('/api/live-service/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.channelId, action, ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setMsg(action === 'hide' ? 'Hidden from /live.' : 'Added to Main — it now appears on the live page.');
      onChanged?.();
    } catch (error) {
      setMsg(error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#101016] shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black">Preview — {channel.customName || channel.name}</h3>
            <p className="truncate text-[11px] text-zinc-400">{channel.source} · {String(channel.format || 'unknown').toUpperCase()} · same player as /live</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-zinc-300 hover:border-red-500/60" aria-label="Close preview">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <LivePlayerV13 logical={logical} variantIdx={0} />
          <div className="mt-3 flex flex-wrap gap-1.5">
            {LIVE_CATALOGS.map((item) => {
              const active = (channel.catalogs || []).some((c) => (typeof c === 'string' ? c : c?.catalogId) === item.id);
              return (
                <span key={item.id} className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${active ? 'border-red-500 bg-red-600/20 text-red-100' : 'border-white/10 bg-black/40 text-zinc-500'}`}>
                  {item.icon} {item.name}
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
          <button type="button" onClick={() => api('setCatalog', { catalogId: 'main', enabled: true })} disabled={busy !== null || inMain}
            className="rounded-full bg-red-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">
            {inMain ? '✓ In Main catalog' : 'Keep in Main'}
          </button>
          <button type="button" onClick={() => api('hide')} disabled={busy !== null || channel.hidden}
            className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold text-zinc-200 disabled:opacity-40">
            {channel.hidden ? '✓ Hidden' : 'Hide from /live'}
          </button>
          {msg ? <span className="text-[11.5px] font-bold text-amber-200">{msg}</span> : null}
          <button type="button" onClick={onClose} className="ml-auto rounded-full border border-white/10 px-4 py-2 text-xs">Close</button>
        </div>
      </div>
    </div>
  );
}
