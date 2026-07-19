'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

function detectFormat(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(lower)) return 'video';
  if (lower.includes('m3u8') || lower.includes('/hls/')) return 'hls';
  return 'unknown';
}

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function base64UrlToHex(value = '') {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Array.from(binary).map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('').toLowerCase();
  } catch {
    return '';
  }
}

async function getDashDefaultKeyIds(url = '') {
  if (!url || !String(url).toLowerCase().includes('.mpd')) return [];

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/dash+xml,text/xml,*/*' },
    });
    if (!response.ok) return [];
    const text = await response.text();
    const ids = [...text.matchAll(/(?:cenc:)?default_KID="([^"]+)"/gi)]
      .map((match) => cleanHex(match[1]))
      .filter(Boolean);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

async function buildDrmConfig(stream) {
  const license = String(stream?.licenseKey || '').trim();
  const clearKeys = {};
  let clearKeyValue = '';

  if (license.startsWith('{')) {
    try {
      const parsed = JSON.parse(license);
      for (const item of parsed?.keys || []) {
        const kid = cleanHex(item?.kid) || base64UrlToHex(item?.kid);
        const key = cleanHex(item?.k) || base64UrlToHex(item?.k);
        if (kid && key) {
          clearKeys[kid] = key;
          clearKeyValue ||= key;
        }
      }
    } catch {}
  }

  if (license && license.includes(':') && !/^https?:\/\//i.test(license)) {
    const [keyId, key] = license.split(':');
    const kid = cleanHex(keyId);
    const parsedKey = cleanHex(key);
    if (kid && parsedKey) {
      clearKeys[kid] = parsedKey;
      clearKeyValue ||= parsedKey;
    }
  }

  const kid = cleanHex(stream?.keyId || '');
  const key = cleanHex(stream?.key || '');
  if (kid && key && kid !== 'null' && key !== 'null') {
    clearKeys[kid] = key;
    clearKeyValue ||= key;
  }

  // Some Aha M3U entries include a keyId that does not match the MPD's
  // cenc:default_KID. Shaka then throws 4012 (missing key / restrictions cannot
  // be met). Read the MPD key IDs and map the provided key to them too.
  if (clearKeyValue) {
    const manifestKeyIds = await getDashDefaultKeyIds(stream?.url || '');
    for (const manifestKid of manifestKeyIds) {
      if (!clearKeys[manifestKid]) clearKeys[manifestKid] = clearKeyValue;
    }
  }

  if (Object.keys(clearKeys).length) return { clearKeys };

  // Widevine license-server fallback. Error 6012 means Shaka detected encrypted
  // content but no license server/key was configured.
  if (/^https?:\/\//i.test(license)) {
    return { servers: { 'com.widevine.alpha': license } };
  }

  return {};
}

export default function ClassicPlayerPage() {
  const params = useParams();
  const id = params?.id;
  const videoRef = useRef(null);
  const shellRef = useRef(null);
  const playerRef = useRef(null);
  const [item, setItem] = useState(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [error, setError] = useState('');

  const streams = item?.streams || [];
  const activeStream = streams[streamIndex] || streams[0] || null;

  useEffect(() => {
    async function loadItem() {
      try {
        setStatus('loading');
        const response = await fetch(`/api/vod/${id}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Unable to load classic');
        const streams = data.item?.streams || [];
        const ahaIndex = streams.findIndex((stream) => String(stream.source || '').toLowerCase().includes('aha'));
        setItem(data.item);
        setStreamIndex(ahaIndex >= 0 ? ahaIndex : 0);
        setStatus('ready');
      } catch (err) {
        setError(err.message || 'Unable to load classic');
        setStatus('error');
      }
    }
    if (id) loadItem();
  }, [id]);

  useEffect(() => {
    if (!activeStream?.url || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;

    async function destroyPlayer() {
      if (playerRef.current) {
        try { await playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    }

    async function loadStream() {
      try {
        setPlayerStatus('loading');
        setError('');
        await destroyPlayer();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();

        const format = detectFormat(activeStream.url);
        const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
        const shaka = shakaModule.default || window.shaka || shakaModule;
        shaka.polyfill?.installAll?.();

        if (!shaka.Player?.isBrowserSupported?.()) throw new Error('Browser does not support Shaka playback');

        const player = new shaka.Player();
        playerRef.current = player;
        await player.attach(video);
        if (cancelled) return;

        const drmConfig = await buildDrmConfig(activeStream);
        player.configure({
          drm: drmConfig,
          streaming: { bufferingGoal: 20, rebufferingGoal: 3, lowLatencyMode: format === 'hls' },
          abr: { enabled: true, defaultBandwidthEstimate: 1_000_000 },
        });

        player.getNetworkingEngine()?.registerRequestFilter((requestType, request) => {
          const headers = activeStream.headers || {};
          Object.entries(headers).forEach(([key, value]) => {
            if (value) request.headers[key] = String(value);
          });
          if (activeStream.referer) request.headers.Referer = activeStream.referer;
          if (activeStream.userAgent) request.headers['User-Agent'] = activeStream.userAgent;
        });

        player.addEventListener('error', (event) => {
          if (cancelled) return;
          const code = event.detail?.code;
          console.error('[classics] Shaka error:', event.detail);
          setPlayerStatus('error');

          if ((code === 3015 || code === 3016) && ((activeStream.keyId && activeStream.key) || activeStream.licenseKey)) {
            setError(`Playback error ${code}. DRM key was found, but the browser could not decode/decrypt this stream. The saved key likely does not match this MPD's real KID, or the stream uses unsupported DRM/codec.`);
            return;
          }

          if (code === 4012) {
            setError('Playback error 4012. Shaka could not find a usable key for the encrypted tracks. Re-sync with a correct ClearKey license_key for this stream.');
            return;
          }

          if (code === 6012) {
            setError('Playback error 6012. This encrypted stream has no usable license server/ClearKey. Check the M3U license_key line and re-sync.');
            return;
          }

          setError(`Playback error${code ? ` ${code}` : ''}`);
        });

        await player.load(activeStream.url, undefined, format === 'hls' ? 'application/x-mpegurl' : undefined);
        if (cancelled) return;
        setPlayerStatus('ready');
        video.play().catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setPlayerStatus('error');
        setError(err.message || 'Stream failed to load');
      }
    }

    loadStream();
    return () => {
      cancelled = true;
      destroyPlayer();
    };
  }, [activeStream?.url]);

  async function fullscreen() {
    const element = shellRef.current;
    if (!element) return;
    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
    } catch {}
  }

  async function pip() {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {}
  }

  async function copyUrl() {
    if (!activeStream?.url) return;
    try {
      await navigator.clipboard.writeText(activeStream.url);
      alert('Stream URL copied');
    } catch {
      alert(activeStream.url);
    }
  }

  return (
    <main className="palette-nordic min-h-dvh bg-[#06110d] text-zinc-100">
      <header className="border-b border-white/10 bg-zinc-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/classics" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">← Classics</Link>
          <span className="hidden text-xs font-black uppercase tracking-[0.25em] text-red-500 sm:inline">Tamil Classics Player</span>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">Loading classic...</div> : null}
        {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-8 text-red-200">{error}</div> : null}

        {status === 'ready' && item ? (
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.6fr]">
            <div className="space-y-4">
              <div ref={shellRef} className="overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl shadow-black fullscreen:h-screen fullscreen:rounded-none fullscreen:border-0">
                <div className="relative aspect-video bg-black fullscreen:h-screen fullscreen:aspect-auto">
                  <video ref={videoRef} className="h-full w-full bg-black object-contain" controls playsInline poster={item.backdropUrl || item.posterUrl || undefined} />
                  {playerStatus === 'loading' ? <div className="absolute inset-0 grid place-items-center bg-black/50"><span className="rounded-full bg-black/80 px-5 py-3 text-sm font-bold">Loading stream...</span></div> : null}
                  {playerStatus === 'error' ? <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-red-500/30 bg-red-950/80 p-3 text-sm text-red-100">{error}</div> : null}
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
                <h1 className="text-2xl font-black text-white">{item.title}</h1>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{item.year || ''} {item.rating ? `• TMDB ${item.rating.toFixed(1)}` : ''} {item.voteCount ? `• ${item.voteCount} votes` : ''}</p>
                {item.synopsis ? <p className="mt-3 text-sm leading-6 text-zinc-400">{item.synopsis}</p> : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <select value={streamIndex} onChange={(e) => setStreamIndex(Number(e.target.value) || 0)} className="rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none focus:border-red-500">
                    {streams.map((stream, index) => (
                      <option key={`${stream.url}-${index}`} value={index}>{stream.label || stream.source || `Stream ${index + 1}`}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
                    <button onClick={fullscreen} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">Fullscreen</button>
                    <button onClick={pip} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">PiP</button>
                  </div>
                  <button onClick={copyUrl} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white">Copy URL</button>
                  {activeStream?.url ? <a href={activeStream.url} target="_blank" rel="noreferrer" className="rounded-2xl bg-red-600 px-4 py-3 text-center text-sm font-bold text-white">Open Directly</a> : null}
                </div>
              </div>
            </div>

            <aside className="rounded-3xl border border-white/10 bg-zinc-950/80 p-4">
              {item.posterUrl ? <img src={item.posterUrl} alt="" className="mx-auto max-h-[28rem] rounded-2xl object-cover" /> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {(item.sources || []).map((source) => <span key={source} className="rounded-full bg-red-500/10 px-3 py-1 text-xs font-bold text-red-100">{source}</span>)}
                {(item.genres || []).map((genre) => <span key={genre} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-bold text-zinc-300">{genre}</span>)}
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
