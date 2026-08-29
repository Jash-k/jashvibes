'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { chipClassForTier, labelForTier } from '@/lib/quality';
import DirectWatchPlayer from '@/components/player/DirectWatchPlayer';
import Icon from '@/components/Icons';
import {
  getHistoryEntry,
  getLastProvider,
  isFavoriteItem,
  makeWatchKey,
  saveWatchProgress,
  setLastProvider,
  toggleFavoriteItem,
  upsertHistoryEntry,
  useLibraryVersion,
} from '@/lib/watchStore';

function isHlsUrl(url = '') {
  return String(url || '').toLowerCase().includes('.m3u8') || String(url || '').toLowerCase().includes('m3u8');
}

function isDashUrl(url = '') {
  return String(url || '').toLowerCase().includes('.mpd');
}

function isDirectPlayerType(type = '', url = '') {
  return ['hls', 'dash', 'video'].includes(String(type || '').toLowerCase()) || isHlsUrl(url) || isDashUrl(url) || /\.(mp4|webm|mkv)(\?|#|$)/i.test(String(url || ''));
}

function formatDirectPlaybackError(error, resolvedProviderId = '') {
  const message = typeof error === 'string' ? error : (error?.message || '');
  const code = typeof error === 'object' ? error?.code : undefined;
  const data = Array.isArray(error?.data) ? error.data : [];
  const dataText = data.filter((item) => typeof item === 'string' || typeof item === 'number').join(' • ');

  if (code === 1001 || /1001|BAD_HTTP_STATUS|HTTP\s+(4\d\d|5\d\d)/i.test(message)) {
    const statusText = (message.match(/HTTP\s+(4\d\d|5\d\d)/i) || dataText.match(/\b(4\d\d|5\d\d)\b/))?.[1];
    return message || `Direct HLS server returned a bad HTTP status${statusText ? ` (${statusText})` : ''}.`;
  }

  return message || 'Direct player failed. Try another source.';
}

function shouldUseObjectPlayer(provider, streamUrl) {
  // VidSrc works best as a normal unsandboxed iframe with autoplay/fullscreen
  // permissions. Keep <object> only for providers that complain about iframe
  // sandbox detection in some TV browsers.
  const value = String(provider || '').toLowerCase();
  const url = String(streamUrl || '').toLowerCase();
  const isVidSrcMirror =
    value === 'vidsrc' ||
    url.includes('vsembed.ru') ||
    url.includes('vidsrc-embed') ||
    url.includes('vidsrcme') ||
    url.includes('vsrc.su');

  if (isVidSrcMirror) return false;

  return (
    value !== 'screenscape' &&
    (['vidlink', 'vidnest', 'videasy', 'vidzee', 'vidrock'].includes(value) ||
      url.includes('vidlink') ||
      url.includes('vidnest') ||
      url.includes('videasy') ||
      url.includes('vidzee') ||
      url.includes('vidrock'))
  );
}

function getStatusStyle(status) {
  switch (status) {
    case 'available':
      return {
        card: 'border-green-500/50 bg-green-950/20',
        dot: 'bg-green-400',
        text: 'text-green-300',
        label: 'Available',
      };
    case 'failed':
      return {
        card: 'border-red-500/50 bg-red-950/20',
        dot: 'bg-red-400',
        text: 'text-red-300',
        label: 'Failed',
      };
    default:
      return {
        card: 'border-zinc-700 bg-zinc-950/80',
        dot: 'bg-zinc-500',
        text: 'text-zinc-400',
        label: status || 'Status',
      };
  }
}

const WATCH_SERVER_OPTIONS = [
  { id: 'auto', name: 'Auto', label: 'Mirchi → Stremio' },
  { id: 'mirchi', name: 'Global Mirchi', label: 'Embed' },
  { id: 'stremio', name: 'Stremio', label: 'Direct files' },
  { id: 'vidlink', name: 'VidLink', label: 'Embed' },
  { id: 'videasy', name: 'VidEasy', label: 'Embed' },
  { id: 'vidzee', name: 'VidZee', label: 'Backup' },
  { id: 'vidrock', name: 'VidRock', label: 'Tamil first' },
];

function SourceStatusGrid({ attempts, onSelectProvider, selectedProvider }) {
  if (!attempts?.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/30 p-5 text-zinc-400">
        Preparing embed player...
      </div>
    );
  }

  return (
    <div className="grid gap-2 sm:gap-3 md:grid-cols-2 lg:grid-cols-3">
      {attempts.map((attempt, index) => {
        const style = getStatusStyle(attempt.status);

        return (
          <div
            key={`${attempt.providerId || attempt.provider}-${index}`}
            className={`rounded-2xl border p-3 sm:p-4 ${style.card}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
                  <h3 className="font-bold text-white">{attempt.provider}</h3>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{attempt.label}</p>
              </div>
              <span className={`rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${style.text}`}>
                {style.label}
              </span>
            </div>

            {attempt.reason ? (
              <p className="mt-3 text-xs leading-5 text-zinc-400">{attempt.reason}</p>
            ) : null}
            {attempt.health?.ok ? (
              <p className="mt-2 break-all text-[11px] leading-5 text-green-300">
                API checked: HTTP {attempt.health.status} • {attempt.health.finalUrl}
              </p>
            ) : null}
            {attempt.providerId ? (
              <button
                type="button"
                onClick={() => onSelectProvider?.(attempt.providerId)}
                disabled={selectedProvider === attempt.providerId || (selectedProvider === 'auto' && attempt.status === 'available')}
                className="mt-4 rounded-full border border-white/10 px-3 py-1.5 text-xs font-bold text-white transition hover:border-red-500 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {selectedProvider === attempt.providerId ? 'Selected' : 'Use this source'}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default function WatchByTMDBPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const type = params?.type;
  const tmdbId = params?.tmdbId;
  const isSeries = type === 'series' || type === 'tv';
  const playerShellRef = useRef(null);
  const directVideoRef = useRef(null);
  const directPlayerRef = useRef(null);
  const [directVideoEl, setDirectVideoEl] = useState(null);
  const directVideoCallbackRef = useCallback((el) => {
    directVideoRef.current = el;
    setDirectVideoEl(el);
  }, []);

  const initialSeason = Math.max(1, Number(searchParams?.get('season') || searchParams?.get('s') || 1));
  const initialEpisode = Math.max(1, Number(searchParams?.get('episode') || searchParams?.get('e') || 1));
  const qualityParam = (searchParams?.get('quality') || '').toLowerCase();
  // Legacy direct-TamilOTT links (/watch/*/ott?...) no longer play: titles must
  // be matched to a TMDB id from the homepage Match button first.
  const isLegacyOttUrl = String(tmdbId || '').toLowerCase() === 'ott';

  const [season, setSeason] = useState(initialSeason);
  const [episode, setEpisode] = useState(initialEpisode);
  const [seriesMeta, setSeriesMeta] = useState(null);
  const [seriesMetaStatus, setSeriesMetaStatus] = useState('idle');
  const language = 'tam';
  const [provider, setProvider] = useState('auto');
  const [providerChecked, setProviderChecked] = useState(false);
  const [titleMeta, setTitleMeta] = useState(null);
  const [pageMounted, setPageMounted] = useState(false);
  const metaRef = useRef(null);
  useLibraryVersion();
  const [popupBlocker, setPopupBlocker] = useState(true);
  const [streamUrl, setStreamUrl] = useState('');
  const [streamFallbacks, setStreamFallbacks] = useState([]);
  const [streamChoiceIndex, setStreamChoiceIndex] = useState(0);
  const [streamType, setStreamType] = useState('embed');
  const [status, setStatus] = useState('loading');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [trailerTitle, setTrailerTitle] = useState('');
  const [playerMode, setPlayerMode] = useState('stream');
  const [trailerStatus, setTrailerStatus] = useState('idle');
  const streamChoices = useMemo(() => [...new Set([streamUrl, ...(streamFallbacks || [])].filter(Boolean))], [streamUrl, streamFallbacks]);
  const currentStreamUrl = streamChoices[streamChoiceIndex] || streamUrl;
  const activePlayerUrl = playerMode === 'trailer' ? trailerUrl : currentStreamUrl;
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState([]);
  const [savedToMongoDB, setSavedToMongoDB] = useState(false);
  const [resolvedProviderId, setResolvedProviderId] = useState('');
  const [stremioStreams, setStremioStreams] = useState([]);
  const [selectedStremioStreamId, setSelectedStremioStreamId] = useState('');
  const [resolvedStremioStreamId, setResolvedStremioStreamId] = useState('');
  const activeProvider = playerMode === 'trailer' ? 'trailer' : (resolvedProviderId || provider);
  const showStremioQualityPicker = !isLegacyOttUrl && (resolvedProviderId === 'stremio' || provider === 'stremio');

  const watchKey = useMemo(
    () => makeWatchKey({ type: isSeries ? 'series' : 'movie', tmdbId }),
    [isSeries, tmdbId],
  );

  // Mark mounted (library data lives in localStorage — client only).
  useEffect(() => setPageMounted(true), []);

  // Restore the last manually selected server for this title BEFORE the first
  // resolve attempt, so returning users skip straight to their working source.
  useEffect(() => {
    try {
      const saved = getLastProvider(watchKey);
      if (saved && saved !== provider) setProvider(saved);
    } catch {}
    setProviderChecked(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey]);

  // Retired direct-TamilOTT links (/watch/*/ott?...) can no longer play.
  useEffect(() => {
    if (!isLegacyOttUrl) return;
    setError('This link was created before manual TMDB matching and cannot play any more. Go back to the homepage, find the same poster, and use its Match button to bind a TMDB/IMDb id first.');
    setStatus('error');
    setProviderChecked(true);
  }, [isLegacyOttUrl]);

  // Provider/title/episode changes restart Stremio quality auto-pick.
  useEffect(() => {
    setSelectedStremioStreamId('');
  }, [provider, type, tmdbId, season, episode]);

  // Load lightweight title metadata used for Continue Watching / My List.
  useEffect(() => {
    let cancelled = false;
    metaRef.current = null;
    setTitleMeta(null);

    async function loadMeta() {
      if (!tmdbId || !type || isLegacyOttUrl) return;
      try {
        const response = await fetch(`/api/tmdb/meta?type=${encodeURIComponent(type)}&tmdbId=${encodeURIComponent(tmdbId)}`, { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!cancelled && data?.ok) {
          metaRef.current = data;
          setTitleMeta(data);
        }
      } catch {}
    }

    loadMeta();
    return () => { cancelled = true; };
  }, [type, tmdbId, isLegacyOttUrl]);

  const resolveUrl = useMemo(() => {
    if (!type || !tmdbId || isLegacyOttUrl) return null;

    const params = new URLSearchParams({
      type,
      lan: language,
      provider,
      tmdbId,
    });

    if (qualityParam) params.set('quality', qualityParam);

    if (isSeries) {
      params.set('season', String(season || 1));
      params.set('episode', String(episode || 1));
    }

    if (provider === 'stremio' && selectedStremioStreamId) {
      params.set('stremioStreamId', selectedStremioStreamId);
    }

    return `/api/resolve?${params.toString()}`;
  }, [type, tmdbId, provider, isSeries, season, episode, isLegacyOttUrl, selectedStremioStreamId, qualityParam]);

  useEffect(() => {
    if (!isSeries || !tmdbId || isLegacyOttUrl) return;

    const controller = new AbortController();

    async function loadSeriesMetadata() {
      try {
        setSeriesMetaStatus('loading');
        const response = await fetch(`/api/tmdb/series/${tmdbId}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Unable to load series metadata');
        setSeriesMeta(data);
        setSeriesMetaStatus('ready');

        if (data.seasons?.length) {
          const hasSeason = data.seasons.some((item) => item.seasonNumber === season);
          if (!hasSeason) {
            setSeason(data.seasons[0].seasonNumber);
            setEpisode(data.seasons[0].episodes?.[0]?.episodeNumber || 1);
          }
        }
      } catch (error) {
        if (error.name === 'AbortError') return;
        setSeriesMetaStatus('error');
      }
    }

    loadSeriesMetadata();
    return () => controller.abort();
  }, [isSeries, tmdbId, isLegacyOttUrl]);

  const selectedSeasonMeta = useMemo(() => {
    return seriesMeta?.seasons?.find((item) => item.seasonNumber === season) || null;
  }, [seriesMeta, season]);

  const seasonOptions = useMemo(() => {
    return seriesMeta?.seasons?.length ? seriesMeta.seasons : [{ seasonNumber: season, name: `Season ${season}` }];
  }, [seriesMeta, season]);

  const episodeOptions = useMemo(() => {
    return selectedSeasonMeta?.episodes?.length ? selectedSeasonMeta.episodes : [{ episodeNumber: episode, name: `Episode ${episode}` }];
  }, [selectedSeasonMeta, episode]);

  useEffect(() => {
    if (!episodeOptions?.length) return;
    const hasEpisode = episodeOptions.some((item) => item.episodeNumber === episode);
    if (!hasEpisode) {
      setEpisode(episodeOptions[0].episodeNumber || 1);
    }
  }, [episodeOptions, episode]);

  useEffect(() => {
    // Wait until the saved-provider check ran, so we don't resolve twice.
    if (!resolveUrl || !providerChecked) return;

    const controller = new AbortController();

    async function resolveSources() {
      try {
        setStatus('loading');
        setError('');
        setAttempts([]);
        setSavedToMongoDB(false);
        setResolvedProviderId('');
        setStremioStreams([]);
        setResolvedStremioStreamId('');
        setStreamUrl('');
        setStreamFallbacks([]);
        setStreamChoiceIndex(0);
        setStreamType('embed');
        setPlayerMode('stream');

        const response = await fetch(resolveUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });

        const data = await response.json();
        setAttempts(data.attempts || []);
        setSavedToMongoDB(Boolean(data.savedToMongoDB));
        setResolvedProviderId(data.providerId || '');
        setStremioStreams(data.availableStreams || []);
        setResolvedStremioStreamId(data.selectedStreamId || '');

        if (!response.ok) throw new Error(data?.error || 'Unable to build embed URL');
        if (!data.streamUrl) throw new Error('No stream URL returned');

        setStreamUrl(data.streamUrl);
        setStreamFallbacks(data.streamFallbacks || []);
        setStreamChoiceIndex(0);
        setStreamType(data.streamType || 'embed');
        setStatus('ready');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Something went wrong');
        setStatus('error');
      }
    }

    resolveSources();

    return () => controller.abort();
  }, [resolveUrl, providerChecked]);

  // Record a Continue Watching entry whenever a stream resolves successfully.
  useEffect(() => {
    if (status !== 'ready' || playerMode !== 'stream' || !activePlayerUrl) return;
    if (typeof window === 'undefined') return;
    const meta = metaRef.current || titleMeta || {};
    upsertHistoryEntry({
      key: watchKey,
      type: isSeries ? 'series' : 'movie',
      tmdbId: Number(tmdbId) || null,
      title: meta.title || `TMDB ${tmdbId}`,
      posterUrl: meta.posterUrl || '',
      year: meta.year || '',
      season: isSeries ? season : 0,
      episode: isSeries ? episode : 0,
      provider: activeProvider || '',
      href: `${window.location.pathname}${window.location.search}`,
    });
  }, [status, playerMode, activePlayerUrl, watchKey, isSeries, tmdbId, season, episode, activeProvider, titleMeta]);

  useEffect(() => {
    const video = directVideoRef.current;
    if (!video || status !== 'ready' || playerMode !== 'stream' || !activePlayerUrl || !isDirectPlayerType(streamType, activePlayerUrl)) return;
    let cancelled = false;

    async function destroyDirectPlayer() {
      if (directPlayerRef.current) {
        try { await directPlayerRef.current.destroy(); } catch {}
        directPlayerRef.current = null;
      }
    }

    async function loadDirect() {
      try {
        await destroyDirectPlayer();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();

        if (isHlsUrl(activePlayerUrl) || isDashUrl(activePlayerUrl)) {
          const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
          const shaka = shakaModule.default || window.shaka || shakaModule;
          shaka.polyfill?.installAll?.();
          const player = new shaka.Player();
          directPlayerRef.current = player;
          await player.attach(video);
          player.configure({
            streaming: { bufferingGoal: 20, rebufferingGoal: 2 },
            abr: { enabled: true, defaultBandwidthEstimate: 1_500_000 },
          });
          await player.load(activePlayerUrl, undefined, isHlsUrl(activePlayerUrl) ? 'application/x-mpegurl' : undefined);
        } else {
          video.src = activePlayerUrl;
          video.load();
        }
        if (!cancelled) video.play().catch(() => {});
      } catch (playbackError) {
        if (!cancelled) {
          setError(formatDirectPlaybackError(playbackError, resolvedProviderId));
          setStatus('error');
        }
      }
    }

    loadDirect();
    return () => { cancelled = true; destroyDirectPlayer(); };
  }, [status, playerMode, activePlayerUrl, streamType, resolvedProviderId]);

  const playTrailer = async () => {
    if (!tmdbId || !type) return;

    try {
      setTrailerStatus('loading');
      const response = await fetch(`/api/tmdb/videos?type=${encodeURIComponent(type)}&tmdbId=${encodeURIComponent(tmdbId)}`, {
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok || !data.trailer?.embedUrl) throw new Error(data?.error || 'Trailer not found');

      setTrailerUrl(data.trailer.embedUrl);
      setTrailerTitle(data.trailer.name || 'Trailer');
      setPlayerMode('trailer');
      setTrailerStatus('ready');
    } catch (error) {
      setTrailerStatus('error');
      alert(error.message || 'Trailer not found for this title.');
    }
  };

  const directStreamActive = playerMode === 'stream' && isDirectPlayerType(streamType, activePlayerUrl);

  // ---------- DirectWatchPlayer wiring (v7.7.0) ----------
  // Labelled source list for the player's stream picker menu.
  const watchSources = useMemo(() => {
    return streamChoices.map((url, index) => {
      const matched = (stremioStreams || []).find((s) => s && (s.url === url || s.streamUrl === url));
      const label = matched
        ? [matched.title, matched.name, matched.behaviorHints?.bingeGroup, matched.quality]
            .filter(Boolean)
            .join(' • ')
            .replace(/\s+/g, ' ')
        : `Source ${index + 1}`;
      return { url, label: label || `Source ${index + 1}` };
    });
  }, [streamChoices, stremioStreams]);

  // Next-episode pill data (same-season next ep, else first ep of next season).
  const nextEpisodeInfo = useMemo(() => {
    if (!isSeries || !seasonOptions?.length) return null;
    const episodes = (seasonOptions.find((s) => s.seasonNumber === season)?.episodes) || [];
    const idx = episodes.findIndex((e) => e.episodeNumber === episode);
    if (idx >= 0 && idx < episodes.length - 1) {
      const ne = episodes[idx + 1];
      return { label: `E${ne.episodeNumber}${ne.name ? ` · ${ne.name}` : ''}`, onPlay: () => setEpisode(ne.episodeNumber) };
    }
    const sIdx = seasonOptions.findIndex((s) => s.seasonNumber === season);
    const ns = sIdx >= 0 ? seasonOptions[sIdx + 1] : null;
    if (ns?.episodes?.[0]) {
      const first = ns.episodes[0];
      return {
        label: `S${ns.seasonNumber} E${first.episodeNumber}`,
        onPlay: () => { setSeason(ns.seasonNumber); setEpisode(first.episodeNumber); },
      };
    }
    return null;
  }, [isSeries, seasonOptions, season, episode]);

  // Auto-fallback: the player reports a stall/error and we rotate to the next
  // known-good direct URL, preserving position via the saved-history resume.
  const fallbackCountRef = useRef(0);
  useEffect(() => { fallbackCountRef.current = 0; }, [type, tmdbId, season, episode, selectedStremioStreamId, qualityParam]);
  const handleAutoFallback = useCallback(() => {
    if (!streamChoices.length) return;
    fallbackCountRef.current += 1;
    if (fallbackCountRef.current > streamChoices.length * 2) {
      setError('All direct stream URLs failed to play. Try another quality or provider.');
      setStatus('error');
      return;
    }
    setStreamChoiceIndex((prev) => (prev + 1) % streamChoices.length);
  }, [streamChoices.length]);

  const directPlayerTitle = useMemo(() => {
    const base = titleMeta?.title || titleMeta?.name || 'Now Playing';
    return isSeries ? `${base} · S${season} E${episode}` : base;
  }, [titleMeta, isSeries, season, episode]);

  // Resume the saved playback position and persist progress for direct
  // (non-iframe) streams. Embed iframes cannot report progress.
  useEffect(() => {
    if (!directStreamActive || playerMode !== 'stream' || !activePlayerUrl) return;
    const video = directVideoRef.current;
    if (!video) return;

    const FINISHED_RATIO = 0.95;
    const applyResume = () => {
      const saved = getHistoryEntry(watchKey);
      if (!saved?.progress) return;
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : saved.duration;
      // Only resume if meaningfully into the title and it wasn't finished.
      if (saved.progress > 20 && (!duration || saved.progress < duration * FINISHED_RATIO)) {
        try { video.currentTime = saved.progress; } catch {}
      }
    };

    if (video.readyState >= 1) applyResume();
    else video.addEventListener('loadedmetadata', applyResume, { once: true });

    const persistNow = () => saveWatchProgress(
      watchKey,
      video.currentTime || 0,
      Number.isFinite(video.duration) ? video.duration : 0,
    );
    let lastSave = 0;
    const onTimeUpdate = () => {
      const now = Date.now();
      if (now - lastSave < 5000) return; // throttle writes to every 5s
      lastSave = now;
      persistNow();
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('pause', persistNow);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('pause', persistNow);
      persistNow();
    };
  }, [directStreamActive, playerMode, activePlayerUrl, watchKey]);

  const nextEpisodeTarget = useMemo(() => {
    if (!isSeries) return null;
    const eps = [...new Set((episodeOptions || []).map((item) => Number(item.episodeNumber)).filter(Boolean))].sort((a, b) => a - b);
    const epIndex = eps.indexOf(Number(episode));
    if (epIndex >= 0 && epIndex < eps.length - 1) {
      return { season: Number(season), episode: eps[epIndex + 1] };
    }
    const seasons = (seasonOptions || []).map((item) => Number(item.seasonNumber)).sort((a, b) => a - b);
    const seasonIndex = seasons.indexOf(Number(season));
    if (seasonIndex >= 0 && seasonIndex < seasons.length - 1) {
      const nextSeasonNumber = seasons[seasonIndex + 1];
      const nextSeasonMetaItem = (seasonOptions || []).find((item) => Number(item.seasonNumber) === nextSeasonNumber);
      return { season: nextSeasonNumber, episode: Number(nextSeasonMetaItem?.episodes?.[0]?.episodeNumber) || 1 };
    }
    return null;
  }, [isSeries, episodeOptions, seasonOptions, season, episode]);

  const isFav = pageMounted ? isFavoriteItem(watchKey) : false;

  const handleProviderSelect = (providerId) => {
    setProvider(providerId);
    setLastProvider(watchKey, providerId);
  };

  const handleToggleFavorite = () => {
    const meta = metaRef.current || titleMeta || {};
    toggleFavoriteItem({
      key: watchKey,
      type: isSeries ? 'series' : 'movie',
      tmdbId: Number(tmdbId) || null,
      title: meta.title || `TMDB ${tmdbId}`,
      posterUrl: meta.posterUrl || '',
      year: meta.year || '',
      href: `/watch/${isSeries ? 'series' : 'movie'}/${tmdbId}`,
    });
  };

  const handleNextEpisode = () => {
    if (!nextEpisodeTarget) return;
    setSeason(nextEpisodeTarget.season);
    setEpisode(nextEpisodeTarget.episode);
  };

  return (
    <main className="watch-page min-h-dvh overflow-x-hidden bg-black text-zinc-100">
      <header className="border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
          <Link
            href="/"
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">← Back</span>
            <span className="hidden sm:inline">← Back to JaSH ViBeS</span>
          </Link>
          <span className="hidden text-xs font-semibold uppercase tracking-[0.25em] text-red-500 sm:inline">
            Embed Provider Player
          </span>
        </div>
      </header>

      <section className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        {titleMeta?.posterUrl ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 hidden h-[560px] overflow-hidden sm:block">
            <img src={titleMeta.posterUrl} alt="" className="h-full w-full scale-125 object-cover opacity-25 blur-3xl saturate-150" />
          </div>
        ) : null}

        <div className="relative mb-4 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.26em] text-amber-400 sm:text-xs">
              <Icon name="film" className="h-3.5 w-3.5" /> Now Watching
            </p>
            <h1 className="mt-1 line-clamp-2 text-xl font-extrabold text-white sm:text-3xl">{titleMeta?.title || `TMDB ${tmdbId}`}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-zinc-400">
              {titleMeta?.year ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">{titleMeta.year}</span> : null}
              {Number(titleMeta?.rating) > 0 ? <span className="rounded-full border border-amber-300/25 bg-white/[0.04] px-2 py-0.5 text-amber-300">★ {Number(titleMeta.rating).toFixed(1)}</span> : null}
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">{isSeries ? `Series · S${season} E${episode}` : 'Movie'}</span>
              {qualityParam && labelForTier(qualityParam) ? (
                <span className={`rounded-full border px-2 py-0.5 font-black uppercase tracking-wider ${chipClassForTier(qualityParam)}`}>{labelForTier(qualityParam)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="relative mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mb-5 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <div className="col-span-2 rounded-2xl border border-white/10 bg-black/40 p-3 sm:col-span-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500"><Icon name="gear" className="h-3.5 w-3.5" /> Servers</p>
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-7">
                {WATCH_SERVER_OPTIONS.map((server) => {
                  const active = provider === server.id;
                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => handleProviderSelect(server.id)}
                      title={providerChecked && getLastProvider(watchKey) === server.id ? 'Your last used server for this title' : server.name}
                      className={`min-h-[3.1rem] rounded-xl border px-2 py-2 text-left transition active:scale-[0.98] sm:rounded-2xl ${active ? 'border-transparent bg-gradient-to-br from-amber-500 via-red-600 to-purple-600 shadow-lg shadow-red-950/30' : 'border-white/10 bg-white/[0.035] hover:border-white/30 hover:bg-white/[0.08]'} disabled:opacity-70`}
                    >
                      <span className={`block text-xs font-black uppercase tracking-[0.12em] ${active ? 'text-white' : 'text-zinc-100'}`}>{server.name}</span>
                      <span className={`mt-1 block truncate text-[10px] font-semibold ${active ? 'text-amber-50/90' : 'text-zinc-500'}`}>{server.label}</span>
                      {active ? <span className="mt-2 block h-1 w-8 rounded-full bg-white/80" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            {isSeries ? (
              <>
                <label className="text-sm text-zinc-400">
                  Season
                  <select
                    value={season}
                    onChange={(event) => {
                      const nextSeason = Number(event.target.value) || 1;
                      setSeason(nextSeason);
                      const nextSeasonMeta = seasonOptions.find((item) => item.seasonNumber === nextSeason);
                      setEpisode(nextSeasonMeta?.episodes?.[0]?.episodeNumber || 1);
                    }}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-500"
                  >
                    {seasonOptions.map((item) => (
                      <option key={item.seasonNumber} value={item.seasonNumber}>
                        {item.name || `Season ${item.seasonNumber}`}
                      </option>
                    ))}
                  </select>
                  {seriesMetaStatus === 'loading' ? <span className="mt-1 block text-[10px] text-zinc-500">Loading TMDB seasons...</span> : null}
                </label>
                <label className="text-sm text-zinc-400">
                  Episode
                  <select
                    value={episode}
                    onChange={(event) => { setEpisode(Number(event.target.value) || 1); }}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-500"
                  >
                    {episodeOptions.map((item) => (
                      <option key={item.episodeNumber} value={item.episodeNumber}>
                        E{item.episodeNumber} {item.name ? `- ${item.name}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-black px-3 py-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={popupBlocker}
                onChange={(event) => setPopupBlocker(event.target.checked)}
                className="h-4 w-4 accent-red-600"
              />
              Block Popups
            </label>
            {showStremioQualityPicker ? (
              <label className="col-span-2 text-sm text-zinc-400 sm:col-span-4">
                Stremio Quality
                <select
                  value={selectedStremioStreamId || resolvedStremioStreamId || ''}
                  onChange={(event) => setSelectedStremioStreamId(event.target.value)}
                  disabled={status === 'loading' || !stremioStreams.length}
                  className="mt-1 w-full rounded-xl border border-fuchsia-500/25 bg-black px-3 py-2 text-white outline-none focus:border-fuchsia-500 disabled:cursor-wait disabled:opacity-60"
                >
                  {!stremioStreams.length ? (
                    <option value="">Loading Stremio streams...</option>
                  ) : null}
                  {stremioStreams.map((stream) => (
                    <option key={stream.id} value={stream.id}>
                      {stream.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>

        <div
          ref={playerShellRef}
          className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none fullscreen:border-0 sm:rounded-3xl"
        >
          <div className="relative aspect-video w-full bg-zinc-950 fullscreen:h-screen fullscreen:aspect-auto">
            {status === 'loading' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
                <div>
                  <p className="font-semibold text-white">Resolving embed provider...</p>
                  <p className="mt-2 text-sm text-zinc-400">{provider === 'auto' ? 'Checking Global Mirchi first, then Stremio, then the next server if needed.' : 'Generating direct embed URL from TMDB ID.'}</p>
                </div>
              </div>
            ) : null}

            {status === 'error' ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div className="max-w-xl rounded-2xl border border-red-500/30 bg-red-950/20 p-6">
                  <h1 className="text-2xl font-bold text-white">Stream unavailable</h1>
                  <p className="mt-3 text-sm leading-6 text-red-200">{error}</p>
                </div>
              </div>
            ) : null}

            {status === 'ready' && activePlayerUrl && directStreamActive ? (
              <DirectWatchPlayer
                videoEl={directVideoEl}
                watchKey={watchKey}
                title={directPlayerTitle}
                sources={watchSources}
                activeSource={streamChoiceIndex}
                onPickSource={(i) => { fallbackCountRef.current = 0; setStreamChoiceIndex(i); }}
                onAutoFallback={handleAutoFallback}
                nextEpisode={nextEpisodeInfo}
              >
                <video
                  ref={directVideoCallbackRef}
                  className="h-full w-full bg-black object-fill"
                  playsInline
                  autoPlay
                />
              </DirectWatchPlayer>
            ) : null}

            {status === 'ready' && activePlayerUrl && !directStreamActive && !popupBlocker && shouldUseObjectPlayer(activeProvider, activePlayerUrl) ? (
              <object
                title={playerMode === 'trailer' ? trailerTitle || 'Trailer player' : 'Embed player'}
                data={activePlayerUrl}
                type="text/html"
                className="h-full w-full border-0 bg-black"
              >
                <a href={activePlayerUrl} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center bg-black text-white">
                  Open player
                </a>
              </object>
            ) : null}

            {status === 'ready' && activePlayerUrl && !directStreamActive && (popupBlocker || !shouldUseObjectPlayer(activeProvider, activePlayerUrl)) ? (
              <iframe
                key={`${popupBlocker ? 'blocked' : 'open'}-${activePlayerUrl}`}
                title={playerMode === 'trailer' ? trailerTitle || 'Trailer player' : 'Embed player'}
                src={activePlayerUrl}
                className="h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                sandbox={popupBlocker && !/onestream|stream\/page/i.test(activePlayerUrl) ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined}
                allowFullScreen
                referrerPolicy="origin-when-cross-origin"
              />
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3">
          <button
            type="button"
            onClick={handleToggleFavorite}
            className={`inline-flex items-center rounded-xl border px-3 py-2.5 text-xs font-bold transition sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm ${
              isFav
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-100 hover:border-rose-300'
                : 'border-white/10 bg-white/[0.035] text-zinc-200 hover:border-rose-400/50 hover:bg-rose-500/10'
            }`}
            title={isFav ? 'Remove from My List' : 'Add to My List'}
          >
            <Icon name="heart" className="mr-1.5 h-4 w-4" />
            {isFav ? 'In My List' : 'My List'}
          </button>
          {nextEpisodeTarget ? (
            <button
              type="button"
              onClick={handleNextEpisode}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs font-bold text-emerald-100 transition hover:border-emerald-400 hover:bg-emerald-500/20 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              title={`Jump to Season ${nextEpisodeTarget.season} Episode ${nextEpisodeTarget.episode}`}
            >
              <Icon name="play" className="mr-1.5 h-3.5 w-3.5" />Next S{nextEpisodeTarget.season} E{nextEpisodeTarget.episode}
            </button>
          ) : null}
          {streamUrl ? (
            <>
              <button
                type="button"
                onClick={playTrailer}
                disabled={trailerStatus === 'loading'}
                className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-xs font-bold text-yellow-100 transition hover:border-yellow-400 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              >
                <Icon name="film" className="mr-1.5 h-3.5 w-3.5 inline" />{trailerStatus === 'loading' ? 'Trailer...' : 'Trailer'}
              </button>
              {playerMode === 'trailer' ? (
                <button
                  type="button"
                  onClick={() => setPlayerMode('stream')}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-100 transition hover:border-red-400 hover:bg-red-500/20 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  <Icon name="tv" className="mr-1.5 h-3.5 w-3.5" />Stream
                </button>
              ) : null}
            </>
          ) : null}
        </div>

      </section>
    </main>
  );
}
