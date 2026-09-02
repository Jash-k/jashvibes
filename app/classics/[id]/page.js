'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import DirectWatchPlayer from '@/components/player/DirectWatchPlayer';
import { getHistoryEntry, saveWatchProgress } from '@/lib/watchStore';

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

  if (clearKeyValue) {
    const manifestKeyIds = await getDashDefaultKeyIds(stream?.url || '');
    for (const manifestKid of manifestKeyIds) {
      if (!clearKeys[manifestKid]) clearKeys[manifestKid] = clearKeyValue;
    }
  }

  if (Object.keys(clearKeys).length) return { clearKeys };

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
  const [videoEl, setVideoEl] = useState(null);
  const videoCallbackRef = useCallback((el) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);

  const [item, setItem] = useState(null);
  const [streamIndex, setStreamIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [error, setError] = useState('');

  const streams = item?.streams || [];
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

  // Load and play with Shaka Player
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
          console.error('[retro] Shaka error:', event.detail);
          setPlayerStatus('error');

          if ((code === 3015 || code === 3016) && ((activeStream.keyId && activeStream.key) || activeStream.licenseKey)) {
            setError(`Playback error ${code}. DRM key was found, but the browser could not decode/decrypt this stream.`);
            return;
          }
          if (code === 4012) {
            setError('Playback error 4012. Shaka could not find a usable key for the encrypted tracks.');
            return;
          }
          if (code === 6012) {
            setError('Playback error 6012. This encrypted stream has no usable ClearKey/license server.');
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

  // Persist progress and auto-resume
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item) return;

    const applyResume = () => {
      const saved = getHistoryEntry(watchKey);
      if (saved?.progress && saved.progress > 20) {
        try { video.currentTime = saved.progress; } catch {}
      }
    };

    if (video.readyState >= 1) applyResume();
    else video.addEventListener('loadedmetadata', applyResume, { once: true });

    let lastSave = 0;
    const persist = () => {
      saveWatchProgress(
        watchKey,
        video.currentTime || 0,
        Number.isFinite(video.duration) ? video.duration : 0,
      );
    };

    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastSave < 5000) return;
      lastSave = now;
      persist();
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', persist);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', persist);
      persist();
    };
  }, [watchKey, item]);

  const sourcesForPlayer = useMemo(() => {
    return streams.map((s, idx) => ({
      id: idx,
      label: s.label || s.source || `Stream ${idx + 1}`,
      format: s.format || 'HLS',
    }));
  }, [streams]);

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
                  <DirectWatchPlayer
                    videoEl={videoEl || videoRef.current}
                    watchKey={watchKey}
                    title={item.title || 'ReTro Movie'}
                    sources={sourcesForPlayer}
                    activeSource={streamIndex}
                    onPickSource={(idx) => setStreamIndex(idx)}
                    onError={(msg) => {
                      setPlayerStatus('error');
                      setError(msg || 'Playback error');
                    }}
                  >
                    <video
                      ref={videoCallbackRef}
                      className="h-full w-full max-h-[100dvh] max-w-[100dvw] bg-black object-fill"
                      playsInline
                      poster={item.backdropUrl || item.posterUrl || undefined}
                    />
                  </DirectWatchPlayer>

                  {playerStatus === 'loading' ? (
                    <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-black/50">
                      <div className="flex items-center gap-2 rounded-full bg-black/80 px-5 py-2.5 text-sm font-bold text-white shadow-xl backdrop-blur">
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/20 border-t-amber-400" />
                        <span>Loading ReTro stream...</span>
                      </div>
                    </div>
                  ) : null}

                  {playerStatus === 'error' ? (
                    <div className="absolute inset-x-4 bottom-16 z-40 rounded-2xl border border-red-500/30 bg-red-950/90 p-3 text-sm text-red-100 shadow-xl backdrop-blur">
                      {error}
                    </div>
                  ) : null}
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
