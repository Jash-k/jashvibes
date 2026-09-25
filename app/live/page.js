'use client';

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { DayStrip, GuideNowLine, GuideStatus, ProgrammeCard, SourceBadges, showProgress, useLiveGuide } from '@/components/live/LiveGuide';
import { createLiveTvPolicy, isPocketChannel } from '@/lib/player/policy/liveTv';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  LIVE_CATALOGS,
  catalogLabel,
  getChannelCatalogIds,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';

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
  // Phone-only: the guide strip sits beside the live tile instead of below it. Persisted, because the
  // choice is per-device — a desktop has no reason to inherit it, and a page that re-stacks itself on
  // reload loses the place the viewer came back to.
  const [guideCompact, setGuideCompact] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  // The in-player guide and its tuning callback. The policy object is frozen on purpose: `policy`
  // is an engine-memo dependency, so a fresh literal every render would restart playback.
  const shellPolicy = useMemo(() => ({ ambient: false }), []);
  const browserItems = useMemo(
    () =>
      (channels || []).map((channel) => {
        const row = guide.get(channel.id);
        const show = row?.now || row?.lastEnded || null;
        return {
          id: channel.id,
          name: channel.name,
          logo: channel.logo,
          catalogs: getChannelCatalogIds(channel),
          nowTitle: show?.title || '',
          progress: row?.now ? showProgress(row.now, guide.at) : show ? 1 : 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels, guide.rows, guide.at],
  );
  const pickBrowserItem = useCallback(
    (item) => {
      const channel = (channels || []).find((row) => String(row?.id) === String(item?.id));
      if (channel) selectChannel(channel);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [channels],
  );
  const liveBrowser = useMemo(
    () => ({ items: browserItems, catalogs: catalogOptions, category, activeId: active?.id || '', onPick: pickBrowserItem, onCategory: setCategory }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browserItems, catalogOptions, category, active?.id, pickBrowserItem],
  );

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
    <main className="palette-cybergrape live-page jv-lv min-h-dvh overflow-x-clip bg-[#09041a] text-zinc-100">
      <header id="live-header" className="hidden sm:block sticky top-0 z-50 border-b border-white/10 bg-zinc-950 shadow-[0_14px_30px_-18px_rgba(0,0,0,.9)]">
        <div className="mx-auto grid max-w-7xl gap-2 px-3 py-1.5 sm:px-6 sm:py-2 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:px-8">
          <div className="flex items-center justify-start gap-3">
            <Link href="/" className="rounded-full border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-zinc-300 transition hover:border-red-500 hover:text-white">
              ← Home
            </Link>
          </div>
          <div className="flex items-center justify-center gap-2 text-center">
            <BrandLogo size="mini" />
            <p className="text-[9px] font-black uppercase tracking-[0.26em] text-red-500 sm:text-[10px] sm:tracking-[0.32em]">Tamil Live TV <span className="ml-1 rounded bg-white/10 px-1 py-px align-middle normal-case tracking-normal text-zinc-500">K5</span></p>
          </div>
          <button
            type="button"
            onClick={() => window.location.assign('/admin?tab=tv')}
            className="mr-14 justify-self-end rounded-full border border-red-400/25 bg-red-500/10 px-2.5 py-1.5 text-[11px] font-black text-red-200 transition hover:border-red-400/70 sm:mr-[4.75rem]"
            title="Live TV Service Panel"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="jv-lv-section mx-auto flex max-w-7xl flex-col items-stretch gap-3 px-3 pt-3 pb-3 sm:gap-4 sm:px-6 sm:pt-5 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)] lg:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)] lg:px-8 lg:pb-5 2xl:max-w-[110rem]">
        <div className="jv-lv-left contents min-w-0 space-y-3 sm:space-y-4 lg:block lg:min-h-0 lg:sticky lg:top-[calc(var(--live-header-h,84px)+1rem)] lg:self-start lg:space-y-3">
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
                  display={{
                    title: active.name || 'Tamil Live TV',
                    subtitle: `${active.source || 'Jio'} • ${(active.format || 'HLS').toUpperCase()}${active.keyId && active.key ? ' • ClearKey' : ''}`,
                    aspect: 'fill',
                  }}
                  // The watchKey keeps each channel its own source identity (so a tune re-attaches
                  // cleanly) but `persist: false` keeps live TV out of Continue Watching: a simulcast
                  // has nothing to resume, and it used to store an "Untitled" row for it.
                  library={{ watchKey: `live:${active.id}`, persist: false }}
                  policy={shellPolicy}
                  liveBrowser={liveBrowser}
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
                    className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-white/15 bg-white/[0.06] text-[11px] font-black text-white transition hover:border-red-400/60"
                    title="Put the guide back under the player"
                    aria-label="Expand the guide below the player"
                  >
                    ⤢
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-3 shrink-0 sm:rounded-3xl sm:p-4">
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
                  onOpenPanel={() => window.location.assign('/admin?tab=tv')}
                />
              </div>
            </div>

            <div className="mt-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMoreOpen((value) => !value)}
                aria-expanded={moreOpen}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-red-500/50"
              >
                {moreOpen ? 'Hide details ▴' : 'Actions · return · today\u2019s guide ▾'}
              </button>
            </div>
            <div className={`${moreOpen ? '' : 'max-lg:hidden'} mt-2 space-y-3 lg:mt-4`}>
            <div className="space-y-2 sm:space-y-3">
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
            <DayStrip row={guide.get(active?.id)} at={guide.at} loading={guide.loading} />
            </div>
          </div>
        </div>

        <aside className="jv-lv-wallcol min-w-0 space-y-3 lg:min-h-0 lg:w-full lg:self-stretch">
          <div className="sticky top-[7.7rem] z-30 rounded-2xl border border-white/10 bg-zinc-950 p-3 shadow-[0_18px_40px_-16px_rgba(0,0,0,.85)] sm:rounded-3xl sm:p-4 lg:static lg:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-200">My catalogs</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => window.location.assign('/admin?tab=tv')}
                  className="rounded-full border border-red-400/25 bg-red-500/10 px-2 py-0.5 text-[10px] font-black text-red-100 sm:hidden"
                  title="Live TV Service Panel"
                >
                  ⚙
                </button>
                <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[10px] font-bold text-zinc-400">{filteredChannels.length}</span>
              </div>
            </div>
            {/* Phones and tablets get one dropdown; the button grid is desktop-only. */}
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Catalog"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-sm font-bold text-white outline-none focus:border-red-500 lg:hidden"
            >
              <option value="all">All · {channels.length}</option>
              {catalogOptions.map((catalog) => (
                <option key={catalog.id} value={catalog.id}>{catalog.icon} {catalog.name} · {catalog.count}</option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-2 gap-2 max-lg:hidden sm:grid-cols-3 lg:grid-cols-2">
              <button
                type="button"
                onClick={() => setCategory('all')}
                className={`rounded-xl border px-2 py-2 text-xs font-black transition ${category === 'all' ? 'border-red-500 bg-red-500/20 text-red-100' : 'border-white/10 bg-white/[0.04] text-zinc-300'}`}
              >
                All · {channels.length}
              </button>
              {catalogOptions.map((catalog) => (
                <button
                  key={catalog.id}
                  type="button"
                  onClick={() => setCategory(catalog.id)}
                  className={`rounded-xl border px-2 py-2 text-xs font-black transition ${category === catalog.id ? 'border-red-500 bg-red-500/20 text-red-100' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/40'}`}
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
                className="min-w-0 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-white outline-none focus:border-red-500"
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

          <div className="jv-lv-wall">
            {status === 'loading' ? <div className="jv-lv-wallnote rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">Loading Tamil channels...</div> : null}
            {status === 'error' ? <div className="jv-lv-wallnote rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-center text-red-200">{error}</div> : null}
            {status === 'ready' && filteredChannels.length === 0 ? <div className="jv-lv-wallnote rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center text-zinc-400">No manually mapped channels in this catalog.</div> : null}

            {filteredChannels.map((channel) => {
              if (!channel) return null;
              const isFav = channel.id && favoriteSet.has(channel.id);
              const isActive = active?.id === channel.id;
              return (
                <div
                  key={channel.id}
                  className={`jv-lv-tile${isActive ? ' is-active' : ''}`}
                  title={channel.name || 'Channel'}
                >
                  <button
                    type="button"
                    onClick={() => selectChannel(channel)}
                    aria-pressed={isActive}
                    aria-label={`Watch ${channel.name || 'Channel'}`}
                    className="jv-lv-tune"
                  >
                    {channel.logo ? <img src={channel.logo} alt="" loading="lazy" /> : <span className="jv-lv-tune-none">TV</span>}
                    <span className="jv-lv-tile-epg" aria-hidden="true">
                      {/* A wall tile is a logo: the name, catalogs, source and badges live in the
                          now-playing card once tuned. The per-row guide line stays mounted (its text
                          hides, its progress hairline shows) so the wall keeps its one live query. */}
                      <GuideNowLine row={guide.get(channel.id)} at={guide.at} />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(channel);
                    }}
                    className={`jv-lv-fav${isFav ? ' is-fav' : ''}`}
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    aria-label={isFav ? `Remove ${channel.name || 'Channel'} from favorites` : `Add ${channel.name || 'Channel'} to favorites`}
                  >
                    ★
                  </button>
                </div>
              );
            })}
          </div>
        </aside>
      </section>
    </main>
  );
}
