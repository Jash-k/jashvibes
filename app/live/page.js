'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';

const FAVORITES_KEY = 'jash_live_tv_favorites';
const LIVE_CACHE_KEY = 'jash:live:v3';

function normalize(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
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
  const text = `${channel?.name || ''} ${channel?.url || ''} ${channel?.logo || ''} ${uri}`.toLowerCase();
  return text.includes('jio') || text.includes('jiotv');
}

export default function LiveTVPage() {
  const videoRef = useRef(null);
  const playerContainerRef = useRef(null);
  const shakaRef = useRef(null);
  const shakaUiRef = useRef(null);
  const playbackIdRef = useRef(0);
  const [channels, setChannels] = useState([]);
  const [sources, setSources] = useState([]);
  const [active, setActive] = useState(null);
  const [lastViewed, setLastViewed] = useState(null);
  const [status, setStatus] = useState('loading');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [playerError, setPlayerError] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    try {
      setFavorites(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]'));
    } catch {
      setFavorites([]);
    }
  }, []);

  useEffect(() => {
    const cached = readSessionCache(LIVE_CACHE_KEY);
    if (cached?.channels?.length) {
      setChannels(cached.channels || []);
      setSources(cached.sources || []);
      setActive(cached.active || pickInitialChannel(cached.channels || []));
      setLastViewed(cached.lastViewed || null);
      setStatus(cached.status || 'ready');
      setError(cached.error || '');
      setQuery(cached.query || '');
      setCategory(cached.category || 'all');
      setSourceFilter(cached.sourceFilter || 'all');
      setShowFavoritesOnly(false);
      setLastUpdated(cached.lastUpdated || null);
      restoreScroll(LIVE_CACHE_KEY);
      return;
    }

    async function loadChannels() {
      try {
        setStatus('loading');
        setError('');
        const response = await fetch('/api/live-tv', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Unable to load Live TV');

        const loadedChannels = data.channels || [];
        setChannels(loadedChannels);
        setSources(data.sources || []);
        setLastUpdated(data.updatedAt || null);
        setActive(pickInitialChannel(loadedChannels));
        setStatus('ready');
      } catch (err) {
        setError(err.message || 'Unable to load Live TV');
        setStatus('error');
      }
    }

    loadChannels();
  }, []);

  useEffect(() => {
    writeSessionCache(LIVE_CACHE_KEY, { channels, sources, active, lastViewed, status, error, query, category, sourceFilter, showFavoritesOnly, lastUpdated });
  }, [channels, sources, active, lastViewed, status, error, query, category, sourceFilter, showFavoritesOnly, lastUpdated]);

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

          if (active.referer) request.headers.Referer = active.referer;
          else if (jioLike) request.headers.Referer = 'https://www.jiotv.co/';
          else if (hotstarLike) request.headers.Referer = 'https://www.hotstar.com/';
          else if (fancodeLike) request.headers.Referer = 'https://www.fancode.com/';

          const userAgent = active.userAgent ||
            (jioLike ? 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6' : '') ||
            (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : '');
          if (userAgent) request.headers['User-Agent'] = userAgent;

          if (
            active.cookie &&
            (jioLike || (hotstarLike && !uri.includes('?'))) &&
            (requestType === shaka.net.NetworkingEngine.RequestType.MANIFEST || requestType === shaka.net.NetworkingEngine.RequestType.SEGMENT)
          ) {
            request.uris[0] = appendCookieToken(uri, active.cookie);
          }
        });

        player.addEventListener('error', (event) => {
          if (!isCurrentLoad()) return;
          const detail = event.detail;
          console.error('[live-tv] Shaka error:', detail);
          if (loadTimeout) window.clearTimeout(loadTimeout);
          setPlayerStatus('error');
          setPlayerError(`Shaka Error ${detail?.code || ''}. Stream failed to load. Cookie may be expired or CORS may block this channel.`);
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
        setPlayerStatus('error');
        setPlayerError(err.message || 'Stream failed to load.');
      }
    }

    loadChannel();

    return () => {
      cancelled = true;
      if (loadTimeout) window.clearTimeout(loadTimeout);
      destroyPlayerInstances(localPlayer, localOverlay);
    };
  }, [active]);

  const categories = useMemo(() => {
    const list = unique(channels.map((channel) => channel.category || 'Tamil'));
    return list.sort((a, b) => {
      const order = { Music: 0, Sports: 1 };
      const ao = order[a] ?? 99;
      const bo = order[b] ?? 99;
      if (ao !== bo) return ao - bo;
      return a.localeCompare(b);
    });
  }, [channels]);
  const sourceNames = useMemo(() => unique(channels.map((channel) => channel.source)), [channels]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const filteredChannels = useMemo(() => {
    const q = normalize(query);
    return channels.filter((channel) => {
      if (category !== 'all' && channel.category !== category) return false;
      if (sourceFilter !== 'all' && channel.source !== sourceFilter) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.region} ${channel.source}`).includes(q);
    });
  }, [channels, category, sourceFilter, query, showFavoritesOnly, favoriteSet]);

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
      if (shell.requestFullscreen) await shell.requestFullscreen();
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
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-3 py-3 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">
              ← Home
            </Link>
            <p className="text-[10px] font-black uppercase tracking-[0.25em] text-red-500 sm:text-xs sm:tracking-[0.3em]">Tamil Live TV</p>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Tamil channels..."
            className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-base font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-red-500 sm:max-w-md sm:text-sm"
          />
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-5 lg:grid-cols-[1.45fr_0.9fr] lg:px-8">
        <div className="space-y-3 sm:space-y-4 lg:sticky lg:top-24 lg:self-start">
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
                  {active ? `${active.category || 'Tamil'} • ${active.source} • ${active.format.toUpperCase()}${active.keyId && active.key ? ' • ClearKey DRM' : ''}` : `Loaded ${channels.length} preferred Tamil channels`}
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

        <aside className="space-y-3">
          <div className="sticky top-[7.7rem] z-30 rounded-2xl border border-white/10 bg-zinc-950/95 p-3 backdrop-blur sm:rounded-3xl sm:p-4 lg:static">
            <div className="grid grid-cols-2 gap-2">
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-500">
                <option value="all">All categories</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-500">
                <option value="all">All sources</option>
                {sourceNames.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCategory((value) => value === 'Music' ? 'all' : 'Music')}
                className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${category === 'Music' ? 'border-fuchsia-400 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}
              >
                ♫ Music
              </button>
              <button
                type="button"
                onClick={() => setCategory((value) => value === 'Sports' ? 'all' : 'Sports')}
                className={`rounded-2xl border px-4 py-2 text-sm font-black transition ${category === 'Sports' ? 'border-green-400 bg-green-500/15 text-green-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}
              >
                ⚽ Sports
              </button>
            </div>
          </div>

          <div className="space-y-2 pr-1 lg:max-h-[70dvh] lg:overflow-y-auto">
            {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">Loading Tamil channels...</div> : null}
            {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-center text-red-200">{error}</div> : null}
            {status === 'ready' && filteredChannels.length === 0 ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">No channels found.</div> : null}

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
                  <p className="mt-1 truncate text-xs text-zinc-500">{channel.category} • {channel.source}</p>
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
    </main>
  );
}
