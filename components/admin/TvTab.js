'use client';
import { useState } from 'react';
import LiveChannelManager from './LiveChannelManager';
import LiveSourceManager from './LiveSourceManager';

/**
 * TvTab — Admin → TV (v13).
 * Two surfaces only: Sources & Sync (full feed CRUD) and Channels · Catalogs ·
 * Reorder (full channel CRUD). The old read-only duplicate preview grid was
 * removed: the channel manager is now the single place channels are managed.
 */
export default function TvTab() {
  const [view, setView] = useState('sources');
  const [jioStatus, setJioStatus] = useState('');

  const checkJio = async () => {
    try {
      setJioStatus('Checking Jio token…');
      const res = await fetch('/api/live-jio?force=1', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.available) throw new Error(data.error || 'No token');
      setJioStatus(`Jio token OK — expires ${data.expiresAtMs ? new Date(data.expiresAtMs).toLocaleString() : 'unknown'}`);
    } catch (error) {
      setJioStatus(`Jio token check failed: ${error.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setView('sources')} className={`rounded-full px-4 py-1.5 text-xs font-black ${view === 'sources' ? 'bg-red-600 text-white' : 'border border-white/10'}`}>
          📡 Sources &amp; Sync
        </button>
        <button type="button" onClick={() => setView('channels')} className={`rounded-full px-4 py-1.5 text-xs font-black ${view === 'channels' ? 'bg-red-600 text-white' : 'border border-white/10'}`}>
          📺 Channels · Catalogs · Reorder
        </button>
      </div>

      {view === 'sources' ? (
        <>
          <LiveSourceManager />
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950 p-3">
            <b className="text-sm">Jio token</b>
            <button type="button" onClick={checkJio} className="rounded-full border border-white/10 px-3 py-1.5 text-xs">Check Jio token</button>
            {jioStatus ? <span className="text-xs text-zinc-400">{jioStatus}</span> : null}
            <span className="text-xs text-zinc-500">Automatic via server JIO_COOKIE; HJH channels self-tokenize through the worker redirect.</span>
          </div>
        </>
      ) : (
        <LiveChannelManager />
      )}
    </div>
  );
}
