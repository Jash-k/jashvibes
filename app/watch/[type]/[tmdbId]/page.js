'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

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
            {attempt.match ? (
              <p className="mt-2 text-[11px] leading-5 text-orange-200">
                Match: {attempt.match.streamTitle || attempt.match.title} {attempt.match.quality ? `• ${attempt.match.quality}` : ''}
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

  const initialSeason = Math.max(1, Number(searchParams?.get('season') || searchParams?.get('s') || 1));
  const initialEpisode = Math.max(1, Number(searchParams?.get('episode') || searchParams?.get('e') || 1));
  const isOttTitleOnly = String(tmdbId || '').toLowerCase() === 'ott';
  const ottTitle = searchParams?.get('title') || '';
  const ottYear = searchParams?.get('year') || '';
  const initialOttStreamId = searchParams?.get('ottStreamId') || searchParams?.get('streamId') || '';

  const [season, setSeason] = useState(initialSeason);
  const [episode, setEpisode] = useState(initialEpisode);
  const [seriesMeta, setSeriesMeta] = useState(null);
  const [seriesMetaStatus, setSeriesMetaStatus] = useState('idle');
  const language = 'tam';
  const [provider, setProvider] = useState(isOttTitleOnly ? 'tamilott' : 'auto');
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
  const activeProvider = playerMode === 'trailer' ? 'trailer' : (isOttTitleOnly ? 'tamilott' : provider);
  const [error, setError] = useState('');
  const [attempts, setAttempts] = useState([]);
  const [savedToMongoDB, setSavedToMongoDB] = useState(false);
  const [resolveMode, setResolveMode] = useState('');
  const [ottStreams, setOttStreams] = useState([]);
  const [selectedOttStreamId, setSelectedOttStreamId] = useState(initialOttStreamId);
  const [resolvedOttStreamId, setResolvedOttStreamId] = useState('');
  const [stremioCheck, setStremioCheck] = useState({ status: 'idle', available: false, href: '', count: 0, error: '' });

  const resolveUrl = useMemo(() => {
    if (!type || !tmdbId) return null;

    const effectiveProvider = isOttTitleOnly ? 'tamilott' : provider;
    const params = new URLSearchParams({
      type,
      lan: language,
      provider: effectiveProvider,
    });

    if (isOttTitleOnly) {
      params.set('title', ottTitle);
      if (ottYear) params.set('year', ottYear);
    } else {
      params.set('tmdbId', tmdbId);
    }

    if (isSeries) {
      params.set('season', String(season || 1));
      params.set('episode', String(episode || 1));
    }

    if ((effectiveProvider === 'tamilott' || effectiveProvider === 'auto') && selectedOttStreamId) {
      params.set('ottStreamId', selectedOttStreamId);
    }

    return `/api/resolve?${params.toString()}`;
  }, [type, tmdbId, provider, isSeries, season, episode, selectedOttStreamId, isOttTitleOnly, ottTitle, ottYear]);

  const shouldShowOttStreamPicker = isOttTitleOnly || provider === 'tamilott' || resolveMode === 'tamilott-json-provider' || ottStreams.length > 0;

  useEffect(() => {
    if (!type || (!tmdbId && !ottTitle)) {
      setStremioCheck({ status: 'idle', available: false, href: '', count: 0, error: '' });
      return;
    }
    const controller = new AbortController();
    async function checkStremio() {
      try {
        setStremioCheck((current) => ({ ...current, status: 'checking', error: '' }));
        const params = new URLSearchParams({ type, source: 'watch' });
        if (isOttTitleOnly) {
          params.set('title', ottTitle);
          if (ottYear) params.set('year', ottYear);
        } else {
          params.set('tmdbId', String(tmdbId));
        }
        if (isSeries) {
          params.set('season', String(season || 1));
          params.set('episode', String(episode || 1));
        }
        const response = await fetch(`/api/stremio/check?${params.toString()}`, { signal: controller.signal, cache: 'no-store' });
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) throw new Error('Stremio check returned non-JSON response. Deploy latest API files.');
        const data = await response.json();
        setStremioCheck({
          status: data.available ? 'available' : 'unavailable',
          available: Boolean(data.available),
          href: data.href || '',
          count: data.count || 0,
          error: data.error || data.reason || '',
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        setStremioCheck({ status: 'error', available: false, href: '', count: 0, error: err.message || 'Stremio check failed' });
      }
    }
    checkStremio();
    return () => controller.abort();
  }, [type, tmdbId, ottTitle, ottYear, isSeries, season, episode, isOttTitleOnly]);

  useEffect(() => {
    if (!(isOttTitleOnly && initialOttStreamId)) {
      setSelectedOttStreamId('');
    }
    setResolvedOttStreamId('');
    setOttStreams([]);
  }, [provider, type, tmdbId, season, episode, isOttTitleOnly, initialOttStreamId]);

  useEffect(() => {
    if (!isSeries || !tmdbId || isOttTitleOnly) return;

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
  }, [isSeries, tmdbId, isOttTitleOnly]);

  const selectedSeasonMeta = useMemo(() => {
    return seriesMeta?.seasons?.find((item) => item.seasonNumber === season) || null;
  }, [seriesMeta, season]);

  useEffect(() => {
    if (!selectedSeasonMeta?.episodes?.length) return;
    const hasEpisode = selectedSeasonMeta.episodes.some((item) => item.episodeNumber === episode);
    if (!hasEpisode) setEpisode(selectedSeasonMeta.episodes[0].episodeNumber || 1);
  }, [selectedSeasonMeta, episode]);

  useEffect(() => {
    if (!resolveUrl) return;

    const controller = new AbortController();

    async function resolveSources() {
      try {
        setStatus('loading');
        setError('');
        setAttempts([]);
        setSavedToMongoDB(false);
        setResolveMode('');
        setOttStreams([]);
        setResolvedOttStreamId('');
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
        setResolveMode(data.mode || '');
        setOttStreams(data.availableStreams || []);
        setResolvedOttStreamId(data.selectedStreamId || '');

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
  }, [resolveUrl]);

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

  const enterFullscreen = async () => {
    const element = playerShellRef.current;
    if (!element) return;

    try {
      if (element.requestFullscreen) await element.requestFullscreen();
      else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
      else if (element.msRequestFullscreen) element.msRequestFullscreen();
    } catch (error) {
      console.warn('Fullscreen request failed:', error);
    }
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-black text-zinc-100">
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

      <section className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:mb-5 sm:p-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
            <label className="col-span-2 text-sm text-zinc-400 sm:col-span-1">
              Source
              <select
                value={isOttTitleOnly ? 'tamilott' : provider}
                onChange={(event) => setProvider(event.target.value)}
                disabled={isOttTitleOnly}
                className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-500 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isOttTitleOnly ? (
                  <option value="tamilott">TamilOTT JSON only</option>
                ) : (
                  <>
                    <option value="auto">Auto Priority (TamilOTT first)</option>
                    <option value="vidlink">VidLink</option>
                    <option value="vidnest">VidNest</option>
                    <option value="videasy">Videasy</option>
                    <option value="vidzee">VidZee</option>
                    <option value="vidrock">VidRock</option>
                    <option value="vixsrc">VixSrc</option>
                    <option value="oneembed">1Embed</option>
                    <option value="vidsrcsbs">VidSrc SBS</option>
                    <option value="vidsrc">VidSrc Mirrors</option>
                    <option value="tamilott">TamilOTT JSON</option>
                  </>
                )}
              </select>
              {isOttTitleOnly ? <span className="mt-1 block text-[10px] text-orange-300">Opened from an unmatched TamilMV card. Playback is locked to TamilOTT title search.</span> : null}
            </label>
            {isSeries ? (
              <>
                <label className="text-sm text-zinc-400">
                  Season
                  <select
                    value={season}
                    onChange={(event) => {
                      const nextSeason = Number(event.target.value) || 1;
                      setSeason(nextSeason);
                      const nextSeasonMeta = seriesMeta?.seasons?.find((item) => item.seasonNumber === nextSeason);
                      setEpisode(nextSeasonMeta?.episodes?.[0]?.episodeNumber || 1);
                    }}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-500"
                  >
                    {(seriesMeta?.seasons?.length ? seriesMeta.seasons : [{ seasonNumber: season, name: `Season ${season}` }]).map((item) => (
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
                    onChange={(event) => setEpisode(Number(event.target.value) || 1)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black px-3 py-2 text-white outline-none focus:border-red-500"
                  >
                    {((selectedSeasonMeta?.episodes?.length ? selectedSeasonMeta.episodes : [{ episodeNumber: episode, name: `Episode ${episode}` }])).map((item) => (
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
            {shouldShowOttStreamPicker ? (
              <label className="col-span-2 text-sm text-zinc-400 sm:col-span-4">
                TamilOTT available streams
                <select
                  value={selectedOttStreamId || resolvedOttStreamId || ''}
                  onChange={(event) => setSelectedOttStreamId(event.target.value)}
                  disabled={status === 'loading' || !ottStreams.length}
                  className="mt-1 w-full rounded-xl border border-orange-500/20 bg-black px-3 py-2 text-white outline-none focus:border-orange-500 disabled:cursor-wait disabled:opacity-60"
                >
                  {!ottStreams.length ? (
                    <option value="">Loading matching streams...</option>
                  ) : null}
                  {ottStreams.map((item) => (
                    <option key={item.id || item.streamUrl} value={item.id}>
                      {item.label || item.streamTitle || item.title}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[10px] text-zinc-500">
                  For series, changing the Season/Episode dropdown above auto-selects that episode. Use this list for manual episode/quality selection.
                </span>
              </label>
            ) : null}
          </div>
        </div>

        <div
          ref={playerShellRef}
          className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black fullscreen:fixed fullscreen:inset-0 fullscreen:z-[9999] fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none fullscreen:border-0 sm:rounded-3xl"
        >
          <div className="relative aspect-video w-full bg-zinc-950 fullscreen:h-screen fullscreen:aspect-auto">
            {status === 'loading' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
                <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-700 border-t-red-600" />
                <div>
                  <p className="font-semibold text-white">Resolving embed provider...</p>
                  <p className="mt-2 text-sm text-zinc-400">{isOttTitleOnly ? 'Matching TamilOTT by scraped title...' : provider === 'auto' ? 'Checking TamilOTT first with a fast recent-window scan, then falling back if needed.' : 'Generating direct embed URL from TMDB ID.'}</p>
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

            {status === 'ready' && activePlayerUrl && !popupBlocker && shouldUseObjectPlayer(activeProvider, activePlayerUrl) ? (
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

            {status === 'ready' && activePlayerUrl && (popupBlocker || !shouldUseObjectPlayer(activeProvider, activePlayerUrl)) ? (
              <iframe
                key={`${popupBlocker ? 'blocked' : 'open'}-${activePlayerUrl}`}
                title={playerMode === 'trailer' ? trailerTitle || 'Trailer player' : 'Embed player'}
                src={activePlayerUrl}
                className="h-full w-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                sandbox={popupBlocker ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined}
                allowFullScreen
                referrerPolicy="origin-when-cross-origin"
              />
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:flex sm:flex-wrap sm:gap-3">
          {stremioCheck.available && stremioCheck.href ? (
            <Link
              href={stremioCheck.href}
              className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/15 px-3 py-2.5 text-center text-xs font-bold text-fuchsia-100 transition hover:border-fuchsia-300 hover:bg-fuchsia-500/25 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              title={`${stremioCheck.count} Stremio stream${stremioCheck.count === 1 ? '' : 's'} available`}
            >
              Stremio📡
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-xl border border-white/10 bg-white/[0.035] px-3 py-2.5 text-xs font-bold text-zinc-500 opacity-60 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              title={stremioCheck.error || (stremioCheck.status === 'checking' ? 'Checking Stremio streams...' : 'No Stremio streams found')}
            >
              {stremioCheck.status === 'checking' ? 'Stremio…' : 'No Stremio'}
            </button>
          )}
          {streamUrl ? (
            <>
              {!isOttTitleOnly ? (
                <button
                  type="button"
                  onClick={playTrailer}
                  disabled={trailerStatus === 'loading'}
                  className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-xs font-bold text-yellow-100 transition hover:border-yellow-400 hover:bg-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  {trailerStatus === 'loading' ? 'Trailer...' : 'Trailer'}
                </button>
              ) : null}
              {playerMode === 'trailer' ? (
                <button
                  type="button"
                  onClick={() => setPlayerMode('stream')}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs font-bold text-red-100 transition hover:border-red-400 hover:bg-red-500/20 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  Stream
                </button>
              ) : null}
              <button
                type="button"
                onClick={enterFullscreen}
                className="rounded-xl border border-white/10 bg-white/10 px-3 py-2.5 text-xs font-bold text-white transition hover:border-red-500 hover:bg-red-500/10 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              >
                Fullscreen
              </button>
              {playerMode === 'stream' && streamChoices.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setStreamChoiceIndex((index) => (index + 1) % streamChoices.length)}
                  className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-3 py-2.5 text-xs font-bold text-orange-100 transition hover:border-orange-400 hover:bg-orange-500/20 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
                >
                  Mirror {streamChoiceIndex + 1}/{streamChoices.length}
                </button>
              ) : null}
              <a
                href={activePlayerUrl || streamUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-red-600 px-3 py-2.5 text-center text-xs font-bold text-white transition hover:bg-red-500 sm:w-auto sm:rounded-2xl sm:px-5 sm:py-3 sm:text-sm"
              >
                Open Direct
              </a>
            </>
          ) : null}
          <p className="col-span-2 flex items-center text-center text-[11px] leading-5 text-zinc-500 sm:text-left sm:text-xs">
            Popup blocker uses iframe sandboxing to stop popups/top-navigation ads. If a source says “disable sandbox” or will not start, turn off Block Popups or use Open Source Directly.
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-6 text-zinc-400 sm:mt-6 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-white">Embed Status</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Choose any source manually. Current modules: TamilOTT JSON, VidLink, VidNest, Videasy, VidZee, VidRock, VixSrc, 1Embed, VidSrc SBS, and VidSrc mirrors.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-400">
                {isOttTitleOnly ? `TamilOTT title: ${ottTitle || 'Unknown'}` : `TMDB ID: ${tmdbId}`} • {isSeries ? `TV S${season} E${episode}` : 'Movie'} • {playerMode === 'trailer' ? 'Trailer' : (isOttTitleOnly ? 'tamilott' : provider)}
              </span>
              {resolveMode ? (
                <span className="rounded-full border border-blue-500/30 bg-blue-950/20 px-3 py-1 text-xs text-blue-300">
                  {resolveMode}
                </span>
              ) : null}
              {savedToMongoDB ? (
                <span className="rounded-full border border-green-500/30 bg-green-950/20 px-3 py-1 text-xs text-green-300">
                  Saved in MongoDB
                </span>
              ) : null}
            </div>
          </div>

          <SourceStatusGrid
            attempts={attempts}
            selectedProvider={isOttTitleOnly ? 'tamilott' : provider}
            onSelectProvider={(providerId) => setProvider(providerId)}
          />
        </div>
      </section>
    </main>
  );
}
