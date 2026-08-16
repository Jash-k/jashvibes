'use client';

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import VideoPlayer from '@/components/VideoPlayer';
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
function isDash(url = '') {
  return String(url).toLowerCase().includes('.mpd');
}

// Telegram-based addons stream MP4 as sequential chunks with no Range
// support, which makes the browser video element unseekable. Routing those
// streams through our Range-emulating relay makes seeking work; sources that
// already honour Range pass straight through, so this is always safe.
function proxiedStreamUrl(url = '') {
  const value = String(url || '');
  if (!/^https?:\/\//i.test(value) || isDash(value)) return value;
  return `/api/stream-proxy?u=${encodeURIComponent(value)}`;
}

function compactQualityLabel(stream = {}, index = 0) {
  const text = `${stream.label || ''} ${stream.title || ''} ${stream.name || ''} ${stream.size || ''}`;
  const resolution = text.match(/\b(2160p|1440p|1080p|720p|576p|540p|480p|360p|240p|4k)\b/i)?.[1]?.replace(/^4k$/i, '4K') || '';
  const size = String(stream.size || text.match(/([\d.]+)\s*(TB|GB|MB|KB)\b/i)?.[0] || '').replace(/\s+/g, '').toUpperCase();
  return [resolution, size].filter(Boolean).join(' ') || `Stream ${index + 1}`;
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
  const stremioSource = searchParams?.get('source') || 'catalog';
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const playerRef = useRef(null);
  const [item, setItem] = useState(null);
  const [metaStatus, setMetaStatus] = useState('loading');
  const [streamStatus, setStreamStatus] = useState('idle');
  const [error, setError] = useState('');
  const idEpisodeMatch = String(id || '').match(/^tt\d+:(\d+):(\d+)$/i);
  const [selectedSeason, setSelectedSeason] = useState(Number(searchParams?.get('season') || idEpisodeMatch?.[1] || 1));
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState(Number(searchParams?.get('episode') || idEpisodeMatch?.[2] || 1));
  const [streams, setStreams] = useState([]);
  const [streamIndex, setStreamIndex] = useState(0);
  const [seekInfo, setSeekInfo] = useState(null);

  function seekBy(seconds) {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.max(0, Math.min(max, (video.currentTime || 0) + seconds));
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
        if (type === 'series' && data.item?.videos?.length) {
          const wantedSeason = Number(searchParams?.get('season') || idEpisodeMatch?.[1] || 1);
          const wantedEpisode = Number(searchParams?.get('episode') || idEpisodeMatch?.[2] || 1);
          const wanted = data.item.videos.find((video) => Number(video.season) === wantedSeason && Number(video.episode) === wantedEpisode) || data.item.videos[0];
          setSelectedSeason(Number(wanted?.season || wantedSeason || 1));
          setSelectedEpisodeNumber(Number(wanted?.episode || wantedEpisode || 1));
        }
        setMetaStatus('ready');
      } catch (err) {
        setMetaStatus('error');
        setError(err.message || 'Unable to load Stremio item');
      }
    }
    loadMeta();
  }, [type, id, searchParams, stremioSource]);

  const seasons = useMemo(() => {
    const map = new Map();
    for (const video of item?.videos || []) {
      const seasonNo = Number(video.season || 1);
      if (!map.has(seasonNo)) map.set(seasonNo, []);
      map.get(seasonNo).push(video);
    }
    return [...map.entries()].map(([season, videos]) => ({
      season,
      videos: videos.sort((a, b) => Number(a.episode || 0) - Number(b.episode || 0)),
    })).sort((a, b) => a.season - b.season);
  }, [item?.videos]);

  const episodesForSeason = useMemo(() => {
    return seasons.find((entry) => entry.season === Number(selectedSeason))?.videos || [];
  }, [seasons, selectedSeason]);

  const currentEpisodeInfo = useMemo(() => {
    return episodesForSeason.find((video) => Number(video.episode) === Number(selectedEpisodeNumber)) || episodesForSeason[0] || null;
  }, [episodesForSeason, selectedEpisodeNumber]);

  const streamRequestId = useMemo(() => {
    if (type !== 'series') return id;
    if (currentEpisodeInfo?.id) return currentEpisodeInfo.id;
    const baseId = String(item?.imdbId || id || '').split(':')[0];
    return baseId ? `${baseId}:${selectedSeason || 1}:${selectedEpisodeNumber || 1}` : '';
  }, [type, id, item?.imdbId, currentEpisodeInfo?.id, selectedSeason, selectedEpisodeNumber]);

  useEffect(() => {
    if (!streamRequestId) return;
    async function loadStreams() {
      try {
        setStreamStatus('loading');
        setError('');
        setStreams([]);
        setStreamIndex(0);
        const streamParams = new URLSearchParams({
          type,
          id: streamRequestId,
          season: String(selectedSeason || 1),
          episode: String(selectedEpisodeNumber || 1),
        });
        if (stremioSource) streamParams.set('source', stremioSource);
        const response = await fetch(`/api/stremio/stream?${streamParams.toString()}`, { cache: 'no-store' });
        const data = await readJsonResponse(response, 'Stremio request failed');
        if (!response.ok) throw new Error(data?.error || 'Stremio stream failed');
        const nextStreams = data.streams || [];
        setStreams(nextStreams);
        if (!nextStreams.length) throw new Error(data.blockedCount ? 'Streams were returned but blocked by safety filters / allowed hosts.' : (type === 'series' ? 'No streams found for this season/episode.' : 'No streams found for this movie. Tried the catalog id and IMDb fallback.'));
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
  }, [type, streamRequestId, selectedSeason, selectedEpisodeNumber, stremioSource]);


  const activeStream = streams[streamIndex] || null;
  const streamQualityOptions = useMemo(() => streams.map((stream, index) => ({
    label: compactQualityLabel(stream, index),
    value: index,
  })), [streams]);

  useEffect(() => {
    const video = videoRef.current;
    const url = activeStream?.url;
    let cancelled = false;

    async function destroyPlayer() {
      if (playerRef.current) {
        try { await playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    }

    if (!url || !isDash(url)) {
      destroyPlayer();
      return () => { cancelled = true; };
    }

    if (!video) return;

    async function loadDash() {
      try {
        await destroyPlayer();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();

        const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
        const shaka = shakaModule.default || window.shaka || shakaModule;
        shaka.polyfill?.installAll?.();
        const player = new shaka.Player();
        playerRef.current = player;
        await player.attach(video);
        await player.load(url);
        if (!cancelled) video.play().catch(() => {});
      } catch (err) {
        if (!cancelled) setError(err.message || 'DASH playback failed. Try another stream quality.');
      }
    }

    loadDash();
    return () => { cancelled = true; destroyPlayer(); };
  }, [activeStream?.url]);

  const activePlayerTitle = currentEpisodeInfo
    ? `${item?.title || 'Stremio'} S${currentEpisodeInfo.season}E${currentEpisodeInfo.episode}`
    : item?.title || activeStream?.title || 'Stremio';
  const directStremioActive = Boolean(activeStream?.url && !isDash(activeStream.url));

  // Ask the relay whether this stream is seekable (native Range, emulated
  // Range, or unseekable because the source hides its size entirely).
  useEffect(() => {
    setSeekInfo(null);
    const url = activeStream?.url;
    if (!url || isDash(url) || !/^https?:\/\//i.test(url)) return;
    let cancelled = false;
    fetch(`/api/stream-proxy?u=${encodeURIComponent(url)}&ping=1`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setSeekInfo(data?.ok ? data : null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeStream?.url]);

  // "Single screen": turn the player shell into a full-tab theatre view —
  // same tab, same player UI, nothing else on screen.
  async function enterSingleScreen() {
    const shell = shellRef.current;
    if (!shell) return;
    try {
      if (window.jashRequestFullscreen) await window.jashRequestFullscreen(shell);
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else if (shell.webkitRequestFullscreen) shell.webkitRequestFullscreen();
    } catch {}
  }

  return (
    <main className="min-h-dvh bg-[#050012] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-fuchsia-400/10 bg-[#080008]/92 px-3 py-2 backdrop-blur-xl sm:px-4 sm:py-5">
        <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
          <div className="flex items-center justify-between gap-2 lg:justify-start">
            <div className="flex items-center gap-2">
              <a href="/stremio?home=1" onClick={(event) => { event.preventDefault(); window.location.assign('/stremio?home=1'); }} aria-label="Stremio home" title="Stremio home" className="rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-2 py-1.5 text-[10px] font-black text-fuchsia-100 transition hover:border-fuchsia-400/60 sm:px-3 sm:py-2 sm:text-xs">📡 Stremio</a>
              <a href="/" onClick={(event) => { event.preventDefault(); window.location.assign('/'); }} aria-label="JaSH ViBeS home" title="JaSH ViBeS home" className="rounded-full border border-white/10 px-2 py-1.5 text-[10px] font-black text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white sm:px-3 sm:py-2 sm:text-xs">⌂ JaSH</a>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300 lg:hidden">{stremioSource === 'watch' ? 'Provider' : 'Catalog'}</p>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <BrandLogo />
            <p className="text-[9px] font-black uppercase tracking-[0.20em] text-fuchsia-300 sm:text-xs sm:tracking-[0.32em]">{stremioSource === 'watch' ? 'Provider Player' : 'Catalog Player'}</p>
          </div>
          <span className="hidden justify-self-end text-[10px] font-black uppercase tracking-[0.30em] text-fuchsia-300 lg:block">Stremio</span>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-3 px-2 py-3 sm:gap-5 sm:px-6 sm:py-5 lg:grid-cols-[1.45fr_0.75fr] lg:px-8">
        <div className="space-y-3 sm:space-y-4">
          <div ref={shellRef} className="classics-player-shell overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:rounded-none fullscreen:border-0 sm:rounded-3xl">
            <div className="relative aspect-video h-full w-full bg-black fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:aspect-auto">
              {directStremioActive ? (
                <VideoPlayer
                  src={proxiedStreamUrl(activeStream.url)}
                  title={activePlayerTitle}
                  poster={currentEpisodeInfo?.thumbnail || item?.backdropUrl || item?.posterUrl || ''}
                  qualityOptions={streamQualityOptions}
                  qualityIndex={streamIndex}
                  onQualityChange={(index) => setStreamIndex(index)}
                  inline
                  onBackClick={() => window.history.back()}
                  onError={(message) => setError(message || 'Stremio playback failed. Try another stream quality.')}
                />
              ) : (
                <video ref={videoRef} className="h-full w-full max-h-[100dvh] max-w-[100dvw] bg-black object-fill" controls playsInline preload="metadata" poster={currentEpisodeInfo?.thumbnail || item?.backdropUrl || item?.posterUrl || undefined} />
              )}
              {streamStatus === 'loading' ? <div className="absolute inset-0 grid place-items-center bg-black/50"><span className="rounded-full bg-black/80 px-5 py-3 text-sm font-bold">Loading Stremio stream...</span></div> : null}
              {streamStatus === 'error' ? <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-red-500/30 bg-red-950/80 p-3 text-sm text-red-100">{error}</div> : null}
            </div>
          </div>

          {!directStremioActive ? (
            <div className="rounded-3xl border border-fuchsia-400/15 bg-zinc-950/85 p-3 shadow-xl shadow-black/25">
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <SymbolButton onClick={() => seekBy(-60)} title="Back 1 minute">↶1m</SymbolButton>
                <SymbolButton onClick={() => seekBy(-30)} title="Back 30 seconds">↶30</SymbolButton>
                <SymbolButton onClick={() => seekBy(-10)} title="Back 10 seconds">↶10</SymbolButton>
                <SymbolButton onClick={() => seekBy(10)} title="Forward 10 seconds">10↷</SymbolButton>
                <SymbolButton onClick={() => seekBy(30)} title="Forward 30 seconds">30↷</SymbolButton>
                <SymbolButton onClick={() => seekBy(60)} title="Forward 1 minute">1m↷</SymbolButton>
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3 sm:rounded-3xl sm:p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-black text-white">{item?.title || 'Stremio'}</h1>
                {directStremioActive && seekInfo ? (
                  <p className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${seekInfo.seekable ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/30 bg-amber-500/10 text-amber-100'}`}>
                    {seekInfo.emulatedRange ? '⤾ Seeking enabled · Jash relay' : seekInfo.nativeRange ? '⤾ Seeking enabled' : 'Seeking limited — source streams as chunks without a size'}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={enterSingleScreen}
                  disabled={!activeStream?.url}
                  className="rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/10 px-4 py-2.5 text-xs font-black text-fuchsia-100 transition hover:border-fuchsia-300/70 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Player fills this entire tab (single screen theatre)"
                >
                  🎬 Single Screen
                </button>
                {activeStream?.url ? (
                  <a
                    href={activeStream.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-2xl border border-white/10 px-4 py-2.5 text-xs font-black text-zinc-300 transition hover:border-fuchsia-400/50 hover:text-white"
                    title="Open the raw stream URL bypassing the relay"
                  >Direct</a>
                ) : null}
              </div>
            </div>
            {currentEpisodeInfo ? <p className="mt-1 text-sm text-fuchsia-200">S{currentEpisodeInfo.season} E{currentEpisodeInfo.episode} • {currentEpisodeInfo.title}</p> : null}
            <p className="mt-2 text-sm leading-6 text-zinc-400">{currentEpisodeInfo?.synopsis || item?.synopsis || ''}</p>
            <div className="mt-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {type === 'series' ? (
                  <>
                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Season
                      <select value={selectedSeason} onChange={(event) => { const nextSeason = Number(event.target.value) || 1; setSelectedSeason(nextSeason); const firstEpisode = seasons.find((entry) => entry.season === nextSeason)?.videos?.[0]; setSelectedEpisodeNumber(Number(firstEpisode?.episode || 1)); }} disabled={!seasons.length} className="mt-1 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-base font-bold text-white outline-none focus:border-fuchsia-400 disabled:opacity-50">
                        {(seasons.length ? seasons : [{ season: selectedSeason || 1 }]).map((entry) => <option key={entry.season} value={entry.season}>Season {entry.season}</option>)}
                      </select>
                    </label>
                    <label className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                      Episode
                      <select value={selectedEpisodeNumber} onChange={(event) => setSelectedEpisodeNumber(Number(event.target.value) || 1)} disabled={!episodesForSeason.length} className="mt-1 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-base font-bold text-white outline-none focus:border-fuchsia-400 disabled:opacity-50">
                        {(episodesForSeason.length ? episodesForSeason : [{ id: `fallback-${selectedEpisodeNumber || 1}`, episode: selectedEpisodeNumber || 1, title: `Episode ${selectedEpisodeNumber || 1}` }]).map((video) => <option key={video.id} value={video.episode}>E{video.episode} - {video.title}</option>)}
                      </select>
                    </label>
                  </>
                ) : null}

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

        </aside>
      </section>
    </main>
  );
}
