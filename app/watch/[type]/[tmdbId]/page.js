'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { chipClassForTier, labelForTier } from '@/lib/quality';
import JashPlayer from '@/components/player/JashPlayer';
import Icon from '@/components/Icons';
import {
  getHistoryEntry,
  getLastProvider,
  isFavoriteItem,
  makeWatchKey,
  setLastProvider,
  toggleFavoriteItem,
  upsertHistoryEntry,
  useLibraryVersion,
} from '@/lib/watchStore';
import { buildSourceList, fmtTime, parseUrlSourceLabel } from '@/lib/player/labels';
import { detectKind, isDirectFileUrl } from '@/lib/player/kind';

function isDirectPlayerType(type = '', url = '') {
  // 'direct' = resolved direct file streams (Stremio/Telegram/mirchi). Their
  // URLs often carry trailing descriptive text after the extension
  // ("....mkv ⁍ Quality : 1080p ⁍ Audio : Tamil", spaces percent-encoded), so
  // lib/player/kind matches the extension mid-path instead of only at ?#/$.
  if (['direct', 'hls', 'dash', 'video'].includes(String(type || '').toLowerCase())) return true;
  const kind = detectKind(url, { streamType: type });
  if (kind === 'embed') return false;
  return kind === 'hls' || kind === 'dash' || isDirectFileUrl(url);
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

const WATCH_SERVER_OPTIONS = [
  { id: 'auto', name: 'Auto', label: 'Stremio → Mirchi' },
  { id: 'stremio', name: 'Stremio', label: 'Direct files' },
  { id: 'mirchi', name: 'Global Mirchi', label: 'Embed' },
  { id: 'vidlink', name: 'VidLink', label: 'Embed' },
  { id: 'videasy', name: 'VidEasy', label: 'Embed' },
  { id: 'vidzee', name: 'VidZee', label: 'Backup' },
  { id: 'vidrock', name: 'VidRock', label: 'Tamil first' },
];

export default function WatchByTMDBPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const type = params?.type;
  const tmdbId = params?.tmdbId;
  const isSeries = type === 'series' || type === 'tv';
  const playerShellRef = useRef(null);

  const initialSeason = Math.max(1, Number(searchParams?.get('season') || searchParams?.get('s') || 1));
  const initialEpisode = Math.max(1, Number(searchParams?.get('episode') || searchParams?.get('e') || 1));
  const qualityParam = (searchParams?.get('quality') || '').toLowerCase();
  // Legacy direct-TamilOTT links (/watch/*/ott?...) no longer play: titles must
  // be matched to a TMDB id from the homepage Match button first.
  const isLegacyOttUrl = String(tmdbId || '').toLowerCase() === 'ott';

  const [season, setSeason] = useState(initialSeason);
  const [episode, setEpisode] = useState(initialEpisode);
  const seasonRef = useRef(season);
  useEffect(() => {
    seasonRef.current = season;
  }, [season]);
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
          const hasSeason = data.seasons.some((item) => item.seasonNumber === seasonRef.current);
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
  // Labelled source list for the player's stream picker menu — labels resolve
  // in order: stream meta → parsed from the URL filename ("1080p 2.9GB") →
  // "Source N". Same helper the player uses internally, so labels agree.
  const watchSources = useMemo(
    () => buildSourceList({ urls: streamChoices, streams: stremioStreams, labelFor: (url) => parseUrlSourceLabel(url) }),
    [streamChoices, stremioStreams],
  );

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

  // Resume + progress persistence moved into usePlaybackEngine, so /watch,
  // /classics and /stremio-watch all apply the same finished-title guard and
  // write on the same cadence (5 s · pause · ended · fullscreen · pagehide).

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
          {/* Ambient Theater Backlight */}
          <div className="pointer-events-none absolute -inset-4 z-0 opacity-40 blur-3xl bg-gradient-to-tr from-amber-500/20 via-rose-600/20 to-purple-600/20" />

          <div className="jv-native-cursor relative z-10 aspect-video w-full bg-zinc-950 fullscreen:h-screen fullscreen:aspect-auto">
            {status === 'loading' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
                <div>
                  <p className="font-semibold text-white">Resolving stream provider...</p>
                  <p className="mt-2 text-sm text-zinc-400">{provider === 'auto' ? 'Checking Stremio first, then Global Mirchi, then fallback servers if needed.' : 'Generating stream URL from TMDB ID.'}</p>
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
              <JashPlayer
                source={{
                  url: activePlayerUrl,
                  kind: detectKind(activePlayerUrl, { streamType: streamType }),
                  label: watchSources[streamChoiceIndex]?.label || '',
                  // Kept from the old element: the snapshot button needs a
                  // CORS-readable buffer, and these CDNs do send the header.
                  crossOrigin: 'anonymous',
                }}
                display={{
                  title: directPlayerTitle,
                  poster: titleMeta?.backdropUrl || titleMeta?.posterUrl || '',
                  aspect: 'fill',
                }}
                library={{ watchKey }}
                lineup={{
                  sources: watchSources,
                  activeIndex: streamChoiceIndex,
                  onPickSource: (index) => {
                    fallbackCountRef.current = 0;
                    setStreamChoiceIndex(index);
                  },
                  nextEpisode: nextEpisodeInfo,
                }}
                on={{
                  onError: (info) => setError(info?.message || 'Direct player failed. Try another source.'),
                  onFatal: () => handleAutoFallback(),
                }}
              />
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

        {/* Interactive Episode Cards (for Series) */}
        {isSeries && selectedSeasonMeta?.episodes?.length ? (
          <div className="mt-8 space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-black text-white sm:text-xl">
                  Season {season} Episodes
                </h3>
                <p className="text-xs text-zinc-400">
                  {selectedSeasonMeta.episodes.length} episodes available
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {selectedSeasonMeta.episodes.map((ep) => {
                const isSelected = ep.episodeNumber === episode;
                const epKey = makeWatchKey({ type: 'series', tmdbId });
                const epHistory = getHistoryEntry(epKey);
                const resumingHere = epHistory?.season === season && epHistory?.episode === ep.episodeNumber && epHistory?.progress > 20;

                return (
                  <button
                    key={ep.episodeNumber}
                    type="button"
                    onClick={() => setEpisode(ep.episodeNumber)}
                    className={`group/ep relative flex flex-col overflow-hidden rounded-2xl border text-left transition duration-200 ${
                      isSelected
                        ? 'border-amber-400/60 bg-gradient-to-b from-amber-500/15 via-rose-500/10 to-zinc-950 shadow-lg shadow-amber-950/20'
                        : 'border-white/10 bg-zinc-950/70 hover:border-white/30 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="relative aspect-video w-full overflow-hidden bg-zinc-900">
                      {ep.stillUrl ? (
                        <img
                          src={ep.stillUrl}
                          alt=""
                          className="h-full w-full object-cover transition duration-300 group-hover/ep:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="grid h-full place-items-center bg-zinc-900 text-xs font-bold text-zinc-600">
                          Episode {ep.episodeNumber}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30" />
                      <div className="absolute left-2.5 top-2.5 rounded-lg border border-white/20 bg-black/70 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur">
                        E{ep.episodeNumber}
                      </div>
                      {resumingHere ? (
                        <div className="absolute right-2.5 top-2.5 rounded-lg bg-amber-400/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-black">
                          Resume {fmtTime(epHistory.progress)}
                        </div>
                      ) : null}
                      {ep.runtime ? (
                        <div className="absolute bottom-2 right-2.5 text-[10px] font-bold text-zinc-300">
                          {ep.runtime}m
                        </div>
                      ) : null}
                      {isSelected ? (
                        <div className="absolute inset-0 grid place-items-center bg-black/40">
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-black shadow-lg">
                            <Icon name="play" className="h-5 w-5" />
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="p-3">
                      <p className={`line-clamp-1 text-xs font-black ${isSelected ? 'text-amber-300' : 'text-white'}`}>
                        {ep.episodeNumber}. {ep.name || `Episode ${ep.episodeNumber}`}
                      </p>
                      {ep.overview ? (
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-zinc-400">
                          {ep.overview}
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Synopsis & Details Section */}
        {titleMeta?.synopsis || titleMeta?.overview ? (
          <div className="mt-8 rounded-3xl border border-white/10 bg-zinc-950/60 p-5 backdrop-blur sm:p-6">
            <h3 className="text-sm font-black uppercase tracking-wider text-amber-400">Storyline</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-300 sm:text-base sm:leading-7">
              {titleMeta.synopsis || titleMeta.overview}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-white/10 pt-3 text-xs text-zinc-400">
              {titleMeta.genres?.length ? (
                <span><b>Genres:</b> {titleMeta.genres.join(', ')}</span>
              ) : null}
              {titleMeta.releaseDate ? (
                <span><b>Released:</b> {titleMeta.releaseDate}</span>
              ) : null}
              {titleMeta.status ? (
                <span><b>Status:</b> {titleMeta.status}</span>
              ) : null}
            </div>
          </div>
        ) : null}

      </section>
    </main>
  );
}
