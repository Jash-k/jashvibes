'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

async function readJsonResponse(response, fallbackMessage = 'Request failed') {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text().catch(() => '');
    const isHtml = /^\s*</.test(text) || contentType.includes('text/html');
    throw new Error(isHtml
      ? 'Stremio API route returned an HTML page instead of JSON. Deploy the latest Stremio API files and set STREMIO env.'
      : `${fallbackMessage}: server returned ${contentType || 'non-JSON response'}`);
  }
  return response.json();
}
function isHls(url = '') {
  return String(url).toLowerCase().includes('.m3u8');
}

function isDash(url = '') {
  return String(url).toLowerCase().includes('.mpd');
}

function preferredSmoothStreamIndex(streams = []) {
  if (!streams.length) return 0;
  const ranked = streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => {
      const aText = `${a.stream.name || ''} ${a.stream.title || ''} ${a.stream.label || ''}`.toLowerCase();
      const bText = `${b.stream.name || ''} ${b.stream.title || ''} ${b.stream.label || ''}`.toLowerCase();
      const a480 = /480p|360p/.test(aText) ? 1 : 0;
      const b480 = /480p|360p/.test(bText) ? 1 : 0;
      if (a480 !== b480) return b480 - a480;
      return Number(a.stream.sizeBytes || 0) - Number(b.stream.sizeBytes || 0);
    });
  return ranked[0]?.index || 0;
}

function SymbolButton({ children, onClick, disabled = false, title = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title || String(children)}
      className="grid h-11 min-w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] px-2 text-xs font-black text-white transition hover:border-fuchsia-300/50 hover:bg-fuchsia-500/10 disabled:cursor-not-allowed disabled:opacity-40 sm:h-12 sm:min-w-12 sm:text-sm"
    >
      {children}
    </button>
  );
}

export default function StremioPlayerPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const type = params?.type === 'series' ? 'series' : 'movie';
  const id = decodeURIComponent(String(params?.id || ''));
  const stremioSource = searchParams?.get('source') || '';
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const playerRef = useRef(null);
  const [item, setItem] = useState(null);
  const [metaStatus, setMetaStatus] = useState('loading');
  const [streamStatus, setStreamStatus] = useState('idle');
  const [error, setError] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState(id);
  const [streams, setStreams] = useState([]);
  const [streamIndex, setStreamIndex] = useState(0);
  const [audioTracks, setAudioTracks] = useState([]);
  const [audioTrackIndex, setAudioTrackIndex] = useState(0);

  const activeStream = streams[streamIndex] || null;

  function seekBy(seconds) {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(max, (video.currentTime || 0) + seconds));
  }

  function refreshAudioTracks() {
    const tracks = videoRef.current?.audioTracks;
    if (!tracks?.length) {
      setAudioTracks([]);
      setAudioTrackIndex(0);
      return;
    }
    const list = Array.from({ length: tracks.length }, (_, index) => ({
      index,
      label: tracks[index].label || tracks[index].language || `A${index + 1}`,
      language: tracks[index].language || '',
      enabled: Boolean(tracks[index].enabled),
    }));
    const enabledIndex = list.find((item) => item.enabled)?.index ?? 0;
    setAudioTracks(list);
    setAudioTrackIndex(enabledIndex);
  }

  function cycleAudioTrack() {
    const tracks = videoRef.current?.audioTracks;
    if (!tracks?.length) return;
    const next = (audioTrackIndex + 1) % tracks.length;
    for (let index = 0; index < tracks.length; index += 1) tracks[index].enabled = index === next;
    setAudioTrackIndex(next);
    refreshAudioTracks();
  }

  useEffect(() => {
    async function loadMeta() {
      try {
        setMetaStatus('loading');
        setError('');
        const metaParams = new URLSearchParams({ type, id });
        if (stremioSource) metaParams.set('source', stremioSource);
        const response = await fetch(`/api/stremio/meta?${metaParams.toString()}`, { cache: 'no-store' });
        const data = await readJsonResponse(response, 'Stremio request failed');
        if (!response.ok) throw new Error(data?.error || 'Stremio meta failed');
        setItem(data.item);
        if (type === 'series' && data.item?.videos?.length && !String(id).includes(':')) {
          const wantedSeason = Number(searchParams?.get('season') || 1);
          const wantedEpisode = Number(searchParams?.get('episode') || 1);
          const wanted = data.item.videos.find((video) => Number(video.season) === wantedSeason && Number(video.episode) === wantedEpisode);
          setSelectedVideoId(wanted?.id || data.item.videos[0].id);
        }
        setMetaStatus('ready');
      } catch (err) {
        setMetaStatus('error');
        setError(err.message || 'Unable to load Stremio item');
      }
    }
    loadMeta();
  }, [type, id, searchParams, stremioSource]);

  useEffect(() => {
    if (!selectedVideoId) return;
    async function loadStreams() {
      try {
        setStreamStatus('loading');
        setError('');
        setStreams([]);
        setStreamIndex(0);
        const streamParams = new URLSearchParams({ type, id: selectedVideoId });
        if (stremioSource) streamParams.set('source', stremioSource);
        const response = await fetch(`/api/stremio/stream?${streamParams.toString()}`, { cache: 'no-store' });
        const data = await readJsonResponse(response, 'Stremio request failed');
        if (!response.ok) throw new Error(data?.error || 'Stremio stream failed');
        const nextStreams = data.streams || [];
        setStreams(nextStreams);
        if (!nextStreams.length) throw new Error(data.blockedCount ? 'Streams were returned but blocked by safety filters / allowed hosts.' : 'No streams found for this title.');
        // Default to the smallest/480p stream for smoother playback on mobile and Render/HF-hosted direct files.
        // Users can still switch to 720p/1080p from the selector.
        setStreamIndex(preferredSmoothStreamIndex(nextStreams));
        setStreamStatus('ready');
      } catch (err) {
        setStreamStatus('error');
        setError(err.message || 'Unable to load Stremio streams');
      }
    }
    loadStreams();
  }, [type, selectedVideoId, stremioSource]);

  useEffect(() => {
    const video = videoRef.current;
    const url = activeStream?.url;
    if (!video || !url) return;
    let cancelled = false;

    async function destroyPlayer() {
      if (playerRef.current) {
        try { await playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    }

    async function load() {
      try {
        await destroyPlayer();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();
        setAudioTracks([]);
        setAudioTrackIndex(0);

        if (isHls(url) || isDash(url)) {
          const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
          const shaka = shakaModule.default || window.shaka || shakaModule;
          shaka.polyfill?.installAll?.();
          const player = new shaka.Player();
          playerRef.current = player;
          await player.attach(video);
          await player.load(url);
          if (!cancelled) { refreshAudioTracks(); window.setTimeout(refreshAudioTracks, 900); video.play().catch(() => {}); }
        } else {
          video.src = url;
          video.load();
          refreshAudioTracks();
          window.setTimeout(refreshAudioTracks, 900);
          video.play().catch(() => {});
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Playback failed. Try Open Directly or another stream quality.');
      }
    }

    load();
    return () => { cancelled = true; destroyPlayer(); };
  }, [activeStream?.url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onLoaded = () => refreshAudioTracks();
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('loadeddata', onLoaded);
    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('loadeddata', onLoaded);
    };
  }, [activeStream?.url]);

  async function fullscreen() {
    const element = shellRef.current;
    try {
      if (element?.requestFullscreen) await element.requestFullscreen();
      else if (element?.webkitRequestFullscreen) element.webkitRequestFullscreen();
    } catch {}
  }

  const selectedEpisode = useMemo(() => {
    return item?.videos?.find((video) => video.id === selectedVideoId) || null;
  }, [item, selectedVideoId]);

  return (
    <main className="min-h-dvh bg-[#050012] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-fuchsia-400/10 bg-[#080008]/90 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <a href="/stremio?home=1" onClick={(event) => { event.preventDefault(); window.location.assign('/stremio?home=1'); }} aria-label="Stremio home" title="Stremio home" className="rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-3 py-2 text-xs font-black text-fuchsia-100 transition hover:border-fuchsia-400/60">📡 Stremio</a>
            <a href="/" onClick={(event) => { event.preventDefault(); window.location.assign('/'); }} aria-label="JaSH ViBeS home" title="JaSH ViBeS home" className="rounded-full border border-white/10 px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white">⌂ JaSH</a>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.30em] text-fuchsia-300">Player</p>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1.45fr_0.75fr] lg:px-8">
        <div className="space-y-4">
          <div ref={shellRef} className="classics-player-shell overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl shadow-black fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:rounded-none fullscreen:border-0">
            <div className="relative aspect-video h-full w-full bg-black fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:aspect-auto">
              <video ref={videoRef} className="h-full w-full max-h-[100dvh] max-w-[100dvw] bg-black object-contain" controls playsInline preload="metadata" poster={selectedEpisode?.thumbnail || item?.backdropUrl || item?.posterUrl || undefined} />
              {streamStatus === 'loading' ? <div className="absolute inset-0 grid place-items-center bg-black/50"><span className="rounded-full bg-black/80 px-5 py-3 text-sm font-bold">Loading Stremio stream...</span></div> : null}
              {streamStatus === 'error' ? <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-red-500/30 bg-red-950/80 p-3 text-sm text-red-100">{error}</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-fuchsia-400/15 bg-zinc-950/85 p-3 shadow-xl shadow-black/25">
            <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <SymbolButton onClick={() => seekBy(-60)} title="Back 1 minute">↶1m</SymbolButton>
              <SymbolButton onClick={() => seekBy(-30)} title="Back 30 seconds">↶30</SymbolButton>
              <SymbolButton onClick={() => seekBy(-10)} title="Back 10 seconds">↶10</SymbolButton>
              <SymbolButton onClick={cycleAudioTrack} disabled={!audioTracks.length} title={audioTracks.length ? `Audio ${audioTracks[audioTrackIndex]?.label || audioTrackIndex + 1}` : 'No alternate audio tracks detected'}>🔊</SymbolButton>
              <SymbolButton onClick={() => seekBy(10)} title="Forward 10 seconds">10↷</SymbolButton>
              <SymbolButton onClick={() => seekBy(30)} title="Forward 30 seconds">30↷</SymbolButton>
              <SymbolButton onClick={() => seekBy(60)} title="Forward 1 minute">1m↷</SymbolButton>
              <SymbolButton onClick={fullscreen} title="Fullscreen">⛶</SymbolButton>
              {activeStream?.url ? <a href={activeStream.url} target="_blank" rel="noreferrer" title="Open directly" aria-label="Open directly" className="grid h-11 min-w-11 place-items-center rounded-2xl bg-fuchsia-500 px-2 text-xs font-black text-black transition hover:bg-fuchsia-300 sm:h-12 sm:min-w-12 sm:text-sm">↗</a> : null}
            </div>
            {audioTracks.length ? <p className="mt-2 truncate px-1 text-[11px] font-semibold text-zinc-500">🔊 {audioTracks[audioTrackIndex]?.label || `A${audioTrackIndex + 1}`}</p> : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
            <h1 className="text-2xl font-black text-white">{item?.title || 'Stremio'}</h1>
            {selectedEpisode ? <p className="mt-1 text-sm text-fuchsia-200">S{selectedEpisode.season} E{selectedEpisode.episode} • {selectedEpisode.title}</p> : null}
            <p className="mt-2 text-sm leading-6 text-zinc-400">{selectedEpisode?.synopsis || item?.synopsis || ''}</p>
            <p className="mt-2 rounded-2xl border border-fuchsia-300/15 bg-fuchsia-500/10 px-3 py-2 text-xs leading-5 text-fuchsia-100">Smooth mode starts with the smallest/480p stream to reduce buffering. Switch quality manually if your network is fast.</p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {type === 'series' && item?.videos?.length ? (
                  <select value={selectedVideoId} onChange={(event) => setSelectedVideoId(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-fuchsia-400">
                    {item.videos.map((video) => <option key={video.id} value={video.id}>S{video.season} E{video.episode} - {video.title}</option>)}
                  </select>
                ) : null}
                <select value={streamIndex} onChange={(event) => setStreamIndex(Number(event.target.value) || 0)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-fuchsia-400">
                  {streams.map((stream, index) => <option key={`${stream.url}-${index}`} value={index}>{stream.label}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
          {item?.posterUrl ? <img src={item.posterUrl} alt="" className="mx-auto max-h-[28rem] rounded-2xl object-cover" /> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {item?.rating ? <span className="rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-bold text-yellow-100">IMDb {item.rating}</span> : null}
            {(item?.genres || []).map((genre) => <span key={genre} className="rounded-full bg-fuchsia-500/10 px-3 py-1 text-xs font-bold text-fuchsia-100">{genre}</span>)}
            {streams.length ? <span className="rounded-full bg-green-500/10 px-3 py-1 text-xs font-bold text-green-100">{streams.length} streams</span> : null}
          </div>
          {metaStatus === 'loading' ? <p className="mt-4 text-sm text-zinc-500">Loading metadata...</p> : null}
          {metaStatus === 'error' ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
          <p className="mt-5 text-xs leading-5 text-zinc-500">Streams are loaded from your configured authorized Stremio addon. If a MKV does not play in this browser/WebView, use Open Directly or try another quality.</p>
        </aside>
      </section>
    </main>
  );
}
