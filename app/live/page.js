'use client';

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  LIVE_CATALOGS,
  catalogLabel,
  getCatalogPosition,
  getChannelCatalogIds,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';

const FAVORITES_KEY = 'jash_live_tv_favorites';
const LIVE_CACHE_KEY = 'jash:live:v10-manual-catalogs';

function normalize(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function channelSlug(value = '') {
  return normalize(value).replace(/\s+/g, '-');
}

function pickInitialChannel(channels = []) {
  const playable = channels.filter((channel) => channel.playable);
  const hash = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';

  if (hash) {
    const byHash = playable.find((channel) => channelSlug(channel.name) === hash || channelSlug(channel.id) === hash);
    if (byHash) return byHash;
  }

  return (
    playable.find((channel) => normalize(channel.name) === 'star vijay hd') ||
    playable.find((channel) => normalize(channel.name).includes('star vijay')) ||
    playable.find((channel) => normalize(channel.name).includes('vijay tv')) ||
    playable.find((channel) => normalize(channel.name).includes('vijay')) ||
    playable[0] ||
    channels[0] ||
    null
  );
}

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function buildClearKeys(channel) {
  const license = String(channel?.licenseKey || '').trim();
  if (license && license.includes(':')) {
    const [keyId, key] = license.split(':');
    const kid = cleanHex(keyId);
    const clearKey = cleanHex(key);
    if (kid && clearKey) return { [kid]: clearKey };
  }

  const kid = cleanHex(channel?.keyId || '');
  const clearKey = cleanHex(channel?.key || '');
  if (kid && clearKey && kid !== 'null' && clearKey !== 'null') return { [kid]: clearKey };
  return {};
}

function appendCookieToken(uri = '', cookie = '') {
  const token = String(cookie || '').trim();
  if (!token) return uri;

  const cookieName = token.includes('__hdnea__') ? '__hdnea__' : token.includes('hdnea') ? 'hdnea' : '';
  if (!cookieName) return uri;

  const tokenValue = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
  if (!tokenValue) return uri;

  // Stream4Liv appends the Akamai token raw, not URL-encoded. Encoding the
  // slash in acl=/* can make Jio respond with BAD_HTTP_STATUS / Shaka 1001.
  if (uri.includes(`${cookieName}=`)) {
    return uri.replace(new RegExp(`(${cookieName}=)[^&"'\\s;]+`), `$1${tokenValue}`);
  }

  return `${uri}${uri.includes('?') ? '&' : '?'}${cookieName}=${tokenValue}`;
}

function isJioLike(channel, uri = '') {
  const text = `${channel?.name || ''} ${channel?.url || ''} ${channel?.logo || ''} ${channel?.source || ''} ${channel?.sourceId || ''} ${uri}`.toLowerCase();
  return text.includes('jio') || text.includes('jiotv') || text.includes('vijay');
}

function isPocketChannel(channel) {
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

export default function LiveTVPage() {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const shakaRef = useRef(null);
  const shakaUiRef = useRef(null);
  const playbackIdRef = useRef(0);
  const sourceLoadIdRef = useRef(0);
  const [channels, setChannels] = useState([]);
  const [active, setActive] = useState(null);
  const [lastViewed, setLastViewed] = useState(null);
  const [status, setStatus] = useState('loading');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [playerError, setPlayerError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [pocketProxyIds, setPocketProxyIds] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [serviceOpen, setServiceOpen] = useState(false);

  useEffect(() => {
    try {
      setFavorites(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch {
      setFavorites([]);
    }
  }, []);

  async function loadChannelsForSource() {
    const loadId = sourceLoadIdRef.current + 1;
    sourceLoadIdRef.current = loadId;

    try {
      setStatus('loading');
      setError('');
      const response = await fetch('/api/live-tv?playable=1', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to load Live TV');
      if (sourceLoadIdRef.current !== loadId) return;

      // The API returns either the small manually mapped catalog or, only before
      // the first mapping exists, the Jio bootstrap fallback. Never merge raw
      // Pocket/default source catalogs into this main list.
      const loadedChannels = (data.channels || []).filter((channel) => channel.playable);
      setPocketProxyIds([]);
      setChannels(loadedChannels);
      setLastUpdated(data.updatedAt || null);
      setActive((current) => loadedChannels.find((channel) => channel.id === current?.id) || pickInitialChannel(loadedChannels));
      setStatus('ready');
    } catch (err) {
      if (sourceLoadIdRef.current !== loadId) return;
      setChannels([]);
      setError(err.message || 'Unable to load Live TV');
      setStatus('error');
    }
  }

  useEffect(() => {
    const cached = readSessionCache(LIVE_CACHE_KEY);
    if (cached?.channels?.length) {
      setChannels(cached.channels || []);
      setActive(cached.active || pickInitialChannel(cached.channels || []));
      setLastViewed(cached.lastViewed || null);
      setStatus(cached.status || 'ready');
      setError(cached.error || '');
      setQuery(cached.query || '');
      const cachedCatalog = String(cached.category || 'all').toLowerCase();
      setCategory(cachedCatalog === 'all' || LIVE_CATALOGS.some((item) => item.id === cachedCatalog) ? cachedCatalog : 'all');
      setShowFavoritesOnly(false);
      setLastUpdated(cached.lastUpdated || null);
      restoreScroll(LIVE_CACHE_KEY);
      // Always revalidate from DB/service after painting cache. This prevents
      // old fallback or unselected channels from staying in the main panel.
      loadChannelsForSource();
      return;
    }

    loadChannelsForSource();
  }, []);

  useEffect(() => {
    writeSessionCache(LIVE_CACHE_KEY, { channels, active, lastViewed, status, error, query, category, showFavoritesOnly, lastUpdated });
  }, [channels, active, lastViewed, status, error, query, category, showFavoritesOnly, lastUpdated]);

  useEffect(() => {
    const onScroll = () => saveScroll(LIVE_CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      saveScroll(LIVE_CACHE_KEY);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!active || !videoRef.current || !playerContainerRef.current) return;

    let cancelled = false;
    let loadTimeout = null;
    let localPlayer = null;
    let localOverlay = null;
    const loadId = playbackIdRef.current + 1;
    playbackIdRef.current = loadId;
    const isCurrentLoad = () => !cancelled && playbackIdRef.current === loadId;
    const video = videoRef.current;
    const container = playerContainerRef.current;
    const pocketChannel = isPocketChannel(active);
    const pocketProxyEnabled = pocketChannel && (/^http:\/\//i.test(active.url || '') || pocketProxyIds.includes(active.id));

    async function destroyPlayerInstances(player, overlay) {
      const targetOverlay = overlay || null;
      const targetPlayer = player || null;

      if (targetOverlay) {
        try {
          await targetOverlay.destroy();
        } catch {}
        if (shakaUiRef.current === targetOverlay) shakaUiRef.current = null;
      }

      if (targetPlayer) {
        try {
          await targetPlayer.destroy();
        } catch {}
        if (shakaRef.current === targetPlayer) shakaRef.current = null;
      }
    }

    async function destroyCurrentPlayer() {
      // Capture the current instances before awaiting. This prevents the cleanup
      // from a previous channel switch from accidentally destroying the next
      // channel's newly-created player, which caused every alternate switch to
      // freeze/play.
      const overlay = shakaUiRef.current;
      const player = shakaRef.current;
      await destroyPlayerInstances(player, overlay);
    }

    async function loadChannel() {
      setPlayerStatus('loading');
      setPlayerError('');
      loadTimeout = window.setTimeout(() => {
        if (!isCurrentLoad()) return;
        setPlayerStatus('error');
        setPlayerError('Channel switch timed out. Try the channel again or choose another source.');
        destroyPlayerInstances(localPlayer, localOverlay);
      }, 25000);

      await destroyCurrentPlayer();
      if (!isCurrentLoad()) return;

      video.pause();
      video.controls = false;
      video.removeAttribute('src');
      video.load();

      if (!active.playable) {
        if (loadTimeout) window.clearTimeout(loadTimeout);
        setPlayerStatus('unsupported');
        setPlayerError('This channel format is not marked playable.');
        return;
      }

      try {
        const [shakaModule, muxModule] = await Promise.all([
          import('shaka-player/dist/shaka-player.ui.js'),
          import('mux.js'),
        ]);
        if (!isCurrentLoad()) return;

        const shaka = shakaModule.default || window.shaka || shakaModule;
        const muxjs = muxModule.default || muxModule;
        window.muxjs = muxjs;

        shaka.polyfill?.installAll?.();
        if (!shaka.Player?.isBrowserSupported?.()) {
          if (loadTimeout) window.clearTimeout(loadTimeout);
          setPlayerStatus('unsupported');
          setPlayerError('This browser does not support Shaka playback.');
          return;
        }

        const player = new shaka.Player();
        localPlayer = player;
        shakaRef.current = player;
        await player.attach(video);
        if (!isCurrentLoad()) {
          await destroyPlayerInstances(player, null);
          return;
        }

        const overlay = new shaka.ui.Overlay(player, container, video);
        localOverlay = overlay;
        shakaUiRef.current = overlay;
        overlay.configure({
          controlPanelElements: [
            'play_pause',
            'volume',
            'time_and_duration',
            'spacer',
            'quality',
            'fullscreen',
          ],
          seekBarColors: {
            base: 'rgba(255,255,255,0.3)',
            buffered: 'rgba(255,255,255,0.6)',
            played: '#ff2222',
          },
          volumeBarColors: {
            base: 'rgba(255,255,255,0.3)',
            level: '#ff2222',
          },
        });

        const clearKeys = buildClearKeys(active);
        player.configure({
          drm: Object.keys(clearKeys).length ? { clearKeys } : {},
          manifest: { defaultPresentationDelay: 5 },
          streaming: {
            safeSeekOffset: 5,
            bufferingGoal: 10,
            rebufferingGoal: 2,
            lowLatencyMode: true,
          },
          abr: {
            enabled: true,
            defaultBandwidthEstimate: 1_000_000,
            restrictToElementSize: false,
            switchInterval: 1,
          },
        });

        player.getNetworkingEngine()?.registerRequestFilter((requestType, request) => {
          const uri = request.uris?.[0] || '';
          const jioLike = isJioLike(active, uri);
          const hotstarLike = uri.includes('hotstar.com');
          const fancodeLike = uri.includes('fancode.com') || uri.includes('fblive.fancode.com') || normalize(active.category) === 'fancode' || normalize(active.name).includes('fancode');

          if (active.headers && typeof active.headers === 'object') {
            Object.entries(active.headers).forEach(([key, val]) => {
              if (!key || val == null || /^cookie$/i.test(key)) return;
              request.headers[key] = String(val);
            });
          }

          if (active.referer) request.headers.Referer = active.referer;
          else if (jioLike) request.headers.Referer = 'https://www.jiotv.co/';
          else if (hotstarLike) request.headers.Referer = 'https://www.hotstar.com/';
          else if (fancodeLike) request.headers.Referer = 'https://www.fancode.com/';

          const userAgent = active.userAgent ||
            (jioLike ? 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6' : '') ||
            (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : '');
          if (userAgent) request.headers['User-Agent'] = userAgent;

          let nextUri = uri;
          if (
            active.cookie &&
            (jioLike || (hotstarLike && !uri.includes('?'))) &&
            (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST || requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT)
          ) {
            nextUri = appendCookieToken(uri, active.cookie);
            request.uris[0] = nextUri;
          }

          if (pocketProxyEnabled && /^https?:\/\//i.test(nextUri)) {
            const fallbackReferer = active.referer ||
              (jioLike ? 'https://www.jiotv.co/' : '') ||
              (hotstarLike ? 'https://www.hotstar.com/' : '') ||
              (fancodeLike ? 'https://www.fancode.com/' : '');
            request.uris[0] = buildPocketProxyUrl(nextUri, active, fallbackReferer);
            delete request.headers['User-Agent'];
            delete request.headers.Referer;
            delete request.headers.Cookie;
          }
        });

        player.getNetworkingEngine()?.registerResponseFilter((requestType, response) => {
          if (pocketProxyEnabled && response?.uri) response.uri = restorePocketProxyUri(response.uri);
        });

        player.addEventListener('error', (event) => {
          if (!isCurrentLoad()) return;
          const detail = event.detail;
          console.error('[live-tv] Shaka error:', detail);
          if (loadTimeout) window.clearTimeout(loadTimeout);
          if (pocketChannel && !pocketProxyEnabled && /^https?:\/\//i.test(active.url || '')) {
            setPlayerStatus('loading');
            setPlayerError('Direct Pocket playback failed. Retrying Pocket route...');
            setPocketProxyIds((current) => current.includes(active.id) ? current : [...current, active.id]);
            return;
          }
          setPlayerStatus('error');
          setPlayerError(`Shaka Error ${detail?.code || ''}. Stream failed to load. Try another channel or source.`);
        });

        player.addEventListener('buffering', (event) => {
          if (isCurrentLoad()) setPlayerStatus(event.buffering ? 'loading' : 'ready');
        });

        setPlayerStatus('loading');
        const mimeType = active.format === 'hls' ? 'application/x-mpegurl' : undefined;
        await player.load(active.url, undefined, mimeType);
        if (!isCurrentLoad()) return;

        if (loadTimeout) window.clearTimeout(loadTimeout);
        setPlayerStatus('ready');
        video.play().catch(() => {});
      } catch (err) {
        if (loadTimeout) window.clearTimeout(loadTimeout);
        if (!isCurrentLoad()) return;
        console.error('[live-tv] Player load failed:', err);
        if (pocketChannel && !pocketProxyEnabled && /^https?:\/\//i.test(active.url || '')) {
          setPlayerStatus('loading');
          setPlayerError('Direct Pocket playback failed. Retrying Pocket route...');
          setPocketProxyIds((current) => current.includes(active.id) ? current : [...current, active.id]);
          return;
        }
        setPlayerStatus('error');
        setPlayerError(err.message || 'Stream failed to load. Try another channel or source.');
      }
    }

    loadChannel();

    return () => {
      cancelled = true;
      if (loadTimeout) window.clearTimeout(loadTimeout);
      destroyPlayerInstances(localPlayer, localOverlay);
    };
  }, [active, pocketProxyIds]);

  const catalogOptions = useMemo(() => LIVE_CATALOGS.map((catalog) => ({
    ...catalog,
    count: channels.filter((channel) => getChannelCatalogIds(channel).includes(catalog.id)).length,
  })), [channels]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const filteredChannels = useMemo(() => {
    const q = normalize(query);
    const filtered = channels.filter((channel) => {
      if (!channel.playable) return false;
      if (category !== 'all' && !getChannelCatalogIds(channel).includes(category)) return false;
      if (showFavoritesOnly && !favoriteSet.has(channel.id)) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.region} ${channel.source} ${getChannelCatalogIds(channel).join(' ')}`).includes(q);
    });
    return sortChannelsForCatalog(filtered, category);
  }, [channels, category, query, showFavoritesOnly, favoriteSet]);

  const activeFilteredIndex = useMemo(() => {
    if (!active?.id) return -1;
    return filteredChannels.findIndex((channel) => channel.id === active.id);
  }, [filteredChannels, active?.id]);

  function selectChannel(channel, { remember = true } = {}) {
    if (!channel) return;
    setActive((current) => {
      if (remember && current?.id && current.id !== channel.id) setLastViewed(current);
      return channel;
    });
  }

  function navigateChannel(direction) {
    const list = filteredChannels.length ? filteredChannels : channels;
    if (!list.length) return;
    const currentIndex = list.findIndex((channel) => channel.id === active?.id);
    const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (baseIndex + direction + list.length) % list.length;
    selectChannel(list[nextIndex]);
  }

  function returnToLastChannel() {
    if (!lastViewed?.id) return;
    const target = channels.find((channel) => channel.id === lastViewed.id) || lastViewed;
    selectChannel(target);
  }

  function toggleFavorite(channel) {
    const next = favoriteSet.has(channel.id)
      ? favorites.filter((id) => id !== channel.id)
      : [...favorites, channel.id];
    setFavorites(next);
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  async function enterFullscreen() {
    const shell = document.getElementById('live-player-shell');
    if (!shell) return;
    try {
      if (window.jashRequestFullscreen) await window.jashRequestFullscreen(shell);
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else if (shell.webkitRequestFullscreen) shell.webkitRequestFullscreen();
    } catch {}
  }

  async function pictureInPicture() {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {}
  }

  async function copyUrl() {
    if (!active?.url) return;
    try {
      await navigator.clipboard.writeText(active.url);
      alert('Channel URL copied');
    } catch {
      alert(active.url);
    }
  }

  return (
    <main className="palette-cybergrape min-h-dvh overflow-x-hidden bg-[#09041a] text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/92 backdrop-blur">
        <div className="mx-auto grid max-w-7xl gap-3 px-3 py-4 sm:px-6 sm:py-5 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:px-8">
          <div className="flex items-center justify-start gap-3">
            <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">
              ← Home
            </Link>
          </div>
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <BrandLogo />
            <p className="text-[10px] font-black uppercase tracking-[0.26em] text-red-500 sm:text-xs sm:tracking-[0.32em]">Tamil Live TV</p>
          </div>
          <button
            type="button"
            onClick={() => setServiceOpen(true)}
            className="justify-self-end rounded-full border border-purple-300/25 bg-purple-500/10 px-3 py-2 text-xs font-black text-purple-100 transition hover:border-purple-300/70"
            title="Live TV Service Panel"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl items-start gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(320px,24rem)] lg:px-8">
        <div className="min-w-0 space-y-3 sm:space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div id="live-player-shell" className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50 fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:rounded-none fullscreen:border-0 sm:rounded-3xl">
            <div
              ref={playerContainerRef}
              className="relative aspect-video h-full w-full bg-black fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:aspect-auto"
              data-shaka-player-container
            >
              {active?.playable ? (
                <video
                  key={active.id}
                  ref={videoRef}
                  className="h-full w-full max-h-[100dvh] max-w-[100dvw] bg-black object-fill"
                  data-shaka-player
                  playsInline
                  autoPlay
                  muted={false}
                  poster={active.logo || undefined}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center">
                  <div>
                    <p className="text-xl font-black text-white">{active ? 'Channel unavailable' : 'Choose a channel'}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {active ? (playerError || 'This channel could not be loaded by Shaka Player. Try Open Directly or another source.') : 'Tamil preferred channels will appear on the right.'}
                    </p>
                  </div>
                </div>
              )}

              {playerStatus === 'loading' ? (
                <div className="absolute inset-0 grid place-items-center bg-black/45">
                  <div className="rounded-full border border-white/10 bg-black/80 px-5 py-3 text-sm font-bold text-zinc-200">Loading channel...</div>
                </div>
              ) : null}
              {playerStatus === 'error' ? (
                <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-red-500/30 bg-red-950/80 p-3 text-sm leading-6 text-red-100 backdrop-blur">
                  {playerError || 'Playback failed. Try another source or Open Directly.'}
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3 sm:rounded-3xl sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-black text-white sm:text-2xl">{active?.name || 'Tamil Live TV'}</h1>
                <p className="mt-1 text-xs text-zinc-500 sm:text-sm">
                  {active ? `${getChannelCatalogIds(active).map(catalogLabel).join(' + ') || 'Initial Jio'} • ${active.source} • ${active.format.toUpperCase()}${active.keyId && active.key ? ' • ClearKey DRM' : ''}` : `Loaded ${channels.length} manually mapped channels`}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2 sm:space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => navigateChannel(-1)}
                  disabled={!filteredChannels.length && !channels.length}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2.5 text-xs font-black text-white transition hover:border-red-500/50 disabled:opacity-40 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
                  title="Previous channel"
                >
                  ‹ Pre
                </button>
                <button
                  type="button"
                  onClick={returnToLastChannel}
                  disabled={!lastViewed?.id}
                  className="rounded-xl border border-orange-400/25 bg-orange-500/10 px-2 py-2.5 text-xs font-black text-orange-100 transition hover:border-orange-300/60 disabled:opacity-40 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
                  title={lastViewed?.name ? `Return to ${lastViewed.name}` : 'Return to last viewed channel'}
                >
                  ↩ Return
                </button>
                <button
                  type="button"
                  onClick={() => navigateChannel(1)}
                  disabled={!filteredChannels.length && !channels.length}
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2.5 text-xs font-black text-white transition hover:border-red-500/50 disabled:opacity-40 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-sm"
                  title="Next channel"
                >
                  Nxt ›
                </button>
              </div>
              {lastViewed?.name ? <p className="truncate px-1 text-[10px] font-semibold text-zinc-600 sm:text-xs">Last viewed: {lastViewed.name}</p> : null}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button onClick={enterFullscreen} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white transition hover:border-red-500/50">Fullscreen</button>
                {active?.url ? <a href={active.url} target="_blank" rel="noreferrer" className="rounded-2xl bg-red-600 px-4 py-3 text-center text-sm font-bold text-white transition hover:bg-red-500">Open Directly</a> : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="min-w-0 space-y-3 lg:w-full">
          <div className="sticky top-[7.7rem] z-30 rounded-2xl border border-white/10 bg-zinc-950/95 p-3 backdrop-blur sm:rounded-3xl sm:p-4 lg:static">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-200">My catalogs</p>
              <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-zinc-400">{filteredChannels.length}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
              <button
                type="button"
                onClick={() => setCategory('all')}
                className={`rounded-xl border px-2 py-2 text-xs font-black transition ${category === 'all' ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}
              >
                All · {channels.length}
              </button>
              {catalogOptions.map((catalog) => (
                <button
                  key={catalog.id}
                  type="button"
                  onClick={() => setCategory(catalog.id)}
                  className={`rounded-xl border px-2 py-2 text-xs font-black transition ${category === catalog.id ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-purple-400/40'}`}
                >
                  {catalog.icon} {catalog.name} · {catalog.count}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search mapped channels"
                className="min-w-0 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-purple-400"
              />
              <button
                type="button"
                onClick={() => setShowFavoritesOnly((value) => !value)}
                className={`rounded-xl border px-3 py-2 text-sm ${showFavoritesOnly ? 'border-yellow-400 bg-yellow-500/15 text-yellow-100' : 'border-white/10 text-zinc-400'}`}
                title="Favorites only"
              >
                ★
              </button>
            </div>
          </div>

          <div className="space-y-2 pr-1 lg:max-h-[70dvh] lg:overflow-y-auto">
            {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">Loading Tamil channels...</div> : null}
            {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-center text-red-200">{error}</div> : null}
            {status === 'ready' && filteredChannels.length === 0 ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">No manually mapped channels in this catalog.</div> : null}

            {filteredChannels.map((channel) => (
              <button
                key={channel.id}
                type="button"
                onClick={() => selectChannel(channel)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition sm:rounded-3xl sm:p-3 ${active?.id === channel.id ? 'border-red-500/70 bg-red-600/15' : 'border-white/10 bg-zinc-950/80 hover:border-red-500/40'}`}
              >
                <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/5 sm:h-14 sm:w-14 sm:rounded-2xl">
                  {channel.logo ? <img src={channel.logo} alt="" className="max-h-full max-w-full object-fill" loading="lazy" /> : <span className="text-xs font-black text-zinc-500">TV</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-white">{channel.name}</p>
                  <p className="mt-1 truncate text-xs text-zinc-500">{getChannelCatalogIds(channel).map(catalogLabel).join(' + ') || 'Initial Jio'} • {channel.source}</p>
                  <div className="mt-1 flex gap-1">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${channel.playable ? 'bg-green-500/15 text-green-200' : 'bg-orange-500/15 text-orange-200'}`}>{channel.format.toUpperCase()}</span>
                    {channel.keyId && channel.key ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-100">DRM</span> : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>
      </section>
      <LiveServicePanel
        open={serviceOpen}
        onClose={() => { setServiceOpen(false); loadChannelsForSource(); }}
        onPreview={(channel) => selectChannel(channel)}
        onMainRefresh={() => loadChannelsForSource('all')}
      />
    </main>
  );
}

const SERVICE_TOKEN_KEY = 'jash_live_service_token';

function ServicePreviewPlayer({ channel }) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const loadSeqRef = useRef(0);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const video = videoRef.current;
    if (!channel?.url || !video) return;
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    let cancelled = false;
    let timeout = null;
    let debounce = null;

    async function destroy() {
      const player = playerRef.current;
      playerRef.current = null;
      if (player) {
        try { await player.destroy(); } catch {}
      }
    }

    async function load() {
      await destroy();
      if (cancelled || loadSeqRef.current !== seq) return;
      setStatus('loading');
      setError('');
      timeout = window.setTimeout(() => {
        if (cancelled || loadSeqRef.current !== seq) return;
        setStatus('error');
        setError('Preview timed out. Try channel in main panel or another source.');
        destroy();
      }, 18000);

      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
        video.controls = true;

        if (['hls', 'dash'].includes(channel.format)) {
          const [shakaModule, muxModule] = await Promise.all([
            import('shaka-player/dist/shaka-player.compiled.js'),
            import('mux.js'),
          ]);
          if (cancelled || loadSeqRef.current !== seq) return;
          const shaka = shakaModule.default || window.shaka || shakaModule;
          const muxjs = muxModule.default || muxModule;
          window.muxjs = muxjs;
          shaka.polyfill?.installAll?.();
          const player = new shaka.Player();
          playerRef.current = player;
          await player.attach(video);
          if (cancelled || loadSeqRef.current !== seq) return;

          const clearKeys = buildClearKeys(channel);
          player.configure({
            drm: Object.keys(clearKeys).length ? { clearKeys } : {},
            streaming: { bufferingGoal: 8, rebufferingGoal: 2, lowLatencyMode: true },
            abr: { enabled: true, defaultBandwidthEstimate: 1_000_000 },
          });

          player.getNetworkingEngine()?.registerRequestFilter((requestType, request) => {
            const uri = request.uris?.[0] || '';
            const jioLike = isJioLike(channel, uri);
            const hotstarLike = uri.includes('hotstar.com');
            const fancodeLike = uri.includes('fancode.com') || uri.includes('fblive.fancode.com') || normalize(channel.category) === 'fancode' || normalize(channel.name).includes('fancode');

            if (channel.headers && typeof channel.headers === 'object') {
              Object.entries(channel.headers).forEach(([key, val]) => {
                if (!key || val == null || /^cookie$/i.test(key)) return;
                request.headers[key] = String(val);
              });
            }

            if (channel.referer) request.headers.Referer = channel.referer;
            else if (jioLike) request.headers.Referer = 'https://www.jiotv.co/';
            else if (hotstarLike) request.headers.Referer = 'https://www.hotstar.com/';
            else if (fancodeLike) request.headers.Referer = 'https://www.fancode.com/';

            const userAgent = channel.userAgent ||
              (jioLike ? 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6' : '') ||
              (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' : '');
            if (userAgent) request.headers['User-Agent'] = userAgent;

            let nextUri = uri;
            if (channel.cookie && (jioLike || (hotstarLike && !uri.includes('?'))) &&
              (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST || requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT)) {
              nextUri = appendCookieToken(uri, channel.cookie);
              request.uris[0] = nextUri;
            }

            if (isPocketChannel(channel) && /^https?:\/\//i.test(nextUri)) {
              const fallbackReferer = channel.referer || (jioLike ? 'https://www.jiotv.co/' : '') || (hotstarLike ? 'https://www.hotstar.com/' : '') || (fancodeLike ? 'https://www.fancode.com/' : '');
              request.uris[0] = buildPocketProxyUrl(nextUri, channel, fallbackReferer);
              delete request.headers['User-Agent'];
              delete request.headers.Referer;
              delete request.headers.Cookie;
            }
          });

          player.getNetworkingEngine()?.registerResponseFilter((requestType, response) => {
            if (isPocketChannel(channel) && response?.uri) response.uri = restorePocketProxyUri(response.uri);
          });

          player.addEventListener('error', (event) => {
            if (cancelled || loadSeqRef.current !== seq) return;
            const detail = event.detail;
            setStatus('error');
            setError(`Preview error ${detail?.code || ''}`);
          });

          await player.load(channel.url, undefined, channel.format === 'hls' ? 'application/x-mpegurl' : undefined);
        } else {
          video.src = channel.url;
          video.load();
        }

        if (cancelled || loadSeqRef.current !== seq) return;
        if (timeout) window.clearTimeout(timeout);
        setStatus('ready');
        video.play().catch(() => {});
      } catch (err) {
        if (cancelled || loadSeqRef.current !== seq) return;
        if (timeout) window.clearTimeout(timeout);
        setStatus('error');
        setError(err.message || 'Preview failed');
      }
    }

    debounce = window.setTimeout(load, 180);
    return () => {
      cancelled = true;
      if (debounce) window.clearTimeout(debounce);
      if (timeout) window.clearTimeout(timeout);
      destroy();
    };
  }, [channel?.channelId, channel?.url]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
      <div className="aspect-video bg-black">
        {channel?.url ? <video ref={videoRef} className="h-full w-full object-fill" controls playsInline /> : <div className="grid h-full place-items-center text-xs text-zinc-500">Select a channel to preview</div>}
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-400">
        {channel?.name || 'No preview'} {status === 'loading' ? '• Loading…' : ''} {status === 'ready' ? '• Ready' : ''} {error ? `• ${error}` : ''}
      </div>
    </div>
  );
}

function LiveServicePanel({ open, onClose, onPreview, onMainRefresh }) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [tab, setTab] = useState('sources');
  const [sources, setSources] = useState([]);
  const [channels, setChannels] = useState([]);
  const [selectedChannels, setSelectedChannels] = useState([]);
  const [mainPanelChannels, setMainPanelChannels] = useState([]);
  const [mainPanelQuery, setMainPanelQuery] = useState('');
  const [mainPanelCategory, setMainPanelCategory] = useState('all');
  const [mainPanelSource, setMainPanelSource] = useState('all');
  const [categories, setCategories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [channelQuery, setChannelQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [mappingFilter, setMappingFilter] = useState('all');
  const [channelsLoaded, setChannelsLoaded] = useState(false);
  const [channelStats, setChannelStats] = useState({ total: 0, mapped: 0, unmapped: 0 });
  const [orderCatalog, setOrderCatalog] = useState('main');
  const [activeProfile, setActiveProfile] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [previewChannel, setPreviewChannel] = useState(null);
  const [sourceForm, setSourceForm] = useState({ label: '', url: '', type: 'm3u', priority: 50 });
  const [importText, setImportText] = useState('');

  useEffect(() => {
    if (!open) return;
    try { setToken(window.sessionStorage.getItem(SERVICE_TOKEN_KEY) || ''); } catch {}
  }, [open]);

  const api = async (path, options = {}) => {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-jash-token': token,
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || `Request failed: ${response.status}`);
    return data;
  };

  async function unlock(event) {
    event?.preventDefault?.();
    try {
      setAuthError('');
      const response = await fetch('/api/auth', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Invalid password');
      setToken(data.token);
      window.sessionStorage.setItem(SERVICE_TOKEN_KEY, data.token);
      setPassword('');
    } catch (err) {
      setAuthError(err.message || 'Unable to unlock service panel');
    }
  }

  async function loadSources() {
    if (!token) return;
    const data = await api('/api/live-service/sources');
    setSources(data.sources || []);
  }

  async function loadProfiles() {
    if (!token) return;
    const data = await api('/api/live-service/profiles');
    setProfiles(data.profiles || []);
  }

  async function loadChannels({ mapped = false, sourceId = sourceFilter } = {}) {
    if (!token) return;
    const params = new URLSearchParams({ limit: mapped ? '1000' : '5000' });
    if (mapped) {
      params.set('mapped', '1');
      params.set('profile', activeProfile);
    } else {
      if (!sourceId) {
        setChannels([]);
        setCategories([]);
        setChannelsLoaded(false);
        setChannelStats({ total: 0, mapped: 0, unmapped: 0 });
        return;
      }
      params.set('sourceId', sourceId);
    }

    const data = await api(`/api/live-service/channels?${params.toString()}`);
    if (mapped) {
      setSelectedChannels(data.channels || []);
    } else {
      setChannels(data.channels || []);
      setCategories(data.categories || []);
      setChannelsLoaded(true);
      setChannelStats({
        total: data.sourceTotal || data.total || 0,
        mapped: data.mappedTotal || 0,
        unmapped: data.unmappedTotal || 0,
      });
    }
  }

  async function loadSourceChannels() {
    if (!sourceFilter) {
      setMessage('Choose one source, then click Load source channels.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      await loadChannels({ sourceId: sourceFilter });
      setMessage('Source channels loaded. Map only the channels you want to publish.');
    } catch (err) {
      setMessage(err.message || 'Unable to load source channels');
    } finally {
      setLoading(false);
    }
  }

  async function loadMainPanelPreview() {
    if (!token) return;
    const response = await fetch(`/api/live-tv?playable=1&profile=${encodeURIComponent(activeProfile)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Main panel preview failed');
    setMainPanelChannels(data.channels || []);
  }

  async function refreshAll() {
    if (!token) return;
    setLoading(true);
    setMessage('');
    try {
      await Promise.all([loadSources(), loadProfiles(), loadChannels({ mapped: true }), loadMainPanelPreview()]);
    } catch (err) {
      setMessage(err.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (open && token) refreshAll(); }, [open, token]);
  useEffect(() => {
    // Selecting a source must not automatically load its full catalog. The
    // explicit Load button keeps service-panel startup and source switching fast.
    setChannels([]);
    setCategories([]);
    setChannelsLoaded(false);
    setChannelStats({ total: 0, mapped: 0, unmapped: 0 });
    setCategoryFilter('');
    setChannelQuery('');
    setMappingFilter('all');
  }, [sourceFilter]);
  useEffect(() => { if (open && token) { loadChannels({ mapped: true }); loadMainPanelPreview(); } }, [activeProfile]);

  async function syncSource(sourceId = '') {
    setLoading(true);
    try {
      const data = await api('/api/live-service/sync', { method: 'POST', body: JSON.stringify({ sourceId, includeAll: true }) });
      setMessage(`Synced ${data.results?.length || 0} source(s). New channels remain unmapped until you publish them manually.`);
      setChannelsLoaded(false);
      setChannels([]);
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Sync failed'); } finally { setLoading(false); }
  }

  async function saveSource(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await api('/api/live-service/sources', { method: 'POST', body: JSON.stringify(sourceForm) });
      setSourceForm({ label: '', url: '', type: 'm3u', priority: 50 });
      setMessage('Source saved.');
      await loadSources();
    } catch (err) { setMessage(err.message || 'Save source failed'); } finally { setLoading(false); }
  }

  async function patchSource(source, patch) {
    await api('/api/live-service/sources', { method: 'PATCH', body: JSON.stringify({ sourceId: source.sourceId || source.id, ...patch }) });
    await loadSources();
  }

  async function deleteSource(source, channels = false) {
    if (!window.confirm(`Delete source ${source.label}?`)) return;
    await api(`/api/live-service/sources?sourceId=${encodeURIComponent(source.sourceId || source.id)}&channels=${channels ? '1' : '0'}`, { method: 'DELETE' });
    await refreshAll();
  }

  async function channelAction(channel, action, patch = {}) {
    try {
      const wasMapped = Boolean(channel.mapped || getChannelCatalogIds(channel).length);
      const data = await api('/api/live-service/channels', {
        method: 'PATCH',
        body: JSON.stringify({ channelId: channel.channelId || channel.id, action, ...patch }),
      });
      const updates = data.channels || [];
      if (!updates.length) return;
      const requestedId = channel.channelId || channel.id;
      const updated = updates.find((item) => (item.channelId || item.id) === requestedId) || updates[0];
      const isMapped = Boolean(updated.mapped || getChannelCatalogIds(updated).length);
      const updateMap = new Map(updates.map((item) => [item.channelId || item.id, item]));
      const replace = (items) => items.map((item) => updateMap.get(item.channelId || item.id) || item);
      const profileCompatible = (item) => (item.profiles || ['default']).includes(activeProfile);

      setChannels((items) => replace(items));
      setSelectedChannels((items) => {
        let next = replace(items);
        for (const item of updates) {
          const id = item.channelId || item.id;
          next = next.filter((current) => (current.channelId || current.id) !== id);
          if ((item.mapped || getChannelCatalogIds(item).length) && profileCompatible(item)) next.push(item);
        }
        return next;
      });
      setMainPanelChannels((items) => {
        let next = replace(items);
        for (const item of updates) {
          const id = item.channelId || item.id;
          next = next.filter((current) => (current.channelId || current.id) !== id);
          if ((item.mapped || getChannelCatalogIds(item).length) && item.selected && !item.hidden && item.playable && profileCompatible(item)) next.push(item);
        }
        return next;
      });
      if (channelsLoaded && wasMapped !== isMapped) {
        setChannelStats((current) => ({
          ...current,
          mapped: Math.max(0, current.mapped + (isMapped ? 1 : -1)),
          unmapped: Math.max(0, current.unmapped + (isMapped ? -1 : 1)),
        }));
      }
      setMessage(action === 'swapCatalogPosition'
        ? `${catalogLabel(patch.catalogId)} order updated.`
        : isMapped
          ? `${updated.name} mapped to ${getChannelCatalogIds(updated).map(catalogLabel).join(' + ')}.`
          : `${updated.name} is unmapped and removed from the main panel.`);
      loadSources().catch(() => {});
    } catch (err) {
      setMessage(err.message || 'Channel update failed');
    }
  }

  async function toggleCatalog(channel, catalogId) {
    await channelAction(channel, 'toggleCatalog', { catalogId });
  }

  async function setCatalogPosition(channel, catalogId) {
    const current = getCatalogPosition(channel, catalogId);
    const raw = window.prompt(`Position in ${catalogLabel(catalogId)}`, current < 999999 ? String(current) : '100');
    if (raw == null) return;
    const position = Number(raw);
    if (!Number.isFinite(position) || position < 0) {
      setMessage('Position must be a number greater than or equal to zero.');
      return;
    }
    await channelAction(channel, 'catalogPosition', { catalogId, position });
  }

  async function reorder(channel, direction) {
    const index = orderedCatalogChannels.findIndex((item) => (item.channelId || item.id) === (channel.channelId || channel.id));
    if (index < 0) return;
    const nextIndex = index + (direction < 0 ? -1 : 1);
    const adjacent = orderedCatalogChannels[nextIndex];
    if (!adjacent) return;
    await channelAction(channel, 'swapCatalogPosition', {
      catalogId: orderCatalog,
      otherChannelId: adjacent.channelId || adjacent.id,
      direction: direction < 0 ? -1 : 1,
    });
  }

  async function purge(mode = 'unused') {
    if (!window.confirm(`Purge ${mode} channels${sourceFilter ? ' for selected source' : ''}?`)) return;
    setLoading(true);
    try {
      const data = await api('/api/live-service/purge', { method: 'POST', body: JSON.stringify({ sourceId: sourceFilter, mode }) });
      setMessage(`Purged ${data.removed || 0} channel(s).`);
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Purge failed'); } finally { setLoading(false); }
  }

  async function checkBroken() {
    setLoading(true);
    try {
      const data = await api('/api/live-service/check', { method: 'POST', body: JSON.stringify({ sourceId: sourceFilter, limit: 60 }) });
      setMessage(`Checked ${data.checked || 0} channel(s).`);
      await loadChannels();
    } catch (err) { setMessage(err.message || 'Check failed'); } finally { setLoading(false); }
  }

  async function loadDuplicates() {
    const params = new URLSearchParams();
    if (sourceFilter) params.set('sourceId', sourceFilter);
    const data = await api(`/api/live-service/duplicates?${params.toString()}`);
    setDuplicates(data.groups || []);
    setTab('duplicates');
  }

  async function exportBackup() {
    const data = await api('/api/live-service/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jash-live-tv-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importBackup() {
    try {
      const parsed = JSON.parse(importText);
      const data = await api('/api/live-service/import', { method: 'POST', body: JSON.stringify(parsed) });
      setMessage(`Imported ${data.sources || 0} sources and ${data.channels || 0} channels.`);
      setImportText('');
      await refreshAll();
      onMainRefresh?.();
    } catch (err) { setMessage(err.message || 'Import failed'); }
  }

  async function addProfile() {
    const name = window.prompt('Profile name', 'Kids');
    if (!name) return;
    await api('/api/live-service/profiles', { method: 'POST', body: JSON.stringify({ name }) });
    await loadProfiles();
  }

  const mainPanelSources = useMemo(() => {
    const map = new Map();
    sources.forEach((source) => map.set(source.sourceId || source.id, { id: source.sourceId || source.id, label: source.label }));
    mainPanelChannels.forEach((channel) => {
      const id = channel.sourceId || channel.source;
      if (id && !map.has(id)) map.set(id, { id, label: channel.source || id });
    });
    return [...map.values()];
  }, [sources, mainPanelChannels]);
  const mainPanelFiltered = useMemo(() => {
    const q = normalize(mainPanelQuery);
    const filtered = mainPanelChannels.filter((channel) => {
      if (!channel.playable) return false;
      if (mainPanelCategory !== 'all' && !getChannelCatalogIds(channel).includes(mainPanelCategory)) return false;
      if (mainPanelSource !== 'all' && channel.sourceId !== mainPanelSource && channel.source !== mainPanelSource) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.region} ${channel.source} ${getChannelCatalogIds(channel).join(' ')}`).includes(q);
    });
    return sortChannelsForCatalog(filtered, mainPanelCategory);
  }, [mainPanelChannels, mainPanelQuery, mainPanelCategory, mainPanelSource]);
  const channelRowsFiltered = useMemo(() => {
    const q = normalize(channelQuery);
    return channels.filter((channel) => {
      const mapped = Boolean(channel.mapped || getChannelCatalogIds(channel).length);
      if (mappingFilter === 'mapped' && !mapped) return false;
      if (mappingFilter === 'unmapped' && mapped) return false;
      if (categoryFilter && channel.category !== categoryFilter) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.source}`).includes(q);
    });
  }, [channels, channelQuery, categoryFilter, mappingFilter]);
  const orderedCatalogChannels = useMemo(() => {
    return sortChannelsForCatalog(
      selectedChannels.filter((channel) => getChannelCatalogIds(channel).includes(orderCatalog)),
      orderCatalog,
    );
  }, [selectedChannels, orderCatalog]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 p-2 backdrop-blur-xl sm:p-4">
      <section className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[1.6rem] border border-purple-300/20 bg-[#080411] text-white shadow-2xl sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div><h2 className="text-lg font-black sm:text-2xl">Live TV Service Panel</h2><p className="text-[11px] text-zinc-500">Manual catalogs • source-on-demand loading • per-catalog order</p></div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/5 text-xl">×</button>
        </div>

        {!token ? (
          <form onSubmit={unlock} className="m-auto w-full max-w-sm rounded-3xl border border-white/10 bg-black/35 p-5">
            <p className="text-sm font-bold text-zinc-300">Enter password to manage Live TV services.</p>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus className="mt-4 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none" placeholder="Service password" />
            {authError ? <p className="mt-3 text-sm text-red-300">{authError}</p> : null}
            <button className="mt-4 w-full rounded-2xl bg-purple-500 px-4 py-3 text-sm font-black text-black">Unlock</button>
          </form>
        ) : (
          <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[16rem_minmax(0,1fr)_22rem]">
            <aside className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/25 p-3">
              <div className="grid gap-2">
                {[
                  ['sources', 'Sources'],
                  ['channels', 'Manual mapping'],
                  ['main', 'Main preview'],
                  ['selected', 'Catalog order'],
                  ['tools', 'Tools'],
                  ['duplicates', 'Duplicates'],
                ].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-2xl px-4 py-3 text-left text-sm font-black ${tab === id ? 'bg-purple-500 text-black' : 'bg-white/[0.04] text-zinc-300'}`}>{label}</button>)}
              </div>
              <div className="mt-4 space-y-2">
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="">Choose source…</option>{sources.map((s) => <option key={s.sourceId || s.id} value={s.sourceId || s.id}>{s.label}</option>)}</select>
                <select value={activeProfile} onChange={(e) => setActiveProfile(e.target.value)} className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white">{(profiles.length ? profiles : [{ profileId: 'default', name: 'Main' }]).map((p) => <option key={p.profileId} value={p.profileId}>{p.name}</option>)}</select>
                <button onClick={refreshAll} disabled={loading} className="w-full rounded-2xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-200">{loading ? 'Working…' : 'Refresh'}</button>
                {message ? <p className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5 text-zinc-300">{message}</p> : null}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto rounded-3xl border border-white/10 bg-black/20 p-3">
              {tab === 'sources' ? <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3">
                  <div><p className="text-sm font-black text-white">Sources</p><p className="text-xs text-zinc-500">Sync stores channels as unmapped. Nothing is published until you map it manually.</p></div>
                  <button onClick={() => syncSource('')} disabled={loading} className="rounded-full bg-green-500 px-4 py-2 text-xs font-black text-black disabled:opacity-60">Sync all enabled</button>
                </div>
                <form onSubmit={saveSource} className="grid gap-2 rounded-3xl border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-2">
                  <input value={sourceForm.label} onChange={(e) => setSourceForm((f) => ({ ...f, label: e.target.value }))} placeholder="Source name" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                  <input value={sourceForm.url} onChange={(e) => setSourceForm((f) => ({ ...f, url: e.target.value }))} placeholder="M3U/JSON URL" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                  <select value={sourceForm.type} onChange={(e) => setSourceForm((f) => ({ ...f, type: e.target.value }))} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="m3u">M3U</option><option value="json">JSON</option></select>
                  <button className="rounded-2xl bg-purple-500 px-3 py-2 text-sm font-black text-black">Add / Save Source</button>
                </form>
                {sources.map((source) => <div key={source.sourceId || source.id} className="rounded-3xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-black">{source.label}</p><p className="break-all text-xs text-zinc-500">{source.url}</p><p className="mt-1 text-xs text-zinc-500">{source.channelCount || 0} channels • {source.mappedCount ?? source.selectedCount ?? 0} mapped • priority {source.priority}</p>{source.lastError ? <p className="mt-2 rounded-xl border border-red-400/25 bg-red-500/10 p-2 text-xs text-red-200">{source.lastError}</p> : null}</div><span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold uppercase">{source.type}</span></div>
                  <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => syncSource(source.sourceId || source.id)} className="rounded-full bg-green-500 px-3 py-1.5 text-xs font-black text-black">Sync</button><button onClick={() => patchSource(source, { enabled: !source.enabled })} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black">{source.enabled ? 'Disable' : 'Enable'}</button><button onClick={() => patchSource(source, { autoPurge: !source.autoPurge })} className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-black">Auto purge {source.autoPurge ? 'On' : 'Off'}</button><button onClick={() => deleteSource(source, false)} className="rounded-full border border-red-400/30 px-3 py-1.5 text-xs font-black text-red-200">Delete</button></div>
                </div>)}
              </div> : null}

              {tab === 'channels' ? <div className="space-y-3">
                <div className="rounded-3xl border border-cyan-300/20 bg-cyan-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-white">Manual catalog mapping</p>
                      <p className="text-xs leading-5 text-zinc-400">Choose one source on the left. Its full catalog loads only when you press Load. Click one or more catalog chips to publish a channel.</p>
                    </div>
                    <button onClick={loadSourceChannels} disabled={loading || !sourceFilter} className="rounded-full bg-cyan-400 px-4 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-40">Load source channels</button>
                  </div>
                  {channelsLoaded ? <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-xl bg-black/25 p-2"><b className="block text-white">{channelStats.total}</b>All</div><div className="rounded-xl bg-green-500/10 p-2 text-green-200"><b className="block">{channelStats.mapped}</b>Mapped</div><div className="rounded-xl bg-zinc-500/10 p-2 text-zinc-300"><b className="block">{channelStats.unmapped}</b>Unmapped</div></div> : null}
                </div>
                {channelsLoaded ? <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input value={channelQuery} onChange={(e) => setChannelQuery(e.target.value)} placeholder="Search loaded source" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white" />
                    <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="">All source categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    <select value={mappingFilter} onChange={(e) => setMappingFilter(e.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white"><option value="all">Mapped + unmapped</option><option value="mapped">Mapped only</option><option value="unmapped">Unmapped only</option></select>
                  </div>
                  <p className="text-xs text-zinc-500">Showing {channelRowsFiltered.length} loaded channel(s).</p>
                  {channelRowsFiltered.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                  {!channelRowsFiltered.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No channels match these filters.</p> : null}
                </> : <p className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No source catalog loaded. This keeps service-panel startup fast.</p>}
              </div> : null}

              {tab === 'main' ? <div className="space-y-3">
                <div className="rounded-3xl border border-purple-300/20 bg-purple-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-black text-white">Main Panel Preview</p><p className="text-xs text-zinc-400">This list is fetched from /api/live-tv and should exactly match the main Live TV panel.</p></div><button onClick={loadMainPanelPreview} className="rounded-full border border-purple-300/30 px-3 py-1.5 text-xs font-black text-purple-100">Reload</button></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <select value={mainPanelCategory} onChange={(event) => setMainPanelCategory(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none"><option value="all">All catalogs</option>{LIVE_CATALOGS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                    <select value={mainPanelSource} onChange={(event) => setMainPanelSource(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none"><option value="all">All sources</option>{mainPanelSources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
                    <input value={mainPanelQuery} onChange={(event) => setMainPanelQuery(event.target.value)} placeholder="Search main panel" className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none" />
                  </div>
                </div>
                {mainPanelFiltered.map((channel) => <ChannelManagerRow key={channel.channelId || channel.id} channel={channel} selectedMode positionCatalog={mainPanelCategory === 'all' ? '' : mainPanelCategory} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                {!mainPanelFiltered.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No main panel channels for this filter.</p> : null}
              </div> : null}

              {tab === 'selected' ? <div className="space-y-3">
                <div className="rounded-3xl border border-purple-300/20 bg-purple-500/10 p-3">
                  <p className="text-sm font-black text-white">Per-catalog channel order</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">A channel can have a different position in every catalog. Use arrows for quick changes or click its position badge to enter an exact number.</p>
                  <select value={orderCatalog} onChange={(event) => setOrderCatalog(event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white sm:max-w-xs">{LIVE_CATALOGS.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name}</option>)}</select>
                </div>
                {orderedCatalogChannels.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} selectedMode positionCatalog={orderCatalog} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} onUp={(ch) => reorder(ch, -10)} onDown={(ch) => reorder(ch, 10)} />)}
                {!orderedCatalogChannels.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No channels mapped to {catalogLabel(orderCatalog)}.</p> : null}
              </div> : null}

              {tab === 'tools' ? <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><button onClick={() => purge('unused')} className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white">Purge unused</button><button onClick={() => purge('broken')} className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm font-black text-red-200">Purge broken</button><button onClick={checkBroken} className="rounded-2xl border border-green-400/30 px-4 py-3 text-sm font-black text-green-200">Check broken</button><button onClick={loadDuplicates} className="rounded-2xl border border-yellow-400/30 px-4 py-3 text-sm font-black text-yellow-100">Find duplicates</button><button onClick={addProfile} className="rounded-2xl border border-purple-400/30 px-4 py-3 text-sm font-black text-purple-100">Add profile</button><button onClick={exportBackup} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-black">Export backup</button></div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste exported JSON backup here" className="h-36 w-full rounded-2xl border border-white/10 bg-black p-3 text-xs text-white" />
                <button onClick={importBackup} className="rounded-2xl bg-purple-500 px-4 py-3 text-sm font-black text-black">Import backup</button>
              </div> : null}

              {tab === 'duplicates' ? <div className="space-y-3">{duplicates.map((group) => <div key={group.key} className="rounded-3xl border border-white/10 bg-white/[0.03] p-3"><p className="mb-2 text-sm font-black">{group.key} • {group.count}</p><div className="space-y-2">{group.channels.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} />)}</div></div>)}{!duplicates.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">Click Find duplicates in Tools.</p> : null}</div> : null}
            </main>

            <aside className="min-h-0 space-y-3 overflow-y-auto rounded-3xl border border-white/10 bg-black/25 p-3">
              <ServicePreviewPlayer channel={previewChannel} />
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-400">
                <p className="font-black text-white">Manual publishing</p>
                <p>Only channels with at least one catalog chip are published. Removing the final chip immediately unmaps the channel. Source sync never changes your mappings or positions.</p>
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}

function ChannelManagerRow({
  channel,
  onPreview,
  onAction,
  onCatalogToggle,
  onPosition,
  selectedMode = false,
  positionCatalog = '',
  onUp,
  onDown,
}) {
  const catalogIds = getChannelCatalogIds(channel);
  const mapped = catalogIds.length > 0;
  const focusedPosition = positionCatalog ? getCatalogPosition(channel, positionCatalog) : null;

  return (
    <div className={`rounded-2xl border p-2.5 ${mapped ? 'border-green-400/20 bg-green-500/[0.045]' : 'border-white/10 bg-white/[0.03]'}`}>
      <div className="flex gap-3">
        <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/5">{channel.logo ? <img src={channel.logo} alt="" className="max-h-full max-w-full object-contain" /> : <span className="text-[10px] text-zinc-500">TV</span>}</div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-black text-white">{channel.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${mapped ? 'bg-green-500/15 text-green-200' : 'bg-zinc-500/15 text-zinc-400'}`}>{mapped ? 'Mapped' : 'Unmapped'}</span>
          </div>
          <p className="truncate text-xs text-zinc-500">{channel.category} • {channel.source} • {channel.format?.toUpperCase()} • {channel.workingStatus}</p>
          {mapped ? <div className="mt-1 flex flex-wrap gap-1">{catalogIds.map((id) => <button key={id} type="button" onClick={() => onPosition?.(channel, id)} className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[9px] font-bold text-purple-100" title="Set exact position">{catalogLabel(id)} · {getCatalogPosition(channel, id)}</button>)}</div> : null}
        </div>
      </div>

      {onCatalogToggle ? <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {LIVE_CATALOGS.map((catalog) => {
          const active = catalogIds.includes(catalog.id);
          return <button key={catalog.id} type="button" onClick={() => onCatalogToggle(channel, catalog.id)} className={`rounded-xl border px-2 py-1.5 text-[10px] font-black transition ${active ? 'border-green-400/45 bg-green-500/20 text-green-100' : 'border-white/10 bg-black/20 text-zinc-400 hover:border-purple-400/50 hover:text-white'}`}>{active ? '✓ ' : ''}{catalog.name}</button>;
        })}
      </div> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onPreview?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">Preview</button>
        {mapped ? <button type="button" onClick={() => onAction?.(channel, 'unmap')} className="rounded-full border border-orange-400/30 px-2.5 py-1 text-[11px] font-black text-orange-100">Unmap all</button> : null}
        <button type="button" onClick={() => onAction?.(channel, channel.favorite ? 'unfavorite' : 'favorite')} className="rounded-full border border-yellow-400/30 px-2.5 py-1 text-[11px] font-black text-yellow-100">{channel.favorite ? '★' : '☆'}</button>
        <button type="button" onClick={() => onAction?.(channel, channel.hidden ? 'unhide' : 'hide')} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">{channel.hidden ? 'Unhide' : 'Hide'}</button>
        {selectedMode && positionCatalog && focusedPosition < 999999 && (onUp || onDown) ? <>
          <button type="button" onClick={() => onUp?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">↑ Move</button>
          <button type="button" onClick={() => onDown?.(channel)} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-black">↓ Move</button>
        </> : null}
      </div>
    </div>
  );
}
