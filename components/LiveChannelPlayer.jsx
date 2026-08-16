'use client';

/**
 * LiveChannelPlayer — compact, embeddable live-TV channel player.
 *
 * Plays any /api/live-tv channel object: Jio DASH + ClearKey with per-request
 * Akamai cookie, direct first and automatic refresh+server-proxy fallback
 * (same flow as the /live page). Used by the home Live Sports block and the
 * match-center "Watch Live" panel.
 */

import { useEffect, useRef, useState } from 'react';
import {
  appendJioCookieToUrl,
  buildJioProxyUrl,
  isJioChannel,
  restoreJioProxyUrl,
} from '@/lib/jioPlayback';
import { buildClearKeys, isShakaDrmLoadError, resolveJioAccess } from '@/lib/livePlaybackClient';

function isPocketChannel(channel = {}) {
  return channel?.sourceId === 'pocket-tamil' || channel?.source === 'Pocket Tamil';
}

function buildPocketProxyUrl(uri = '', channel = {}, fallbackReferer = '') {
  const params = new URLSearchParams({ u: uri });
  if (channel.userAgent) params.set('ua', channel.userAgent);
  if (channel.referer || fallbackReferer) params.set('ref', channel.referer || fallbackReferer);
  if (channel.cookie) params.set('ck', channel.cookie);
  return `/api/live-pocket/proxy?${params.toString()}`;
}

function restorePocketProxyUri(uri = '') {
  try {
    const parsed = new URL(uri, window.location.origin);
    if (parsed.origin === window.location.origin && parsed.pathname === '/api/live-pocket/proxy') {
      return parsed.searchParams.get('u') || uri;
    }
  } catch {}
  return uri;
}

export default function LiveChannelPlayer({ channel, className = '' }) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const playerRef = useRef(null);
  const overlayRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState('');
  const [proxyMode, setProxyMode] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!channel?.id || !video || !container) return undefined;

    let cancelled = false;
    let localPlayer = null;
    let localOverlay = null;
    let loadTimeout = null;
    const active = channel;
    const usesJio = isJioChannel(active, active.url);
    const pocketChannel = isPocketChannel(active);
    let pocketProxyEnabled = false;

    const isCurrent = () => !cancelled;

    async function destroyInstances(player, overlay) {
      try { overlay?.destroy?.(); } catch {}
      try { if (player) await player.destroy(); } catch {}
      if (playerRef.current === player) playerRef.current = null;
      if (overlayRef.current === overlay) overlayRef.current = null;
    }

    async function load() {
      setStatus('loading');
      setError('');
      setProxyMode(false);

      await destroyInstances(localPlayer, localOverlay);
      localPlayer = null;
      localOverlay = null;
      if (!isCurrent()) return;

      video.pause();
      video.controls = false;
      video.removeAttribute('src');
      video.load();

      loadTimeout = window.setTimeout(() => {
        if (!isCurrent()) return;
        setStatus('error');
        setError('Stream timed out. Try again or pick another channel.');
        destroyInstances(localPlayer, localOverlay);
      }, usesJio ? 40000 : 25000);

      const finishTimer = () => { if (loadTimeout) { window.clearTimeout(loadTimeout); loadTimeout = null; } };

      try {
        const shakaModule = await import('shaka-player/dist/shaka-player.ui.js');
        if (!isCurrent()) return;
        const shaka = shakaModule.default || window.shaka || shakaModule;

        try { const muxModule = await import('mux.js'); window.muxjs = muxModule.default || muxModule; } catch {}

        shaka.polyfill?.installAll?.();
        if (!shaka.Player?.isBrowserSupported?.()) {
          finishTimer();
          setStatus('error');
          setError('This browser does not support live playback.');
          return;
        }

        const player = new shaka.Player();
        localPlayer = player;
        playerRef.current = player;
        await player.attach(video);
        if (!isCurrent()) { await destroyInstances(player, null); return; }

        let overlay;
        try {
          overlay = new shaka.ui.Overlay(player, container, video);
          localOverlay = overlay;
          overlayRef.current = overlay;
          overlay.configure({
            controlPanelElements: ['play_pause', 'volume', 'spacer', 'quality', 'fullscreen'],
            seekBarColors: { base: 'rgba(255,255,255,0.3)', buffered: 'rgba(255,255,255,0.6)', played: '#ff2222' },
            volumeBarColors: { base: 'rgba(255,255,255,0.3)', level: '#ff2222' },
          });
        } catch { overlay = null; }

        let jioAccess = usesJio
          ? await resolveJioAccess(active)
          : { cookie: '', playbackUrl: active.url, scoped: false };
        let jioCookie = jioAccess.cookie;
        let jioPlaybackUrl = jioAccess.playbackUrl || active.url;
        let jioProxyEnabled = false;
        if (usesJio && !jioCookie) {
          throw new Error('No valid Jio token is available. Add a fresh token in Live TV → Service → Tools.');
        }

        const clearKeys = buildClearKeys(active);
        let drmKeysEnabled = Object.keys(clearKeys).length > 0;
        player.configure({
          drm: drmKeysEnabled ? { clearKeys } : {},
          manifest: { defaultPresentationDelay: 5 },
          streaming: { safeSeekOffset: 5, bufferingGoal: 10, rebufferingGoal: 2, lowLatencyMode: true },
          abr: { enabled: true, defaultBandwidthEstimate: 1_000_000, restrictToElementSize: false, switchInterval: 1 },
        });

        player.getNetworkingEngine()?.registerRequestFilter((requestType, request) => {
          const uri = request.uris?.[0] || '';
          const originalUri = restoreJioProxyUrl(uri, window.location.origin);
          const jioLike = isJioChannel(active, originalUri);
          const hotstarLike = originalUri.includes('hotstar.com');
          const fancodeLike = originalUri.includes('fancode.com') || /fancode/i.test(`${active.category} ${active.name}`);

          if (active.headers && typeof active.headers === 'object') {
            Object.entries(active.headers).forEach(([key, val]) => {
              if (!key || val == null || /^cookie$/i.test(key)) return;
              if (jioLike && /^(?:user-agent|referer|referrer)$/i.test(key)) return;
              request.headers[key] = String(val);
            });
          }

          if (!jioLike) {
            if (active.referer) request.headers.Referer = active.referer;
            else if (hotstarLike) request.headers.Referer = 'https://www.hotstar.com/';
            else if (fancodeLike) request.headers.Referer = 'https://www.fancode.com/';
            const ua = active.userAgent ||
              (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : '');
            if (ua) request.headers['User-Agent'] = ua;
          }

          let nextUri = originalUri;
          if (jioLike && jioCookie &&
            (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST || requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT)) {
            nextUri = appendJioCookieToUrl(originalUri, jioCookie);
            request.uris[0] = jioProxyEnabled ? buildJioProxyUrl(nextUri, jioCookie) : nextUri;
          }

          if (pocketProxyEnabled && /^https?:\/\//i.test(nextUri)) {
            const fallbackReferer = active.referer || (hotstarLike ? 'https://www.hotstar.com/' : '') || (fancodeLike ? 'https://www.fancode.com/' : '');
            request.uris[0] = buildPocketProxyUrl(nextUri, active, fallbackReferer);
            delete request.headers['User-Agent'];
            delete request.headers.Referer;
            delete request.headers.Cookie;
          }
        });

        player.getNetworkingEngine()?.registerResponseFilter((requestType, response) => {
          if (jioProxyEnabled && response?.uri) response.uri = restoreJioProxyUrl(response.uri, window.location.origin);
          if (pocketProxyEnabled && response?.uri) response.uri = restorePocketProxyUri(response.uri);
        });

        player.addEventListener('error', () => {});
        player.addEventListener('buffering', (event) => {
          if (isCurrent()) setStatus(event.buffering ? 'loading' : 'ready');
        });

        const mimeType = active.format === 'hls' ? 'application/x-mpegurl' : undefined;
        const directUrl = usesJio ? appendJioCookieToUrl(jioPlaybackUrl, jioCookie) : active.url;

        const loadWithDrmRetry = async (uri) => {
          try {
            await player.load(uri, undefined, mimeType);
            return null;
          } catch (firstError) {
            if (drmKeysEnabled && isShakaDrmLoadError(firstError)) {
              drmKeysEnabled = false;
              player.configure({ drm: { clearKeys: {} } });
              try {
                await player.load(uri, undefined, mimeType);
                return null;
              } catch (retryError) {
                return retryError;
              }
            }
            return firstError;
          }
        };

        let loadFailure = await loadWithDrmRetry(directUrl);
        if (!isCurrent()) return;
        if (loadFailure && usesJio) {
          setStatus('loading');
          jioAccess = await resolveJioAccess(active, { force: true });
          jioCookie = jioAccess.cookie;
          jioPlaybackUrl = jioAccess.playbackUrl || active.url;
          if (!jioCookie) throw new Error('Jio token refresh failed. Paste a current token in Live TV → Service → Tools.');
          jioProxyEnabled = true;
          setProxyMode(true);
          await player.unload().catch(() => {});
          const proxiedUrl = buildJioProxyUrl(appendJioCookieToUrl(jioPlaybackUrl, jioCookie), jioCookie);
          loadFailure = await loadWithDrmRetry(proxiedUrl);
          if (!isCurrent()) return;
        }
        if (loadFailure && pocketChannel && !pocketProxyEnabled && /^https?:\/\//i.test(active.url || '')) {
          pocketProxyEnabled = true;
          await player.unload().catch(() => {});
          loadFailure = await loadWithDrmRetry(buildPocketProxyUrl(active.url, active, active.referer));
          if (!isCurrent()) return;
        }
        if (loadFailure) throw loadFailure;

        finishTimer();
        setError('');
        setStatus('ready');
        video.play().catch(() => {});
      } catch (err) {
        finishTimer();
        if (!isCurrent()) return;
        console.error('[live-channel-player] load failed:', err);
        setStatus('error');
        setError(
          usesJio
            ? `Jio playback failed${err?.code ? ` (Shaka ${err.code})` : ''}. Token may be expired — refresh it in Live TV → Service → Tools, or Jio may be blocking this network.`
            : (err?.message || 'Stream failed to load. Try another channel.')
        );
      }
    }

    load();

    return () => {
      cancelled = true;
      if (loadTimeout) window.clearTimeout(loadTimeout);
      destroyInstances(localPlayer, localOverlay);
    };
  }, [channel?.id, channel?.url]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl bg-black ${className}`}
      data-shaka-player-container
    >
      <video ref={videoRef} className="aspect-video w-full" playsInline autoPlay muted data-shaka-player />
      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white/90">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            Loading live stream…
          </div>
        </div>
      )}
      {(status === 'error' || error) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-4 text-center">
          <span className="text-2xl">📺</span>
          <p className="max-w-md text-xs text-white/70">{error || 'Stream failed to load.'}</p>
        </div>
      )}
      {proxyMode && status === 'ready' && (
        <div className="absolute right-2 top-2 rounded-md bg-amber-500/80 px-2 py-0.5 text-[10px] font-bold text-black">
          secure route
        </div>
      )}
    </div>
  );
}
