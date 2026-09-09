'use client';

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import { useCallback, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import JashPlayer from '@/components/player/JashPlayer';
import { DayStrip, GuideNowLine, GuideStatus, ProgrammeCard, SourceBadges, useLiveGuide } from '@/components/live/LiveGuide';
import { createLiveTvPolicy, isPocketChannel } from '@/lib/player/policy/liveTv';
import PlayerIncidents from '@/components/player/PlayerIncidents';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import { writeLiveNow } from '@/lib/liveNow';
import {
  LIVE_CATALOGS,
  catalogLabel,
  getCatalogPosition,
  getChannelCatalogIds,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';
import {
  JIO_COOKIE_OVERRIDE_KEY,
  getJioCookieExpiry,
  isJioCookieValid,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

const FAVORITES_KEY = 'jash_live_tv_favorites';
const LIVE_GUIDE_ROW_STORAGE_KEY = 'jash_live_guide_row';
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

export default function LiveTVPage() {
  const sourceLoadIdRef = useRef(0);
  // Channels whose direct URL is known to need the Pocket proxy. Deliberately
  // a ref, not state: the player reads it while building the policy and must
  // not be rebuilt (and reloaded) by the write that sets it.
  const pocketProxyRef = useRef(new Set());
  const [channels, setChannels] = useState([]);
  const [active, setActive] = useState(null);
  const [lastViewed, setLastViewed] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  // Phone-only: the guide strip sits beside the live tile instead of below it. Persisted, because the
  // choice is per-device — a desktop has no reason to inherit it, and a page that re-stacks itself on
  // reload loses the place the viewer came back to.
  const [guideCompact, setGuideCompact] = useState(false);
  useEffect(() => {
    try {
      setGuideCompact(window.localStorage.getItem(LIVE_GUIDE_ROW_STORAGE_KEY) === '1');
    } catch {
      /* private mode: stay stacked, which is the safe default on a small screen */
    }
  }, []);
  const toggleGuideRow = useCallback(() => {
    setGuideCompact((current) => {
      const next = !current;
      try {
        if (next) window.localStorage.setItem(LIVE_GUIDE_ROW_STORAGE_KEY, '1');
        else window.localStorage.removeItem(LIVE_GUIDE_ROW_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

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
      setChannels(loadedChannels);
      setLastUpdated(data.updatedAt || null);
      setActive((current) => {
        if (current?.id) {
          const match = loadedChannels.find((channel) => channel.id === current.id);
          if (match) {
            if (match.url === current.url && match.keyId === current.keyId && match.key === current.key && match.cookie === current.cookie) {
              return current;
            }
            return match;
          }
        }
        return pickInitialChannel(loadedChannels);
      });
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
    const root = document.documentElement;
    const applyHeaderOffset = () => {
      const header = document.getElementById('live-header');
      if (header) root.style.setProperty('--live-header-h', `${Math.round(header.getBoundingClientRect().height)}px`);
    };
    applyHeaderOffset();
    window.addEventListener('resize', applyHeaderOffset);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(applyHeaderOffset) : null;
    const node = document.getElementById('live-header');
    if (observer && node) observer.observe(node);
    return () => {
      window.removeEventListener('resize', applyHeaderOffset);
      if (observer) observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const onScroll = () => saveScroll(LIVE_CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      saveScroll(LIVE_CACHE_KEY);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Every live-source quirk — Jio token resolution, ClearKey, header rewriting,
  // the Pocket proxy, DVR/streaming config and the retry order — lives in the
  // policy, so the main panel and the service-panel preview cannot drift.
  const livePolicy = useMemo(() => {
    if (!active) return null;
    const base = createLiveTvPolicy(active, {
      pocketProxyEnabled: pocketProxyRef.current.has(active.id),
    });
    return {
      ...base,
      recover: async (arg) => {
        const next = await base.recover(arg);
        if (next && isPocketChannel(active) && /^http:\/\//i.test(String(active.url || ''))) {
          pocketProxyRef.current.add(active.id);
        }
        return next;
      },
    };
  }, [active]);

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

  // Deliberately fed the WHOLE lineup, not `filteredChannels`: the response is a few KB, so searching
  // and filtering stay instant instead of turning into a request per keystroke.
  const guide = useLiveGuide({ channels, activeId: active?.id || '' });

  // Publish what is on air, for the one line the homepage is allowed to print (see lib/liveNow.js).
  // It rides the guide the page already fetched, so this costs no extra request anywhere.
  const guideRows = guide.rows;
  useEffect(() => {
    try {
      const row = (active?.id && guideRows.get(active.id)) || [...guideRows.values()][0];
      if (!row?.now) return;
      writeLiveNow({ channel: active?.name || row?.name || '', title: row.now.title, minutesLeft: row.now.minutes });
    } catch {
      // A homepage convenience must never be able to break the player page.
    }
  }, [active, guideRows]);
  const guideCoverage = useMemo(() => {
    const rows = [...guide.rows.values()];
    return { linked: rows.filter((row) => row.matched).length, unlinked: rows.filter((row) => !row.matched).length };
  }, [guide.rows]);
  const [guideRefreshing, setGuideRefreshing] = useState(false);
  const refreshGuideFeed = useCallback(async () => {
    setGuideRefreshing(true);
    try {
      const ok = await guide.refresh();
      return ok;
    } finally {
      setGuideRefreshing(false);
    }
  }, [guide]);

  const activeFilteredIndex = useMemo(() => {
    if (!active?.id) return -1;
    return filteredChannels.findIndex((channel) => channel.id === active.id);
  }, [filteredChannels, active?.id]);

  const selectChannel = useCallback((channel, { remember = true } = {}) => {
    if (!channel) return;
    setActive((current) => {
      if (remember && current?.id && current.id !== channel.id) setLastViewed(current);
      return channel;
    });
  }, []);

  const navigateChannel = useCallback((direction) => {
    const list = filteredChannels.length ? filteredChannels : channels;
    if (!list.length) return;
    const currentIndex = filteredChannels.length
      ? activeFilteredIndex
      : list.findIndex((channel) => channel.id === active?.id);
    const baseIndex = currentIndex >= 0 ? currentIndex : direction > 0 ? -1 : 0;
    const nextIndex = (baseIndex + direction + list.length) % list.length;
    selectChannel(list[nextIndex]);
  }, [filteredChannels, channels, activeFilteredIndex, active?.id, selectChannel]);

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

  const enterFullscreen = useCallback(async () => {
    const shell = document.getElementById('live-player-shell');
    if (!shell) return;
    try {
      if (window.jashRequestFullscreen) await window.jashRequestFullscreen(shell);
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else if (shell.webkitRequestFullscreen) shell.webkitRequestFullscreen();
    } catch {}
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!e || !e.key) return;
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
      // JashPlayer binds the same keys (and more) while it holds focus, so the
      // page must not answer twice for one press.
      if (e.target?.closest?.('[data-jash-ui]') || document.activeElement?.closest?.('[data-jash-ui]')) return;
      const key = String(e.key || '').toLowerCase();
      if (key === 'n' || key === 'arrowright') {
        e.preventDefault();
        navigateChannel(1);
      } else if (key === 'p' || key === 'arrowleft') {
        e.preventDefault();
        navigateChannel(-1);
      } else if (key === 'f') {
        e.preventDefault();
        enterFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateChannel, enterFullscreen]);

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
    <main className="palette-cybergrape live-page min-h-dvh overflow-x-clip bg-[#09041a] text-zinc-100">
      <header id="live-header" className="hidden sm:block sticky top-0 z-50 border-b border-white/10 bg-zinc-950 shadow-[0_14px_30px_-18px_rgba(0,0,0,.9)]">
        <div className="mx-auto grid max-w-7xl gap-2 px-3 py-1.5 sm:px-6 sm:py-2 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:px-8">
          <div className="flex items-center justify-start gap-3">
            <Link href="/" className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">
              ← Home
            </Link>
          </div>
          <div className="flex items-center justify-center gap-2 text-center">
            <BrandLogo size="mini" />
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-red-500 sm:text-[10px] sm:tracking-[0.32em]">Tamil Live TV</p>
          </div>
          <button
            type="button"
            onClick={() => setServiceOpen(true)}
            className="mr-14 justify-self-end rounded-full border border-purple-300/25 bg-purple-500/10 px-2.5 py-1.5 text-[11px] font-black text-purple-200 transition hover:border-purple-300/70 sm:mr-[4.75rem]"
            title="Live TV Service Panel"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="mx-auto flex max-w-7xl flex-col items-stretch gap-3 px-3 py-3 sm:gap-4 sm:px-6 sm:py-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,22rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(320px,24rem)] lg:px-8">
        <div className="contents min-w-0 space-y-3 sm:space-y-4 lg:block lg:min-h-0 lg:sticky lg:top-[calc(var(--live-header-h,84px)+1rem)] lg:self-start lg:space-y-3">
          {/* R1 phone row: the live tile and one line of guide share a single sticky strip, so the
              channel, what is on and the minutes left are all above the fold while the video keeps its
              16:9 letterbox. One <video> in a flex container — the guide is a neighbour, never a wrapper,
              because a wrapper that re-renders around the player is how a seek restarts a Telegram file.
              At >=sm the strip is a plain column again and the card sits under the player. */}
          <div className={`sticky top-0 z-40 flex flex-col gap-2 sm:top-[var(--live-header-h,84px)] lg:static ${guideCompact ? 'max-sm:flex-row max-sm:items-stretch' : ''}`}>
            <div id="live-player-shell" className={`overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50 fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:rounded-none fullscreen:border-0 sm:rounded-3xl ${guideCompact ? 'max-sm:w-[54%] max-sm:shrink-0 max-sm:self-center' : ''}`}>
            <div className="relative aspect-video h-full w-full bg-black fullscreen:h-[100dvh] fullscreen:w-[100dvw] fullscreen:aspect-auto">
              {active?.playable && livePolicy ? (
                <JashPlayer
                  source={{ url: active.url, kind: 'auto', label: active.name }}
                  playbackPolicy={livePolicy}
                  poster={active.logo || ''}
                  live
                  liveLabel="LIVE"
                  display={{
                    title: active.name || 'Tamil Live TV',
                    subtitle: `${active.source || 'Jio'} • ${(active.format || 'HLS').toUpperCase()}${active.keyId && active.key ? ' • ClearKey' : ''}`,
                    aspect: 'fill',
                  }}
                  // The watchKey keeps each channel its own source identity (so a tune re-attaches
                  // cleanly) but `persist: false` keeps live TV out of Continue Watching: a simulcast
                  // has nothing to resume, and it used to store an "Untitled" row for it.
                  library={{ watchKey: `live:${active.id}`, persist: false }}
                  onPrev={() => navigateChannel(-1)}
                  onNext={() => navigateChannel(1)}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center">
                  <div>
                    <p className="text-xl font-black text-white">{active ? 'Channel unavailable' : 'Choose a channel'}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      {active ? 'This feed is not marked playable. Try another channel or switch catalog.' : 'Tamil preferred channels will appear on the right.'}
                    </p>
                  </div>
                </div>
              )}

              </div>
            </div>
            {guideCompact ? (
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 self-center py-0.5">
                <p className="truncate text-[11px] font-black text-white">{active?.name || 'Tamil Live TV'}</p>
                <GuideNowLine row={guide.get(active?.id)} at={guide.at} />
                <div className="flex items-center gap-1.5">
                  <SourceBadges channel={active || {}} row={guide.get(active?.id)} />
                  <button
                    type="button"
                    onClick={toggleGuideRow}
                    className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-[11px] font-black text-white transition hover:border-fuchsia-400/60"
                    title="Put the guide back under the player"
                    aria-label="Expand the guide below the player"
                  >
                    ⤢
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3 sm:rounded-3xl sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5"><h1 className="truncate text-xl font-black text-white sm:text-2xl">{active?.name || 'Tamil Live TV'}</h1></div>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-zinc-400 sm:text-sm">
                  <span className="truncate">{active ? `${getChannelCatalogIds(active).map(catalogLabel).join(' + ') || 'Initial Jio'} • ${active.source || 'Jio'}${active.keyId && active.key ? ' • ClearKey DRM' : ''}` : `Loaded ${channels.length} manually mapped channels`}</span>
                  <button
                    type="button"
                    onClick={toggleGuideRow}
                    className="shrink-0 rounded-full border border-white/12 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-300 sm:hidden"
                    title="Put the guide beside the player"
                  >
                    {guideCompact ? 'below' : 'beside'}
                  </button>
                </p>
                <ProgrammeCard
                  className="mt-2.5"
                  loading={guide.loading}
                  row={guide.get(active?.id)}
                  channel={active || {}}
                  status={guide.status}
                  at={guide.at}
                  onOpenPanel={() => setServiceOpen(true)}
                />
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
              {lastViewed?.name ? <p className="truncate px-1 text-[10px] font-semibold text-zinc-400 sm:text-xs">Last viewed: {lastViewed.name}</p> : null}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <button onClick={enterFullscreen} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white transition hover:border-red-500/50">Fullscreen</button>
                <button onClick={copyUrl} disabled={!active?.url} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white transition hover:border-red-500/50 disabled:opacity-40">Copy stream URL</button>
              </div>
            </div>
          </div>

          <DayStrip row={guide.get(active?.id)} at={guide.at} loading={guide.loading} />
        </div>

        <aside className="min-w-0 space-y-3 lg:w-full">
          <div className="sticky top-[7.7rem] z-30 rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-[0_18px_40px_-16px_rgba(0,0,0,.85)] sm:rounded-3xl sm:p-4 lg:static lg:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-200">My catalogs</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setServiceOpen(true)}
                  className="rounded-full border border-purple-300/25 bg-purple-500/10 px-2 py-0.5 text-[10px] font-black text-purple-100 sm:hidden"
                  title="Live TV Service Panel"
                >
                  ⚙
                </button>
                <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-zinc-400">{filteredChannels.length}</span>
              </div>
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
            <div className="mt-2 border-t border-white/[0.06] pt-2">
              <GuideStatus status={guide.status} linked={guideCoverage.linked} unlinked={guideCoverage.unlinked} onRefresh={refreshGuideFeed} refreshing={guideRefreshing} />
            </div>
          </div>

          {/* Quick Favorites Strip */}
          {favorites.length > 0 ? (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-yellow-400 shrink-0">★ Favs:</span>
              {channels.filter((c) => c?.id && favoriteSet.has(c.id)).slice(0, 8).map((favCh) => (
                <button
                  key={`fav-${favCh.id}`}
                  type="button"
                  onClick={() => selectChannel(favCh)}
                  className={`flex items-center gap-1.5 shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
                    active?.id === favCh.id
                      ? 'border-red-500 bg-red-600/30 text-white shadow-sm shadow-red-950'
                      : 'border-white/10 bg-zinc-900/80 text-zinc-300 hover:border-yellow-400/50 hover:text-white'
                  }`}
                >
                  <span className="truncate max-w-[100px]">{favCh.name || 'Channel'}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-2 pr-1 lg:max-h-[70dvh] lg:overflow-y-auto">
            {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">Loading Tamil channels...</div> : null}
            {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-center text-red-200">{error}</div> : null}
            {status === 'ready' && filteredChannels.length === 0 ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">No manually mapped channels in this catalog.</div> : null}

            {filteredChannels.map((channel) => {
              if (!channel) return null;
              const isFav = channel.id && favoriteSet.has(channel.id);
              const isActive = active?.id === channel.id;
              return (
                <div
                  key={channel.id}
                  className={`group/ch flex items-center gap-3 rounded-2xl border p-2.5 transition sm:rounded-3xl sm:p-3 ${
                    isActive
                      ? 'border-red-500/80 bg-gradient-to-r from-red-600/20 via-purple-600/10 to-zinc-950 shadow-lg shadow-red-950/30'
                      : 'border-white/10 bg-zinc-950/80 hover:border-white/30 hover:bg-zinc-900/90'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectChannel(channel)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
                  >
                    <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/5 sm:h-14 sm:w-14 sm:rounded-2xl">
                      {channel.logo ? <img src={channel.logo} alt="" className="max-h-full max-w-full object-fill" loading="lazy" /> : <span className="text-xs font-black text-zinc-500">TV</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      {/* The active row is already unmistakable (red border, gradient wash, white title),
                          and the player carries the one LIVE marker this page needs — a pulsing dot here
                          was a second "live" symbol for the same channel. */}
                      <p className={`truncate text-sm font-black ${isActive ? 'text-white' : 'text-zinc-100'}`}>{channel.name || 'Channel'}</p>
                      <p className="mt-1 truncate text-xs text-zinc-400">{getChannelCatalogIds(channel).map(catalogLabel).join(' + ') || 'Initial Jio'} • {channel.source || 'Jio'}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${channel.playable ? 'bg-green-500/15 text-green-300 border border-green-500/20' : 'bg-orange-500/15 text-orange-300 border border-orange-500/20'}`}>{(channel.format || 'HLS').toUpperCase()}</span>
                          {channel.keyId && channel.key ? <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[9px] font-black text-blue-200 border border-blue-500/20">DRM</span> : null}
                        </span>
                        <SourceBadges channel={channel} row={guide.get(channel.id)} />
                      </div>
                      <GuideNowLine row={guide.get(channel.id)} at={guide.at} className="mt-1.5" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(channel);
                    }}
                    className={`grid h-8 w-8 place-items-center rounded-xl border transition ${
                      isFav
                        ? 'border-yellow-400/50 bg-yellow-500/20 text-yellow-300'
                        : 'border-white/10 bg-white/5 text-zinc-500 hover:border-yellow-400/40 hover:text-yellow-200'
                    }`}
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </section>
      <LiveServicePanel
        open={serviceOpen}
        epg={{
          rows: guide.rows,
          status: guide.status,
          error: guide.error,
          linked: guideCoverage.linked,
          unlinked: guideCoverage.unlinked,
          refresh: refreshGuideFeed,
          refreshing: guideRefreshing,
        }}
        onClose={() => { setServiceOpen(false); loadChannelsForSource(); }}
        onPreview={(channel) => selectChannel(channel)}
        onMainRefresh={() => loadChannelsForSource('all')}
      />
    </main>
  );
}

const SERVICE_TOKEN_KEY = 'jash_live_service_token';
/**
 * How many channel rows the service panel puts on screen at once.
 *
 * A fresh source can carry 5,000 channels and every row is ~12 buttons, so mounting the whole list
 * blocked the main thread for seconds — "the panel froze" was never the network, it was React. The
 * manual-mapping list is therefore paged by the API (limit/page/q, which the route already supported),
 * and the remaining lists grow in these steps on demand.
 */
const PANEL_PAGE_SIZE = 200;
const ROW_STEP = 400;

/**
 * Guide (EPG) tab of the live service panel: the feed's health, how much of the published lineup
 * resolves to it, and the manual binding picker for the rest.
 *
 * Two rules, both learned from this app being a single-tenant free-tier box:
 *  • the only write here is `tvgId` on the channel document — the guide index is never persisted, so
 *    a mapping costs one PATCH and nothing else;
 *  • the lookup is served from the already-parsed day index (in memory, one hour TTL), so opening
 *    this tab does not download a 65 MB feed. "Refresh feed now" is the one button that does, and it
 *    goes through the same single-flight cache the page polls, so it cannot stack up.
 */
function LiveEpgPanel({ channels = [], onAction, epg = null }) {
  const [scope, setScope] = useState('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const status = epg?.status || null;

  const rows = useMemo(() => {
    const needle = normalize(query);
    return channels
      .filter((channel) => channel.channelId || channel.id)
      .map((channel) => ({ channel, row: epg?.rows?.get?.(channel.channelId || channel.id) || null }))
      .filter(({ channel, row }) => {
        if (scope === 'unlinked' && row?.matched) return false;
        if (scope === 'linked' && !row?.matched) return false;
        if (!needle) return true;
        return normalize(`${channel.name} ${channel.tvgId || ''} ${row?.epgName || ''}`).includes(needle);
      });
  }, [channels, epg?.rows, scope, query]);

  useEffect(() => {
    const value = term.trim();
    if (value.length < 2) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/live-epg/guide?lookup=${encodeURIComponent(value)}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        setResults(data.results || []);
        if (!response.ok || data.ok === false) setNote(data.error || 'Guide lookup failed');
      } catch (error) {
        if (!cancelled) {
          setResults([]);
          setNote(`Guide lookup failed: ${error.message || 'unknown error'}`);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250); // the feed carries 1,190 names; one request per keystroke would be pointless work
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [term]);

  async function bind(channel, epgId, epgName) {
    try {
      await onAction?.(channel, 'setEpg', { epgId, epgName });
      setEditing('');
      setTerm('');
      setResults([]);
      setNote(epgId ? `${channel.name} → ${epgName || epgId}. The next guide poll picks it up.` : `${channel.name} unlinked from the guide.`);
    } catch (error) {
      setNote(error.message || 'Could not save the guide binding');
    }
  }

  const linked = epg?.linked ?? 0;
  const unlinked = epg?.unlinked ?? 0;
  const ageMinutes = status?.ageMs != null ? Math.round(status.ageMs / 60000) : null;

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black text-white">Live TV guide (XMLTV)</p>
            <p className="mt-1 text-xs leading-5 text-zinc-400">
              Pocket-EPG is fetched once per hour and parsed once per day; <code className="rounded bg-black/50 px-1">LIVE_EPG_URL</code> overrides the feed and <code className="rounded bg-black/50 px-1">LIVE_EPG_TTL_MS</code> the interval.
              Nothing lands in MongoDB — a listing is derived data, so a refresh can always redo it.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-zinc-300">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-200">{linked} linked</span>
              <span className={`rounded-full px-2 py-0.5 ${unlinked ? 'bg-orange-500/15 text-orange-200' : 'bg-white/[0.06] text-zinc-400'}`}>{unlinked} to map</span>
              <span className="text-zinc-500">
                {ageMinutes == null ? 'index loading' : `index ${ageMinutes} min old`}
                {status?.feedChannels ? ` • ${status.feedChannels} feed channels` : ''}
                {status?.feedBytes ? ` • ${(status.feedBytes / 1e6).toFixed(1)} MB` : ''}
              </span>
            </p>
            {status?.url ? <p className="mt-1 truncate text-[10px] font-semibold text-zinc-500">{status.url}</p> : null}
            {status?.error ? <p className="mt-1 text-[11px] font-bold text-orange-300">last fetch failed: {status.error} (serving the previous listing)</p> : null}
          </div>
          <button
            onClick={epg?.refresh}
            disabled={!epg?.refresh || epg?.refreshing}
            className="rounded-2xl border border-purple-300/30 bg-purple-500/10 px-3 py-2 text-xs font-black text-purple-100 transition hover:border-purple-300/70 disabled:opacity-50"
            title="Re-download the feed now. Shares the page's single-flight cache, so it cannot stack up."
          >
            {epg?.refreshing ? 'Refreshing…' : 'Refresh feed now'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[['all', `All · ${channels.length}`], ['unlinked', `Needs mapping · ${unlinked}`], ['linked', `Linked · ${linked}`]].map(([id, label]) => (
          <button key={id} onClick={() => setScope(id)} className={`rounded-2xl border px-3 py-1.5 text-xs font-black transition ${scope === id ? 'border-purple-400 bg-purple-500/20 text-purple-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}>{label}</button>
        ))}
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by channel" className="min-w-[10rem] flex-1 rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-purple-400" />
      </div>

      {note ? <p className="rounded-2xl bg-white/[0.04] p-3 text-xs leading-5 text-zinc-300">{note}</p> : null}
      {!channels.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No published channels for this profile yet — map channels first, then bind them to the guide.</p> : null}

      <div className="space-y-2">
        {rows.map(({ channel, row }) => (
          <div key={channel.channelId || channel.id} className="rounded-3xl border border-white/10 bg-black/25 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{channel.name}</p>
                <p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-500">
                  {channel.source || 'source'}
                  {channel.tvgId ? ` • bound to ${channel.tvgId}` : ' • no explicit binding'}
                  {row?.matched && row.via !== 'tvgId' ? ` • matched by ${row.via} → ${row.epgName || row.epgId}` : ''}
                </p>
                {row?.now ? <p className="mt-0.5 truncate text-[11px] font-bold text-zinc-300">now: {row.now.title}</p> : null}
              </div>
              <button
                onClick={() => { setEditing(editing === (channel.channelId || channel.id) ? '' : (channel.channelId || channel.id)); setTerm(''); setResults([]); setNote(''); }}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-purple-300/60"
              >
                {row?.matched ? 'Change binding' : 'Map guide'}
              </button>
              {channel.tvgId ? (
                <button onClick={() => bind(channel, '', '')} className="rounded-2xl border border-white/10 px-3 py-2 text-xs font-black text-zinc-400 transition hover:border-orange-300/60 hover:text-orange-200" title="Drop the explicit binding and fall back to name matching">
                  Unlink
                </button>
              ) : null}
            </div>

            {editing === (channel.channelId || channel.id) ? (
              <div className="mt-3 rounded-2xl border border-purple-300/20 bg-purple-500/[0.06] p-3">
                <input
                  autoFocus
                  value={term}
                  onChange={(event) => setTerm(event.target.value)}
                  placeholder="Search the guide feed by name (2+ characters)"
                  className="w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-purple-400"
                />
                <p className="mt-2 text-[11px] font-semibold text-zinc-400">
                  {searching ? 'Searching the parsed feed…' : term.trim().length < 2 ? 'Type at least two characters. Results come from the same day index the page uses.' : results.length ? `${results.length} match${results.length > 1 ? 'es' : ''}` : 'Nothing in the feed matches that name.'}
                </p>
                {results.length ? (
                  <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
                    {results.map((item) => (
                      <button key={item.id} onClick={() => bind(channel, item.id, item.name)} className="flex w-full items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-purple-300/60">
                        {item.logo ? <img src={item.logo} alt="" className="h-6 w-6 shrink-0 rounded bg-black object-contain" loading="lazy" /> : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-white">{item.name}</span>
                          <span className="block truncate text-[10px] font-semibold text-zinc-500">id {item.id}</span>
                        </span>
                        {item.id === channel.tvgId ? <span className="shrink-0 rounded-full bg-purple-500/20 px-2 py-0.5 text-[9px] font-black text-purple-100">current</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ServicePreviewPlayer({ channel }) {
  // Same policy as the main panel, so a preview that works is a channel that
  // will play (and a preview that fails says why in the same words).
  const policy = useMemo(() => (channel?.url ? createLiveTvPolicy(channel) : null), [channel]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-black">
      {/* `relative` + an explicit aspect box: the compact player fills this rather than sizing itself,
          and without a positioned parent the absolute video/controls had nothing to sit in. */}
      <div className="relative aspect-video bg-black">
        {channel?.url && policy ? (
          <JashPlayer
            source={{ url: channel.url, kind: 'auto', label: channel.name }}
            playbackPolicy={policy}
            poster={channel.logo || ''}
            live
            liveLabel="PREVIEW"
            compact
            gesturesEnabled={false}
            display={{ title: channel.name || 'Preview', aspect: 'fill', bufferAheadSeconds: 6 }}
          />
        ) : (
          <div className="grid h-full place-items-center px-4 text-center text-xs font-semibold leading-5 text-zinc-500">
            {channel ? `${channel.name || 'This channel'} has no stream URL to preview` : 'Pick Preview on any channel row'}
          </div>
        )}
      </div>
      <div className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-400">
        {channel?.name || 'No preview'}
        {channel?.format ? ` • ${(channel.format || '').toUpperCase()}` : ''}
      </div>
    </div>
  );
}

function LiveServicePanel({ open, onClose, onPreview, onMainRefresh, epg = null }) {
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
  const [channelsPage, setChannelsPage] = useState(1);
  const [channelsPageInfo, setChannelsPageInfo] = useState({ total: 0, hasMore: false });
  // The search box and both selects are applied by the API, not in the browser: a channel on row
  // 4,300 of a 5,000-row source is otherwise unreachable, and re-filtering thousands of rows on every
  // keystroke is what made the panel feel stuck while typing. This token records exactly which filters
  // the mounted page answers to, so `channelRowsFiltered` never filters twice with different rules.
  const [serverFilter, setServerFilter] = useState(null);
  const [rowLimit, setRowLimit] = useState(ROW_STEP);
  const [channelStats, setChannelStats] = useState({ total: 0, mapped: 0, unmapped: 0 });
  const [orderCatalog, setOrderCatalog] = useState('main');
  const [activeProfile, setActiveProfile] = useState('default');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [previewChannel, setPreviewChannel] = useState(null);
  const [sourceForm, setSourceForm] = useState({ label: '', url: '', type: 'm3u', priority: 50 });
  const [importText, setImportText] = useState('');
  const [jioCookieText, setJioCookieText] = useState('');
  const [jioTokenStatus, setJioTokenStatus] = useState('');

  useEffect(() => {
    if (!open) return;
    try { setToken(window.sessionStorage.getItem(SERVICE_TOKEN_KEY) || ''); } catch {}
    try {
      const savedCookie = normalizeJioCookie(window.localStorage.getItem(JIO_COOKIE_OVERRIDE_KEY) || '');
      setJioCookieText(savedCookie);
      const expiresAt = getJioCookieExpiry(savedCookie);
      setJioTokenStatus(savedCookie
        ? isJioCookieValid(savedCookie)
          ? `Browser override active${expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ''}.`
          : 'Saved browser override is expired.'
        : 'Automatic public token mode is active.');
    } catch {}
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

  async function loadChannels({ mapped = false, sourceId = sourceFilter, page = 1, q = '', map = '', category = '' } = {}) {
    if (!token) return;
    const needle = String(q || '').trim();
    const params = new URLSearchParams({ limit: mapped ? '1000' : String(PANEL_PAGE_SIZE) });
    if (mapped) {
      params.set('mapped', '1');
      params.set('profile', activeProfile);
    } else {
      if (!sourceId) {
        setChannels([]);
        setCategories([]);
        setChannelsLoaded(false);
        setChannelStats({ total: 0, mapped: 0, unmapped: 0 });
        setChannelsPageInfo({ total: 0, hasMore: false });
        setServerFilter(null);
        return;
      }
      params.set('sourceId', sourceId);
      params.set('page', String(Math.max(1, Number(page) || 1)));
      if (needle) params.set('q', needle);
      if (map === 'mapped') params.set('mapped', '1');
      if (map === 'unmapped') params.set('mapped', '0');
      if (category) params.set('category', category);
    }

    const data = await api(`/api/live-service/channels?${params.toString()}`);
    if (mapped) {
      setSelectedChannels(data.channels || []);
    } else {
      setChannelsPage(Number(data.page) || Math.max(1, Number(page) || 1));
      setChannelsPageInfo({ total: Number(data.sourceTotal ?? data.total) || 0, hasMore: Boolean(data.hasMore) });
      setServerFilter({ q: needle, map, category, page: Number(data.page) || Math.max(1, Number(page) || 1) });
      // The stats line is the server's count for the source, not the page in front of us.
      setChannelStats((current) => ({ ...current, total: Number(data.sourceTotal ?? data.total) || current.total }));
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
      await loadChannels({ sourceId: sourceFilter, page: 1, q: channelQuery, map: mappingFilter, category: categoryFilter });
      setMessage(`First ${PANEL_PAGE_SIZE} channels loaded. Search or page through the rest — the whole catalog is never mounted at once.`);
    } catch (err) {
      setMessage(err.message || 'Unable to load source channels');
    } finally {
      setLoading(false);
    }
  }

  // The search box goes to the API instead of filtering a loaded page: a name that lives on row
  // 4,300 of a 5,000-channel source is otherwise unreachable, and re-filtering 5,000 objects on
  // every keystroke is what made the panel feel stuck while typing.
  useEffect(() => {
    if (!open || tab !== 'channels' || !channelsLoaded || !sourceFilter) return undefined;
    const q = channelQuery.trim();
    if (serverFilter && serverFilter.q === q && serverFilter.map === mappingFilter && serverFilter.category === categoryFilter && serverFilter.page === 1) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      loadChannels({ sourceId: sourceFilter, page: 1, q, map: mappingFilter, category: categoryFilter }).catch(() => {});
    }, 320);
    return () => window.clearTimeout(timer);
    // loadChannels is recreated per render on purpose; the deps above are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelQuery, mappingFilter, categoryFilter, open, tab, channelsLoaded, sourceFilter]);

  // A new tab or a new filter should never inherit a half-scrolled 800-row list.
  useEffect(() => {
    setRowLimit(ROW_STEP);
  }, [tab, orderCatalog, mainPanelCategory, mainPanelSource, channelQuery, mappingFilter, categoryFilter]);

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

  // Runs when the panel opens or the token changes, not when the loaders below
  // are re-created — that is the point, so keep the dependency list short.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setChannelsPage(1);
    setChannelsPageInfo({ total: 0, hasMore: false });
    setServerFilter(null);
  }, [sourceFilter]);
  // Same reason as above: a profile switch reloads the table once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setMessage(action === 'setEpg'
        ? `${updated.name} guide binding saved. Listings refresh with the next guide poll.`
        : action === 'swapCatalogPosition'
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

  function saveJioCookieOverride() {
    const cookie = normalizeJioCookie(jioCookieText);
    if (!cookie || !isJioCookieValid(cookie)) {
      setJioTokenStatus('Invalid or expired token. Paste the complete __hdnea__=st=…~exp=…~acl=…~hmac=… value.');
      return;
    }
    window.localStorage.setItem(JIO_COOKIE_OVERRIDE_KEY, cookie);
    setJioCookieText(cookie);
    const expiresAt = getJioCookieExpiry(cookie);
    setJioTokenStatus(`Browser override saved${expiresAt ? `; valid until ${new Date(expiresAt).toLocaleString()}` : ''}.`);
    setMessage('Jio browser token saved. Close the service panel or reselect the channel to retry playback.');
  }

  function clearJioCookieOverride() {
    window.localStorage.removeItem(JIO_COOKIE_OVERRIDE_KEY);
    setJioCookieText('');
    setJioTokenStatus('Browser override cleared. Automatic public token mode is active.');
    setMessage('Jio override cleared.');
  }

  async function checkAutomaticJioToken() {
    try {
      setJioTokenStatus('Refreshing automatic Jio token…');
      const response = await fetch('/api/live-jio?force=1', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.available) throw new Error(data.error || 'No token available');
      const expiresAt = Number(data.expiresAtMs || 0);
      setJioTokenStatus(`Automatic token available${expiresAt ? ` until ${new Date(expiresAt).toLocaleString()}` : ''}.`);
    } catch (err) {
      setJioTokenStatus(`Automatic token check failed: ${err.message || 'unknown error'}`);
    }
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
    const applied = Boolean(serverFilter)
      && serverFilter.q === channelQuery.trim()
      && serverFilter.map === mappingFilter
      && serverFilter.category === categoryFilter;
    if (applied) return channels; // the page in hand is already the answer
    const q = normalize(channelQuery);
    return channels.filter((channel) => {
      const mapped = Boolean(channel.mapped || getChannelCatalogIds(channel).length);
      if (mappingFilter === 'mapped' && !mapped) return false;
      if (mappingFilter === 'unmapped' && mapped) return false;
      if (categoryFilter && channel.category !== categoryFilter) return false;
      if (!q) return true;
      return normalize(`${channel.name} ${channel.category} ${channel.source}`).includes(q);
    });
  }, [channels, channelQuery, mappingFilter, categoryFilter, serverFilter]);
  const orderedCatalogChannels = useMemo(() => {
    return sortChannelsForCatalog(
      selectedChannels.filter((channel) => getChannelCatalogIds(channel).includes(orderCatalog)),
      orderCatalog,
    );
  }, [selectedChannels, orderCatalog]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/75 p-2 backdrop-blur-xl sm:p-4">
      <section className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[1.6rem] border border-purple-300/20 bg-zinc-950 text-white shadow-2xl sm:rounded-[2rem]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div><h2 className="text-lg font-black sm:text-2xl">Live TV Service Panel</h2><p className="text-[11px] text-zinc-500">Manual catalogs • source-on-demand loading • per-catalog order</p></div>
          <button type="button" onClick={onClose} aria-label="Close service panel" title="Close" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-2xl font-black leading-none text-white transition hover:border-red-400 hover:bg-red-500/80">✕</button>
        </div>

        {!token ? (
          <form onSubmit={unlock} className="m-auto w-full max-w-sm rounded-3xl border border-white/10 bg-black/35 p-5">
            <p className="text-sm font-bold text-zinc-300">Enter password to manage Live TV services.</p>
            <input type="password" name="live-service-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" spellCheck={false} autoFocus className="mt-4 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none" placeholder="Service password" />
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
                  ['epg', 'Guide (EPG)'],
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
                  <p className="text-xs text-zinc-500">
                    Page {channelsPage} • {channelRowsFiltered.length} of {channelsPageInfo.total || channelStats.total || '?'} channels on this source
                    {serverFilter?.q ? ` • search: “${serverFilter.q}”` : ''}
                    {serverFilter && serverFilter.map !== 'all' ? ` • ${serverFilter.map}` : ''}
                  </p>
                  {channelRowsFiltered.map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                  <PanelPager
                    page={channelsPage}
                    total={channelsPageInfo.total || channelStats.total || 0}
                    pageSize={PANEL_PAGE_SIZE}
                    hasMore={channelsPageInfo.hasMore}
                    loading={loading}
                    onPrev={() => loadChannels({ sourceId: sourceFilter, page: channelsPage - 1, q: channelQuery, map: mappingFilter, category: categoryFilter }).catch(() => {})}
                    onNext={() => loadChannels({ sourceId: sourceFilter, page: channelsPage + 1, q: channelQuery, map: mappingFilter, category: categoryFilter }).catch(() => {})}
                  />
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
                {mainPanelFiltered.slice(0, rowLimit).map((channel) => <ChannelManagerRow key={channel.channelId || channel.id} channel={channel} selectedMode positionCatalog={mainPanelCategory === 'all' ? '' : mainPanelCategory} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} />)}
                {mainPanelFiltered.length > rowLimit ? <RowShowMore shown={rowLimit} total={mainPanelFiltered.length} onMore={() => startTransition(() => setRowLimit((current) => current + ROW_STEP))} /> : null}
                {!mainPanelFiltered.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No main panel channels for this filter.</p> : null}
              </div> : null}

              {tab === 'selected' ? <div className="space-y-3">
                <div className="rounded-3xl border border-purple-300/20 bg-purple-500/10 p-3">
                  <p className="text-sm font-black text-white">Per-catalog channel order</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">A channel can have a different position in every catalog. Use arrows for quick changes or click its position badge to enter an exact number.</p>
                  <select value={orderCatalog} onChange={(event) => setOrderCatalog(event.target.value)} className="mt-3 w-full rounded-2xl border border-white/10 bg-black px-3 py-2 text-sm text-white sm:max-w-xs">{LIVE_CATALOGS.map((catalog) => <option key={catalog.id} value={catalog.id}>{catalog.name}</option>)}</select>
                </div>
                {orderedCatalogChannels.slice(0, rowLimit).map((channel) => <ChannelManagerRow key={channel.channelId} channel={channel} selectedMode positionCatalog={orderCatalog} onPreview={(ch) => { setPreviewChannel(ch); onPreview?.(ch); }} onAction={channelAction} onCatalogToggle={toggleCatalog} onPosition={setCatalogPosition} onUp={(ch) => reorder(ch, -10)} onDown={(ch) => reorder(ch, 10)} />)}
                {orderedCatalogChannels.length > rowLimit ? <RowShowMore shown={rowLimit} total={orderedCatalogChannels.length} onMore={() => startTransition(() => setRowLimit((current) => current + ROW_STEP))} /> : null}
                {!orderedCatalogChannels.length ? <p className="rounded-2xl border border-white/10 p-5 text-center text-sm text-zinc-500">No channels mapped to {catalogLabel(orderCatalog)}.</p> : null}
              </div> : null}

              {tab === 'tools' ? <div className="space-y-4">
                <PlayerIncidents />
                <div className="rounded-3xl border border-yellow-300/20 bg-yellow-500/[0.07] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><p className="text-sm font-black text-yellow-100">Jio playback token</p><p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">Playback automatically refreshes the public Stream4Liv-compatible token. If that feed is down, paste a current <code>__hdnea__</code> token here. The override stays only in this browser.</p></div>
                    <button type="button" onClick={checkAutomaticJioToken} className="rounded-full border border-yellow-300/30 px-3 py-1.5 text-xs font-black text-yellow-100">Check automatic token</button>
                  </div>
                  <textarea value={jioCookieText} onChange={(event) => setJioCookieText(event.target.value)} placeholder="__hdnea__=st=…~exp=…~acl=/*~hmac=…" className="mt-3 h-24 w-full rounded-2xl border border-white/10 bg-black p-3 font-mono text-xs text-white outline-none focus:border-yellow-400" />
                  <div className="mt-2 flex flex-wrap items-center gap-2"><button type="button" onClick={saveJioCookieOverride} className="rounded-full bg-yellow-400 px-4 py-2 text-xs font-black text-black">Save Jio override</button><button type="button" onClick={clearJioCookieOverride} className="rounded-full border border-white/10 px-4 py-2 text-xs font-black text-zinc-300">Use automatic token</button></div>
                  {jioTokenStatus ? <p className="mt-3 rounded-xl bg-black/25 p-2 text-xs text-zinc-300">{jioTokenStatus}</p> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><button onClick={() => purge('unused')} className="rounded-2xl bg-red-500 px-4 py-3 text-sm font-black text-white">Purge unused</button><button onClick={() => purge('broken')} className="rounded-2xl border border-red-400/30 px-4 py-3 text-sm font-black text-red-200">Purge broken</button><button onClick={checkBroken} className="rounded-2xl border border-green-400/30 px-4 py-3 text-sm font-black text-green-200">Check broken</button><button onClick={loadDuplicates} className="rounded-2xl border border-yellow-400/30 px-4 py-3 text-sm font-black text-yellow-100">Find duplicates</button><button onClick={addProfile} className="rounded-2xl border border-purple-400/30 px-4 py-3 text-sm font-black text-purple-100">Add profile</button><button onClick={exportBackup} className="rounded-2xl border border-white/10 px-4 py-3 text-sm font-black">Export backup</button></div>
                <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste exported JSON backup here" className="h-36 w-full rounded-2xl border border-white/10 bg-black p-3 text-xs text-white" />
                <button onClick={importBackup} className="rounded-2xl bg-purple-500 px-4 py-3 text-sm font-black text-black">Import backup</button>
              </div> : null}

              {tab === 'epg' ? <LiveEpgPanel channels={selectedChannels} onAction={channelAction} epg={epg} /> : null}
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

/**
 * Page stepper for the server-paged source catalog. Nothing here fetches on its own: the panel keeps
 * one request per page so a 5,000-channel source is browsable without ever mounting the whole thing.
 */
function PanelPager({ page = 1, total = 0, pageSize = 0, hasMore = false, loading = false, onPrev, onNext }) {
  const lastPage = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : page;
  if (total <= pageSize && page <= 1 && !hasMore) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-zinc-300">
      <span className="text-zinc-500">
        page {page} / {lastPage} • {total ? `${Math.min(total, (page - 1) * pageSize + 1)}–${Math.min(total, page * pageSize)} of ${total}` : 'counting…'}
      </span>
      <span className="flex items-center gap-1.5">
        <button type="button" onClick={onPrev} disabled={loading || page <= 1} className="rounded-full border border-white/10 px-3 py-1 font-black transition hover:border-purple-300/60 disabled:opacity-35">‹ Prev</button>
        <button type="button" onClick={onNext} disabled={loading || !hasMore} className="rounded-full border border-white/10 px-3 py-1 font-black transition hover:border-purple-300/60 disabled:opacity-35">Next ›</button>
      </span>
    </div>
  );
}

/** Deliberately not "load everything": the button says how much is waiting so it is a choice, not a trap. */
function RowShowMore({ shown = 0, total = 0, onMore }) {
  const left = Math.max(0, total - shown);
  if (!left) return null;
  return (
    <button type="button" onClick={onMore} className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-zinc-300 transition hover:border-purple-300/60">
      Show {Math.min(left, ROW_STEP)} more · {left} still hidden
    </button>
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
