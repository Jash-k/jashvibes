'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import VideoPlayer from '@/components/VideoPlayer';

function isDash(url = '') { return /\.mpd(\?|#|$)/i.test(String(url || '')); }

function DashPlayer({ src, title }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!src || !videoRef.current) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError('');
        if (playerRef.current) { try { await playerRef.current.destroy(); } catch {} playerRef.current = null; }
        const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
        const shaka = shakaModule.default || window.shaka || shakaModule;
        shaka.polyfill?.installAll?.();
        const player = new shaka.Player();
        playerRef.current = player;
        player.addEventListener('error', (event) => {
          if (!cancelled) setError(`DASH playback error${event.detail?.code ? ` ${event.detail.code}` : ''}`);
        });
        await player.attach(videoRef.current);
        await player.load(src);
        if (!cancelled) {
          setLoading(false);
          videoRef.current.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) { setLoading(false); setError(err.message || 'DASH playback failed'); }
      }
    }
    load();
    return () => { cancelled = true; if (playerRef.current) { try { playerRef.current.destroy(); } catch {} playerRef.current = null; } };
  }, [src]);

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} className="h-full w-full object-fill" controls playsInline autoPlay />
      {loading ? <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm font-black uppercase tracking-widest text-amber-300">Loading DASH…</div> : null}
      {error ? <div className="absolute inset-0 grid place-items-center bg-black/75 p-5 text-center text-red-200">{error}</div> : null}
    </div>
  );
}

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
      {status === 'error' ? <div className="grid h-full place-items-center p-6 text-center text-red-200">{error}</div> : null}
      {status === 'ready' && url ? (
        isDash(url) ? <DashPlayer src={url} title={title} /> : <VideoPlayer src={url} title={title} inline={false} onBackClick={() => history.back()} />
      ) : null}
    </main>
  );
}
