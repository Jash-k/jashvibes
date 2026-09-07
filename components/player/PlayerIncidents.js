'use client';

/**
 * Player incident queue viewer.
 *
 * "Report a problem" in the player's menu writes a small record to
 * localStorage (key `jash:player-incidents`, last 50). That is deliberate:
 * a personal single-tenant app on a free tier should not grow another
 * collection for debug noise, and the record is most useful on the device that
 * hit the failure. The catch was that nothing ever read the queue — this card
 * closes that loop in the Live Service → Tools tab, so a report you file on a
 * phone can be pasted to yourself on the desktop later.
 */

import { useCallback, useEffect, useState } from 'react';
import { INCIDENT_QUEUE_KEY } from '@/lib/player/prefs';

export function readIncidents() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INCIDENT_QUEUE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hostOf(url = '') {
  try {
    return new URL(url, 'http://localhost').host;
  } catch {
    return url ? url.slice(0, 40) : '—';
  }
}

export default function PlayerIncidents() {
  const [items, setItems] = useState([]);
  const [note, setNote] = useState('');

  const refresh = useCallback(() => setItems(readIncidents()), []);
  useEffect(() => {
    refresh();
    const onStorage = (event) => {
      if (!event.key || event.key === INCIDENT_QUEUE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(items, null, 2));
      setNote('Copied JSON to the clipboard.');
    } catch {
      setNote('Clipboard blocked — open the list and copy by hand.');
    }
    window.setTimeout(() => setNote(''), 4000);
  }

  function clearAll() {
    try {
      window.localStorage.removeItem(INCIDENT_QUEUE_KEY);
    } catch {}
    setItems([]);
    setNote('Queue cleared.');
    window.setTimeout(() => setNote(''), 4000);
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">Player reports</p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">
            Logged by the Report button in any player&apos;s menu, on this browser only ({items.length} of 50 kept).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-200">
            Reload
          </button>
          <button type="button" onClick={copyAll} disabled={!items.length} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black text-zinc-200 disabled:opacity-40">
            Copy JSON
          </button>
          <button type="button" onClick={clearAll} disabled={!items.length} className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-black text-red-200 disabled:opacity-40">
            Clear
          </button>
        </div>
      </div>
      {note ? <p className="mt-2 text-[11px] font-bold text-emerald-300">{note}</p> : null}
      {items.length ? (
        <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {items.map((item, index) => (
            <li key={`${item?.at || 'x'}:${index}`} className="rounded-2xl border border-white/10 bg-black/40 px-3 py-2 text-[11px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-black text-white">{item?.title || 'Untitled'}</span>
                <span className="text-zinc-500">{item?.at ? new Date(item.at).toLocaleString() : '—'}</span>
                <span className="rounded-full bg-red-500/15 px-2 py-0.5 font-black uppercase tracking-wider text-red-200">
                  {item?.error?.code || item?.status || 'error'}
                </span>
                <span className="text-zinc-500">{item?.engine || '—'}</span>
              </div>
              <p className="mt-1 break-all text-zinc-400">{hostOf(item?.url)}{item?.error?.message ? ` · ${item.error.message}` : ''}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-2xl border border-white/10 p-4 text-center text-xs text-zinc-500">
          Nothing reported from this browser yet. Tap a failing stream&apos;s ⋮ menu → Report to file one.
        </p>
      )}
    </div>
  );
}
