'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import JashPlayer from '@/components/player/JashPlayer';

export default function SportsPlayerPage() {
  const searchParams = useSearchParams();
  const [url, setUrl] = useState(searchParams.get('url') || '');
  const [title, setTitle] = useState(searchParams.get('title') || 'Sports Highlight');
  const [status, setStatus] = useState(searchParams.get('url') ? 'ready' : 'loading');
  const [error, setError] = useState('');
  const iccVideoId = searchParams.get('iccVideoId') || searchParams.get('videoId') || '';

  useEffect(() => {
    if (!iccVideoId || url) return;
    let cancelled = false;
    async function loadIcc() {
      try {
        setStatus('loading');
        const res = await fetch(`/api/icc/play?videoId=${encodeURIComponent(iccVideoId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || 'ICC video unavailable');
        if (!cancelled) {
          setUrl(data.manifestUrl || data.url || '');
          setTitle(searchParams.get('title') || data.title || 'ICC Highlight');
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Unable to load ICC video'); setStatus('error'); }
      }
    }
    loadIcc();
    return () => { cancelled = true; };
  }, [iccVideoId, url, searchParams]);

  return (
    <main className="h-dvh bg-black text-white">
      <div className="absolute left-3 top-3 z-50 flex items-center gap-2">
        <Link href="/sports" className="rounded-full border border-white/10 bg-black/70 px-4 py-2 text-xs font-bold text-zinc-200 backdrop-blur">← Sports</Link>
        <span className="hidden rounded-full border border-white/10 bg-black/70 px-4 py-2 text-xs font-bold text-zinc-400 sm:inline">{title}</span>
      </div>
      {status === 'loading' ? <div className="grid h-full place-items-center text-sm font-black uppercase tracking-widest text-amber-300">Loading sports player…</div> : null}
      {status === 'error' && !url ? <div className="grid h-full place-items-center p-6 text-center text-red-200">{error}</div> : null}
      {url ? (
        <div className="h-dvh w-full">
          <JashPlayer
            source={{ url }}
            display={{ title, aspect: 'fill' }}
            className="h-full w-full"
            on={{
              // The player keeps its own error card (with retry / next source);
              // the page only mirrors the message for the header.
              onError: (info) => setError(info?.message || 'Playback failed'),
            }}
          />
        </div>
      ) : null}
    </main>
  );
}
