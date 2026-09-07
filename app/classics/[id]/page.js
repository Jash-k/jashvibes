'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import JashPlayer from '@/components/player/JashPlayer';
import { createStreamPolicy } from '@/lib/player/policy/stream';

export default function ClassicPlayerPage() {
  const params = useParams();
  const id = params?.id;
  const shellRef = useRef(null);

  const [item, setItem] = useState(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const streams = useMemo(() => item?.streams || [], [item]);
  const activeStream = streams[streamIndex] || streams[0] || null;
  const watchKey = `retro:${id}`;

  useEffect(() => {
    async function loadItem() {
      try {
        setStatus('loading');
        const response = await fetch(`/api/vod/${id}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Unable to load ReTro title');
        const loadedStreams = data.item?.streams || [];
        const ahaIndex = loadedStreams.findIndex((stream) => String(stream.source || '').toLowerCase().includes('aha'));
        setItem(data.item);
        setStreamIndex(ahaIndex >= 0 ? ahaIndex : 0);
        setStatus('ready');
      } catch (err) {
        setError(err.message || 'Unable to load ReTro title');
        setStatus('error');
      }
    }
    if (id) loadItem();
  }, [id]);

  // ClearKeys, Widevine, per-stream headers and the MPD default_KID expansion
  // all live in the policy now — the page just says which stream to play.
  const playbackPolicy = useMemo(
    () => (activeStream?.url ? createStreamPolicy(activeStream) : null),
    [activeStream],
  );

  const sourcesForPlayer = useMemo(
    () => streams.map((stream, index) => ({
      url: stream.url,
      label: stream.label || stream.source || `Stream ${index + 1}`,
      format: stream.format || 'HLS',
    })),
    [streams],
  );

  const libraryEntry = useMemo(() => {
    if (typeof window === 'undefined' || !item) return null;
    return {
      key: watchKey,
      type: 'movie',
      title: item.title || 'ReTro Movie',
      posterUrl: item.posterUrl || '',
      backdropUrl: item.backdropUrl || '',
      year: item.year || '',
      provider: 'retro',
      href: `${window.location.pathname}${window.location.search}`,
    };
  }, [item, watchKey]);

  return (
    <main className="palette-nordic min-h-dvh bg-[#06110d] text-zinc-100">
      <header className="hidden sm:block border-b border-white/10 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/classics" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-amber-400 hover:text-white">← ReTro</Link>
          <span className="hidden text-xs font-black uppercase tracking-[0.25em] text-amber-400 sm:inline">Tamil ReTro Cinema</span>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">Loading ReTro classic...</div> : null}
        {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-8 text-red-200">{error}</div> : null}

        {status === 'ready' && item ? (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
            <div className="space-y-4">
              <div ref={shellRef} className="classics-player-shell relative overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl shadow-black fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:rounded-none fullscreen:border-0">
                {/* Ambient theater glow */}
                <div className="pointer-events-none absolute -inset-4 z-0 opacity-30 blur-3xl bg-gradient-to-tr from-amber-500/20 via-emerald-600/20 to-cyan-600/20" />

                <div className="relative z-10 aspect-video h-full w-full bg-black fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:aspect-auto">
                  <JashPlayer
                    playbackPolicy={playbackPolicy}
                    source={{ url: activeStream?.url || '', label: activeStream?.label || activeStream?.source || '' }}
                    display={{
                      title: item.title || 'ReTro Movie',
                      subtitle: activeStream?.source ? `Source: ${activeStream.source}` : '',
                      poster: item.backdropUrl || item.posterUrl || '',
                      aspect: 'fill',
                    }}
                    library={{ watchKey, entry: libraryEntry }}
                    lineup={{
                      sources: sourcesForPlayer,
                      activeIndex: streamIndex,
                      onPickSource: (index) => setStreamIndex(index),
                    }}
                    on={{
                      onError: (info) => setError(info?.message || 'Playback error'),
                    }}
                    className="h-full w-full"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h1 className="text-2xl font-black text-white sm:text-3xl">{item.title}</h1>
                    <p className="mt-1 text-xs font-semibold text-zinc-400 sm:text-sm">
                      {item.year || ''} {item.rating ? `• TMDB ★ ${item.rating.toFixed(1)}` : ''} {item.voteCount ? `• ${item.voteCount} votes` : ''}
                    </p>
                  </div>
                  {activeStream?.url ? (
                    <a
                      href={activeStream.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-bold text-zinc-300 transition hover:border-amber-400 hover:text-white"
                    >
                      Stream URL ↗
                    </a>
                  ) : null}
                </div>
                {item.synopsis ? <p className="mt-3 text-sm leading-6 text-zinc-400">{item.synopsis}</p> : null}
              </div>
            </div>

            <aside className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5">
              {item.posterUrl ? (
                <img src={item.posterUrl} alt="" className="mx-auto max-h-[28rem] rounded-2xl object-cover shadow-2xl shadow-black" />
              ) : null}
              <div className="mt-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-400">Sources & Genres</p>
                <div className="flex flex-wrap gap-2">
                  {(item.sources || []).map((source) => (
                    <span key={source} className="rounded-full bg-amber-500/10 border border-amber-400/20 px-3 py-1 text-xs font-bold text-amber-200">{source}</span>
                  ))}
                  {(item.genres || []).map((genre) => (
                    <span key={genre} className="rounded-full bg-white/[0.06] border border-white/10 px-3 py-1 text-xs font-bold text-zinc-300">{genre}</span>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
