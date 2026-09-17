'use client';

/*
 * components/music/MusicCurtains.jsx — the music section as the Lyric Lounge (G final).
 *
 * This is a replacement, not a reskin. The Light Curtains UI — its primitives file, its class
 * family, the docked lyrics sheet, the deck — was deleted outright, and the JSX below is written
 * against small local lounge components. What is *kept* is the logic that was
 * already correct: the wake-lock and pocket-mode lock machine, the 0.9 s pre-end auto-advance, the
 * two-track prefetch, the session cache, the quality ladder, the synced-lyrics reader, the Spotify
 * import and the song CRUD calls, on top of the `lib/musicCore.js` model. The lounge stays dark in
 * day mode too — it is a night venue, and the day theme only dims its glow.
 *
 * No `export const dynamic` anywhere: the page is static and the client fetches, so a sleeping
 * free-tier instance stays asleep on a library browse.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  artistChipsFromTrack,
  chooseBestQuality,
  dedupeQueue,
  emptySearchResults,
  formatTime,
  isHlsUrl,
  MU_MINI_DRAG_CLOSE_PX,
  muCurtainPosition,
  muCurtainVars,
  muLockView,
  muLyricRows,
  muQualityChips,
  normalizeSearchResults,
  parseSyncedLyrics,
  plainFromSyncedLyrics,
  searchResultCount,
  trackKey,
} from '@/lib/musicCore';

const MUSIC_CACHE_KEY = 'jash:music:v8-curtains';
const SONG_DETAIL_CACHE_KEY = 'jash:music:songs:v1';
const FAVORITES_KEY = 'jash_music_favorites';
const RECENTS_KEY = 'jash_music_recents';
const AUTH_STORAGE_KEY = 'jash_theatre_access_token';
const VOLUME_KEY = 'jash_music_volume';
const MUTED_KEY = 'jash_music_muted';
const LYRIC_WINDOW = 7;


/* ──────────────────────── lounge primitives (dumb: props in, markup out) ──────────────────────── */

function LlNote({ tone = 'info', children }) {
  if (!children) return null;
  return <p className={`ll-note is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}

/** The room's glow: three soft blobs tinted by the track hash. No blur surfaces anywhere. */
function LlAmbient({ vars = {}, position = 0, dim = false }) {
  return (
    <div className="ll-ambient" aria-hidden="true" data-dim={dim ? 'true' : undefined}
      style={{ '--ll-glow-a': vars['--ll-glow-a'], '--ll-glow-b': vars['--ll-glow-b'], '--ll-glow-c': vars['--ll-glow-c'], '--ll-pos': position.toFixed(4) }}>
      <span className="ll-glow ll-glow-a" />
      <span className="ll-glow ll-glow-b" />
      <span className="ll-glow ll-glow-c" />
    </div>
  );
}

/** A tile for an album / artist / playlist. One button — no control lives inside another. */
function LlTile({ item, kind = 'album', onOpen }) {
  const label = kind === 'artist' ? (item?.name || item?.title || 'Artist') : (item?.title || item?.name || 'Untitled');
  const sub = item?.subtitle || [item?.artists, item?.year, item?.songCount ? `${item.songCount} songs` : '', item?.dominantType]
    .filter(Boolean).join(' · ');
  return (
    <button type="button" className="ll-tile" onClick={() => onOpen(item)}>
      <span className="ll-tile-art">
        {item?.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="ll-tile-fallback" aria-hidden="true">{String(label).slice(0, 2)}</span>}
      </span>
      <span className="ll-tile-body">
        <span className="ll-tile-title">{label}</span>
        {sub ? <span className="ll-tile-sub">{sub}</span> : null}
      </span>
    </button>
  );
}

/** A track row. Play is the row button; favourite is a sibling, never a child. */
function LlTrackRow({ track, index = 0, active = false, favorite = false, onPlay, onFavorite, onPrefetch, durationLabel = '' }) {
  const title = track?.title || 'Untitled';
  const artist = track?.subtitle || track?.artists || '';
  return (
    <li className={`ll-row${active ? ' is-on' : ''}`}>
      <button
        type="button"
        className="ll-row-main"
        onClick={() => onPlay(track)}
        onPointerEnter={() => onPrefetch?.(track)}
        onFocus={() => onPrefetch?.(track)}
      >
        <span className="ll-row-index" aria-hidden="true">{active ? <span className="ll-row-pulse" /> : index + 1}</span>
        <span className="ll-row-art">{track?.image ? <img src={track.image} alt="" loading="lazy" /> : null}</span>
        <span className="ll-row-body">
          <span className="ll-row-title">{title}</span>
          {artist ? <span className="ll-row-artist">{artist}</span> : null}
        </span>
        {durationLabel ? <span className="ll-row-time">{durationLabel}</span> : null}
      </button>
      {onFavorite ? (
        <button type="button" className={`ll-row-fav${favorite ? ' is-on' : ''}`} aria-pressed={favorite} onClick={() => onFavorite(track)}>
          {favorite ? '★' : '☆'}<span className="ll-sr">{favorite ? ' remove from favorites' : ' add to favorites'}</span>
        </button>
      ) : null}
    </li>
  );
}

function LlTrackList({ tracks = [], activeKey = '', favoriteSet, onPlay, onFavorite, onPrefetch }) {
  return (
    <ul className="ll-rows">
      {tracks.map((track, index) => (
        <LlTrackRow
          key={`${track?.seokey || track?.id || track?.title || index}`}
          track={track}
          index={index}
          durationLabel={track?.durationLabel || ''}
          active={`${track?.seokey || track?.id || track?.title || ''}` === `${activeKey}`}
          favorite={Boolean(favoriteSet?.has?.(track?.seokey || track?.id || track?.title || ''))}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onPrefetch={onPrefetch}
        />
      ))}
    </ul>
  );
}

/** The verse: past lines recede, the current line glows gold, timed lines tap to jump. */
function LlLyrics({ rows = [], open = false, autoScroll = true, onToggleAutoScroll, blur = false, onBlurToggle, onClose, onJump, note = '', status = '', loading = false, activeRef }) {
  return (
    <div className={`ll-lyrics${open ? ' is-open' : ''}`} aria-hidden={open ? undefined : 'true'}>
      <div className="ll-lyrics-tools">
        <button type="button" className={`ll-ghost${autoScroll ? ' is-on' : ''}`} aria-pressed={autoScroll} onClick={onToggleAutoScroll} title="Auto-scroll">⇅<span className="ll-sr"> auto-scroll</span></button>
        <button type="button" className={`ll-ghost${blur ? ' is-on' : ''}`} aria-pressed={blur} onClick={onBlurToggle} title="Blur">◍<span className="ll-sr"> blur</span></button>
        {onClose ? <button type="button" className="ll-ghost" onClick={onClose} title="Close lyrics">✕<span className="ll-sr"> close lyrics</span></button> : null}
      </div>
      {status ? <p className="ll-lyrics-status">{status}</p> : null}
      {loading ? <p className="ll-lyrics-status">reading the source…</p> : null}
      {!rows.length && note ? <p className="ll-lyrics-empty">{note}</p> : null}
      <ol className={`ll-lines${blur ? ' is-blur' : ''}`}>
        {rows.map((row) => (
          <li key={`${row.index}-${row.time ?? 'x'}`} data-state={row.state} ref={row.state === 'current' ? activeRef : undefined} className="ll-line">
            {row.tappable ? (
              <button type="button" className="ll-line-btn" title={row.time != null ? formatTime(row.time) : undefined} onClick={() => onJump?.(row.time)}>
                <span className="ll-line-text">{row.text}</span>
              </button>
            ) : (
              <span className="ll-line-plain">
                <span className="ll-line-text">{row.text}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The capsule: fixed, draggable down to dismiss, hairline progress. It never becomes a second player. */
function LlMini({ visible = false, image = '', title = '', position = 0, isPlaying = false, onToggle, onNext, onDismiss, onOpen, onDragStart, onDragMove, onDragEnd, offset = 0 }) {
  if (!visible) return null;
  return (
    <div className="ll-mini" style={{ transform: offset ? `translateY(${offset}px)` : undefined, transition: offset ? 'none' : undefined }}
      onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
      <button type="button" className="ll-mini-art" onClick={onToggle} title={isPlaying ? 'Pause' : 'Play'}>
        {image ? <img src={image} alt="" /> : <span aria-hidden="true">♪</span>}
      </button>
      <button type="button" className="ll-mini-body" onClick={onOpen} title="Open player">
        <span className="ll-mini-title">{title || 'Paused'}</span>
        <span className="ll-mini-rail"><span style={{ transform: `scaleX(${position.toFixed(4)})` }} /></span>
      </button>
      <button type="button" className="ll-ghost" onClick={onToggle} aria-pressed={isPlaying}>{isPlaying ? '⏸' : '▶'}<span className="ll-sr"> {isPlaying ? 'pause' : 'play'}</span></button>
      <button type="button" className="ll-ghost" onClick={onNext}>⏭<span className="ll-sr"> next</span></button>
      <button type="button" className="ll-mini-x" onClick={onDismiss} title="Dismiss">✕<span className="ll-sr"> dismiss mini player</span></button>
    </div>
  );
}

/** The lock surface. The ring is a conic-gradient driven by `progress`: a hold readable at a glance. */
function LlVeil({ view, onHoldStart, onHoldEnd, onExit }) {
  if (!view || view.kind === 'off') return null;
  const ring = `conic-gradient(var(--ll-accent) ${view.progress}%, rgba(255,255,255,0.14) ${view.progress}%)`;
  return (
    <div className="ll-veil" role="dialog" aria-modal="true" aria-label={view.title}>
      <div className="ll-veil-inner">
        {view.kind === 'pocket' ? (
          <button
            type="button"
            className="ll-hold"
            style={{ background: ring }}
            onPointerDown={onHoldStart}
            onPointerUp={onHoldEnd}
            onPointerLeave={onHoldEnd}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onHoldStart(); }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') onHoldEnd(); }}
          >
            <span className="ll-hold-hole" />
          </button>
        ) : null}
        <p className="ll-veil-title">{view.title}</p>
        <p className="ll-veil-hint">{view.hint}</p>
        {view.status ? <p className="ll-veil-status">{view.status}</p> : null}
        {view.nextTitle ? <p className="ll-veil-next">up next · {view.nextTitle}</p> : null}
        <button type="button" className="ll-pill ll-veil-exit" onClick={onExit}>leave {view.kind === 'pocket' ? 'pocket mode' : 'listening mode'}</button>
      </div>
    </div>
  );
}

export default function MusicCurtains() {
  const videoRef = useRef(null);
  const [facet, setFacet] = useState({ id: '', status: 'idle', items: [], error: '' });
  const [trending, setTrending] = useState({ status: 'idle', items: [], error: '' });
  const [fresh, setFresh] = useState({ status: 'idle', tracks: [], albums: [], error: '' });
  const [lyricAutoScroll, setLyricAutoScroll] = useState(true);
  const [lyricBlur, setLyricBlur] = useState(false);
  const [crudQuery, setCrudQuery] = useState('');

  const playerRef = useRef(null);
  const songCacheRef = useRef(new Map());
  const prefetchingRef = useRef(new Set());
  const autoAdvanceRef = useRef(false);
  const wakeLockRef = useRef(null);
  const unlockHoldTimerRef = useRef(null);
  const activeLyricRef = useRef(null);
  const [query, setQuery] = useState('');
  const [home, setHome] = useState({ sections: [], artists: [], playlists: [], releases: { tracks: [], albums: [] } });
  const [searchResults, setSearchResults] = useState(() => emptySearchResults());
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);
  const dragStartRef = useRef(null);
  const [dragDy, setDragDy] = useState(0);
  const [showSongCrud, setShowSongCrud] = useState(false);
  const [listeningMode, setListeningMode] = useState(false);
  const [wakeLockStatus, setWakeLockStatus] = useState('idle');
  const [quality, setQuality] = useState('');
  const [status, setStatus] = useState('loading');
  const [searchStatus, setSearchStatus] = useState('idle');
  const [collectionStatus, setCollectionStatus] = useState('idle');
  const [playerStatus, setPlayerStatus] = useState('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('off');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);
  const [centerTab, setCenterTab] = useState('lyrics');
  const [cardHidden, setCardHidden] = useState(false);
  const [mSearch, setMSearch] = useState(false);
  const searchRef = useRef(null);
  const [pocketMode, setPocketMode] = useState(false);
  const [pocketHold, setPocketHold] = useState(0);
  const pocketHoldRef = useRef(null);
  useEffect(() => {
    if (!pocketMode) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [pocketMode]);
  function enterPocketMode() { if (playingTrack) setPocketMode(true); }
  function startPocketUnlock() {
    if (pocketHoldRef.current) clearInterval(pocketHoldRef.current);
    const startedAt = Date.now();
    setPocketHold(0.01);
    pocketHoldRef.current = setInterval(() => {
      const progress = (Date.now() - startedAt) / 1300;
      if (progress >= 1) { clearInterval(pocketHoldRef.current); pocketHoldRef.current = null; setPocketHold(0); setPocketMode(false); }
      else setPocketHold(Math.min(0.99, progress));
    }, 50);
  }
  function cancelPocketUnlock() {
    if (pocketHoldRef.current) { clearInterval(pocketHoldRef.current); pocketHoldRef.current = null; }
    setPocketHold(0);
  }
  const [lyrics, setLyrics] = useState('');
  const [lyricsData, setLyricsData] = useState({});
  const [lyricsStatus, setLyricsStatus] = useState('idle');
  const [error, setError] = useState('');
  const [homeWarning, setHomeWarning] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [recents, setRecents] = useState([]);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState('idle');
  const [importMessage, setImportMessage] = useState('');

  useEffect(() => {
    try {
      setFavorites(JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]'));
      setRecents(JSON.parse(window.localStorage.getItem(RECENTS_KEY) || '[]'));
      // Always start audible. Mobile has no volume UI, so never restore a saved mute/0 volume there.
      const savedVolume = Number(window.localStorage.getItem(VOLUME_KEY));
      const nextVolume = Number.isFinite(savedVolume) && savedVolume > 0.05 ? Math.min(1, Math.max(0, savedVolume)) : 1;
      setVolume(nextVolume);
      setMuted(false);
      window.localStorage.setItem(VOLUME_KEY, String(nextVolume));
      window.localStorage.setItem(MUTED_KEY, '0');
      const cachedSongs = JSON.parse(window.sessionStorage.getItem(SONG_DETAIL_CACHE_KEY) || '{}');
      Object.entries(cachedSongs).forEach(([key, value]) => songCacheRef.current.set(key, value));
    } catch {}
  }, []);

  const loadHome = useCallback(async () => {
    try {
      setStatus('loading');
      setError('');
      setHomeWarning('');
      const response = await fetch('/api/music/home', { cache: 'no-store' });
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('Music API returned a non-JSON response. The host may still be waking up.');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.warning || 'Music home failed');
      setHome(data);
      setHomeWarning(data.warning || data.warnings?.[0] || '');
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Unable to load music');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const cached = readSessionCache(MUSIC_CACHE_KEY);
    const cachedHasCards = Boolean(
      cached?.home?.sections?.some((section) => (section.items || []).length) ||
        cached?.home?.releases?.tracks?.length ||
        cached?.home?.releases?.albums?.length ||
        cached?.home?.artists?.length,
    );
    if (cachedHasCards) {
      setHome(cached.home);
      setQuery(cached.query || '');
      setSearchResults(normalizeSearchResults(cached.searchResults));
      setSelectedCollection(cached.selectedCollection || null);
      setQueue(cached.queue || []);
      setActive(cached.active || null);
      setActiveDetail(cached.activeDetail || null);
      setQuality(cached.quality || '');
      setShuffleEnabled(Boolean(cached.shuffleEnabled));
      setRepeatMode(cached.repeatMode || 'off');
      setShowLyrics(Boolean(cached.showLyrics));
      setTrending(cached.trending || { status: 'idle', items: [], error: '' });
      setFresh(cached.fresh || { status: 'idle', tracks: [], albums: [], error: '' });
      setLyrics(cached.lyrics || '');
      setLyricsData(cached.lyricsData || {});
      setHomeWarning(cached.homeWarning || cached.home?.warning || cached.home?.warnings?.[0] || '');
      setStatus(cached.status || 'ready');
      restoreScroll(MUSIC_CACHE_KEY);
      return;
    }

    loadHome();
  }, [loadHome]);

  useEffect(() => {
    writeSessionCache(MUSIC_CACHE_KEY, { home, homeWarning, query, searchResults, selectedCollection, queue, active, activeDetail, quality, shuffleEnabled, repeatMode, showLyrics, lyrics, lyricsData, status, trending, fresh });
  }, [home, homeWarning, query, searchResults, selectedCollection, queue, active, activeDetail, quality, shuffleEnabled, repeatMode, showLyrics, lyrics, lyricsData, status, trending, fresh]);

  useEffect(() => {
    const onScroll = () => saveScroll(MUSIC_CACHE_KEY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { saveScroll(MUSIC_CACHE_KEY); window.removeEventListener('scroll', onScroll); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const safeVolume = Math.min(1, Math.max(0, Number(volume) || 0));
    if (video) {
      video.volume = safeVolume;
      video.muted = muted || safeVolume === 0;
    }
    try {
      window.localStorage.setItem(VOLUME_KEY, String(safeVolume));
      window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    } catch {}
  }, [volume, muted]);

  useEffect(() => {
    if (!active && showMiniPlayer) setShowMiniPlayer(false);
  }, [active, showMiniPlayer]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && listeningMode) requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [listeningMode]);

  useEffect(() => {
    return () => {
      try { wakeLockRef.current?.release?.(); } catch {}
      if (unlockHoldTimerRef.current) window.clearTimeout(unlockHoldTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const detail = activeDetail || active;
    const url = activeDetail?.streamUrls?.[quality] || '';
    window.getPlayerStatus = () => ({
      currentTime: Math.round((videoRef.current?.currentTime || 0) * 1000),
      isPaused: videoRef.current ? videoRef.current.paused : !isPlaying,
      album: detail?.album || 'JaSH ViBeS',
      artist: detail?.artists || 'Tamil Music',
      title: detail?.title || 'JaSH ViBeS',
      artwork: detail?.image || '',
      url,
    });
    window.updatePlayerStatus = (mediaPlayerStatus = {}) => {
      const video = videoRef.current;
      if (!video) return;
      if (Number(mediaPlayerStatus.currentTime) > 0) video.currentTime = Number(mediaPlayerStatus.currentTime) / 1000;
      if (mediaPlayerStatus.isPaused && !video.paused) video.pause();
      else if (mediaPlayerStatus.isPaused === false && video.paused) video.play().catch(() => {});
    };
    return () => {
      if (window.getPlayerStatus) delete window.getPlayerStatus;
      if (window.updatePlayerStatus) delete window.updatePlayerStatus;
    };
  }, [activeDetail, active, quality, isPlaying]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) { setSearchResults(emptySearchResults()); setSearchStatus('idle'); return; }
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setSearchStatus('loading');
        const response = await fetch(`/api/music/search?q=${encodeURIComponent(trimmed)}&limit=40`, { signal: controller.signal, cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Search failed');
        setSearchResults(normalizeSearchResults(data));
        setSearchStatus('ready');
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message || 'Search failed');
        setSearchStatus('error');
      }
    }, 260);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [query]);

  async function getTrackDetail(track) {
    const key = trackKey(track);
    if (!key) throw new Error('Invalid song');
    if (track?.streamUrls && Object.values(track.streamUrls).some(Boolean)) {
      songCacheRef.current.set(key, track);
      return track;
    }
    if (songCacheRef.current.has(key)) return songCacheRef.current.get(key);
    if (!track?.seokey) throw new Error('Song stream id missing');
    const response = await fetch(`/api/music/song?seokey=${encodeURIComponent(track.seokey)}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Unable to load song stream');
    songCacheRef.current.set(key, data.item);
    try {
      const obj = Object.fromEntries(songCacheRef.current.entries());
      window.sessionStorage.setItem(SONG_DETAIL_CACHE_KEY, JSON.stringify(obj));
    } catch {}
    return data.item;
  }

  const playTrack = useCallback((track, nextQueue = null, autoplay = true) => {
    if (!track) return;
    if (Array.isArray(nextQueue) && nextQueue.length) setQueue(dedupeQueue(nextQueue));
    autoAdvanceRef.current = false;
    setShouldAutoplay(autoplay);
    setActive(track);
    if (track.streamUrls && Object.values(track.streamUrls).some(Boolean)) {
      setActiveDetail(track);
      setQuality(chooseBestQuality(track.streamUrls));
    }
  }, []);

  useEffect(() => {
    if (!active?.seokey) return;
    let cancelled = false;
    async function loadSong() {
      try {
        setPlayerStatus('loading');
        setError('');
        setLyrics('');
        setLyricsData({});
        setLyricsStatus('idle');
        setShowLyrics(false);
        const detail = await getTrackDetail(active);
        if (cancelled) return;
        setActiveDetail(detail);
        setQuality(chooseBestQuality(detail.streamUrls || {}));
        const nextRecents = [detail, ...recents.filter((item) => item && item.seokey !== detail.seokey)].slice(0, 12);
        setRecents(nextRecents);
        window.localStorage.setItem(RECENTS_KEY, JSON.stringify(nextRecents));
      } catch (err) {
        if (!cancelled) { setPlayerStatus('error'); setError(err.message || 'Unable to load song stream'); }
      }
    }
    loadSong();
    return () => { cancelled = true; };
  }, [active?.seokey]);

  useEffect(() => {
    const url = activeDetail?.streamUrls?.[quality];
    if (!url || !videoRef.current) return;
    let cancelled = false;
    let loadTimer = null;
    const video = videoRef.current;
    async function destroyPlayer() { if (playerRef.current) { try { await playerRef.current.destroy(); } catch {} playerRef.current = null; } }
    function markReadyAndMaybePlay() {
      if (cancelled) return;
      if (loadTimer) window.clearTimeout(loadTimer);
      setPlayerStatus('ready');
      if (shouldAutoplay) video.play().catch(() => setIsPlaying(false));
    }
    async function play() {
      try {
        setPlayerStatus('loading');
        setCurrentTime(0); setDuration(0);
        loadTimer = window.setTimeout(() => { if (!cancelled) { setPlayerStatus('error'); setError('Stream took too long to start. Try another song or quality.'); } }, 18000);
        await destroyPlayer();
        if (cancelled) return;
        video.pause(); video.removeAttribute('src'); video.load();
        const onCanPlay = () => markReadyAndMaybePlay();
        const onError = () => { if (!cancelled) { if (loadTimer) window.clearTimeout(loadTimer); setPlayerStatus('error'); setError('This audio stream could not be loaded. Try another quality.'); } };
        video.addEventListener('canplay', onCanPlay, { once: true });
        video.addEventListener('loadedmetadata', onCanPlay, { once: true });
        video.addEventListener('error', onError, { once: true });
        if (!isHlsUrl(url)) { video.src = url; video.preload = 'auto'; video.autoplay = Boolean(shouldAutoplay); video.load(); if (shouldAutoplay) video.play().catch(() => {}); return; }
        const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
        const shaka = shakaModule.default || window.shaka || shakaModule;
        shaka.polyfill?.installAll?.();
        const player = new shaka.Player();
        playerRef.current = player;
        await player.attach(video);
        player.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 2 }, abr: { enabled: true } });
        player.addEventListener('error', (event) => { if (!cancelled) { if (loadTimer) window.clearTimeout(loadTimer); console.error('[music] Shaka error:', event.detail); setPlayerStatus('error'); setError(`Music playback error${event.detail?.code ? ` ${event.detail.code}` : ''}`); } });
        await player.load(url, undefined, 'application/x-mpegurl');
        if (!cancelled) markReadyAndMaybePlay();
      } catch (err) {
        if (loadTimer) window.clearTimeout(loadTimer);
        if (!cancelled) { setPlayerStatus('error'); setError(err.message || 'Music playback failed'); }
      }
    }
    play();
    return () => { cancelled = true; if (loadTimer) window.clearTimeout(loadTimer); destroyPlayer(); };
  }, [activeDetail?.seokey, quality, shouldAutoplay]);

  const queueTracks = useMemo(() => queue.length ? queue : dedupeQueue([...(home.sections?.[0]?.items || []), ...(home.releases?.tracks || [])]), [queue, home]);

  async function prefetchTrack(track) {
    const key = trackKey(track);
    if (!key || songCacheRef.current.has(key) || prefetchingRef.current.has(key)) return;
    prefetchingRef.current.add(key);
    try { await getTrackDetail(track); } catch {} finally { prefetchingRef.current.delete(key); }
  }

  useEffect(() => {
    if (!activeDetail) return;
    const currentKey = trackKey(activeDetail);
    const index = queueTracks.findIndex((track) => trackKey(track) === currentKey);
    [queueTracks[index + 1], queueTracks[index + 2]].filter(Boolean).forEach(prefetchTrack);
  }, [activeDetail?.seokey, queueTracks]);

  const activeKey = trackKey(activeDetail || active);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const favoriteTracks = useMemo(() => dedupeQueue([...queueTracks, ...recents]).filter((track) => favoriteSet.has(trackKey(track))), [queueTracks, recents, favoriteSet]);

  function playNext(fromEnded = false) {
    const video = videoRef.current;
    if (fromEnded && repeatMode === 'one' && video) { video.currentTime = 0; setShouldAutoplay(true); video.play().catch(() => {}); return; }
    if (!queueTracks.length) return;
    const currentKey = trackKey(activeDetail || active);
    const currentIndex = Math.max(0, queueTracks.findIndex((track) => trackKey(track) === currentKey));
    let nextTrack = null;
    if (shuffleEnabled && queueTracks.length > 1) {
      const candidates = queueTracks.filter((track) => trackKey(track) !== currentKey);
      nextTrack = candidates[Math.floor(Math.random() * candidates.length)];
    } else if (currentIndex < queueTracks.length - 1) nextTrack = queueTracks[currentIndex + 1];
    else if (repeatMode === 'all') nextTrack = queueTracks[0];
    if (nextTrack) playTrack(nextTrack, queueTracks, true);
    else setIsPlaying(false);
  }

  function playPrevious() {
    if (!queueTracks.length) return;
    const currentKey = trackKey(activeDetail || active);
    const currentIndex = queueTracks.findIndex((track) => trackKey(track) === currentKey);
    const previous = currentIndex > 0 ? queueTracks[currentIndex - 1] : queueTracks[queueTracks.length - 1];
    if (previous) playTrack(previous, queueTracks, true);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      const now = video.currentTime || 0;
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      setCurrentTime(now);

      // Android/Chrome can suspend page JS exactly when a hidden media element
      // reaches ended while the phone is locked. Advance just before the end so
      // the next source is prepared while the current media session is still alive.
      if (
        total > 20 &&
        repeatMode !== 'one' &&
        !autoAdvanceRef.current &&
        total - now <= 0.9 &&
        queueTracks.length > 1
      ) {
        autoAdvanceRef.current = true;
        playNext(true);
      }
    };
    const onDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => { if (!autoAdvanceRef.current) playNext(true); };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('durationchange', onDuration); video.removeEventListener('loadedmetadata', onDuration); video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); video.removeEventListener('ended', onEnded); };
  }, [activeKey, repeatMode, shuffleEnabled, queueTracks]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const detail = activeDetail || active;
    if (!detail) return;

    try {
      const artwork = detail.image
        ? [
            { src: detail.image, sizes: '96x96' },
            { src: detail.image, sizes: '192x192' },
            { src: detail.image, sizes: '512x512' },
          ]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: detail.title || 'JaSH ViBeS',
        artist: detail.artists || 'Tamil Music',
        album: detail.album || 'JaSH ViBeS',
        artwork,
      });
    } catch {}

    const video = videoRef.current;
    const handlers = {
      play: () => { setShouldAutoplay(true); videoRef.current?.play?.().catch(() => {}); },
      pause: () => videoRef.current?.pause?.(),
      previoustrack: () => playPrevious(),
      nexttrack: () => playNext(false),
      seekbackward: (event) => {
        const node = videoRef.current;
        if (!node) return;
        seekTo(Math.max(0, (node.currentTime || 0) - (event.seekOffset || 10)));
      },
      seekforward: (event) => {
        const node = videoRef.current;
        if (!node) return;
        seekTo(Math.min(duration || Number.MAX_SAFE_INTEGER, (node.currentTime || 0) + (event.seekOffset || 10)));
      },
      seekto: (event) => {
        if (event.seekTime === undefined) return;
        const node = videoRef.current;
        if (event.fastSeek && node?.fastSeek) node.fastSeek(event.seekTime);
        else seekTo(event.seekTime);
      },
    };

    Object.entries(handlers).forEach(([action, handler]) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    });
    try { navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'; } catch {}

    return () => {
      Object.keys(handlers).forEach((action) => {
        try { navigator.mediaSession.setActionHandler(action, null); } catch {}
      });
    };
  }, [activeDetail?.seokey, active?.seokey, isPlaying, duration, repeatMode, shuffleEnabled, queueTracks]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession?.setPositionState) return;
    if (!duration || !Number.isFinite(duration)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: videoRef.current?.playbackRate || 1,
        position: Math.min(currentTime || 0, duration),
      });
    } catch {}
  }, [currentTime, duration]);

  function toggleFavorite(track) {
    const key = trackKey(track);
    const next = favoriteSet.has(key) ? favorites.filter((item) => item !== key) : [...favorites, key];
    setFavorites(next);
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!active && queueTracks[0]) { playTrack(queueTracks[0], queueTracks, true); return; }
    if (!video) return;
    if (video.paused) { setShouldAutoplay(true); video.play().catch(() => {}); } else video.pause();
  }

  function cycleRepeat() { setRepeatMode((mode) => mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off'); }
  function seekTo(value) { const video = videoRef.current; if (!video) return; video.currentTime = Number(value) || 0; setCurrentTime(video.currentTime); }
  function changeVolume(value) {
    const next = Math.min(1, Math.max(0, Number(value) || 0));
    setVolume(next);
    setMuted(next === 0);
  }
  function toggleMute() {
    if (muted || volume === 0) {
      if (volume === 0) setVolume(0.7);
      setMuted(false);
    } else setMuted(true);
  }

  async function requestWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      setWakeLockStatus('unsupported');
      return false;
    }
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) return true;
      const lock = await navigator.wakeLock.request('screen');
      wakeLockRef.current = lock;
      setWakeLockStatus('active');
      lock.addEventListener?.('release', () => {
        if (listeningMode && document.visibilityState === 'visible') setWakeLockStatus('released');
      });
      return true;
    } catch (error) {
      setWakeLockStatus(error?.name === 'NotAllowedError' ? 'blocked' : 'error');
      return false;
    }
  }

  async function enableListeningMode() {
    setListeningMode(true);
    setWakeLockStatus('requesting');
    await requestWakeLock();
  }

  async function disableListeningMode() {
    setListeningMode(false);
    setWakeLockStatus('idle');
    if (unlockHoldTimerRef.current) window.clearTimeout(unlockHoldTimerRef.current);
    unlockHoldTimerRef.current = null;
    try { await wakeLockRef.current?.release?.(); } catch {}
    wakeLockRef.current = null;
  }

  function toggleListeningMode() {
    if (listeningMode) disableListeningMode();
    else enableListeningMode();
  }

  function startUnlockHold() {
    if (unlockHoldTimerRef.current) window.clearTimeout(unlockHoldTimerRef.current);
    unlockHoldTimerRef.current = window.setTimeout(() => disableListeningMode(), 1500);
  }

  function cancelUnlockHold() {
    if (unlockHoldTimerRef.current) window.clearTimeout(unlockHoldTimerRef.current);
    unlockHoldTimerRef.current = null;
  }

  function closeMiniPlayer() {
    setShowMiniPlayer(false);
    setShowLyrics(false);
  }

  function wakeLockStatusText() {
    if (wakeLockStatus === 'active') return 'Screen awake is active';
    if (wakeLockStatus === 'requesting') return 'Requesting screen wake lock...';
    if (wakeLockStatus === 'unsupported') return 'Wake Lock is not supported here, but touch lock is active';
    if (wakeLockStatus === 'blocked') return 'Wake Lock blocked by browser/battery settings, touch lock is active';
    if (wakeLockStatus === 'released') return 'Wake Lock was released; keep app visible to reactivate';
    if (wakeLockStatus === 'error') return 'Wake Lock failed, touch lock is active';
    return 'Touch lock active';
  }

  async function openLyrics() {
    const detail = activeDetail || active;
    setShowMiniPlayer(true);
    setShowLyrics(true);
    const loadedFor = lyricsData?.loadedFor;
    const currentKey = trackKey(detail);
    if ((lyrics || lyricsData?.plainLyrics || lyricsData?.syncedLyrics) && loadedFor === currentKey) return;
    if (!detail?.trackId && !detail?.title) {
      setLyrics('Select a song first.');
      setLyricsStatus('error');
      return;
    }
    try {
      setLyricsStatus('loading');
      const params = new URLSearchParams();
      if (detail.trackId) params.set('id', detail.trackId);
      if (detail.seokey) params.set('seokey', detail.seokey);
      if (detail.title) params.set('title', detail.title);
      if (detail.artists) params.set('artist', detail.artists);
      if (detail.album) params.set('album', detail.album);
      if (detail.duration) params.set('duration', detail.duration);
      const response = await fetch(`/api/music/lyrics?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || data?.message || 'Lyrics unavailable');
      const plainText = data.plainLyrics || data.lyrics || plainFromSyncedLyrics(data.syncedLyrics || '');
      const nextLyricsData = { ...data, loadedFor: currentKey };
      setLyricsData(nextLyricsData);
      setLyrics(plainText || data.message || 'Lyrics unavailable for this song.');
      setLyricsStatus(data.lyrics || data.plainLyrics || data.syncedLyrics ? 'ready' : 'error');
    } catch (error) {
      setLyricsData({ loadedFor: currentKey, source: 'error' });
      setLyrics(error.message || 'Lyrics unavailable for this song.');
      setLyricsStatus('error');
    }
  }


  async function openArtist(artist) {
    const artistId = String(artist?.id || artist?.name || '').trim();
    const artistName = String(artist?.name || artistId || '').trim();
    if (!artistId && !artistName) return;
    try {
      setCollectionStatus('loading');
      setSelectedCollection({ type: 'artist', title: artistName || artistId, image: artist?.image, tracks: [], albums: [] });
      const response = await fetch(`/api/music/artist?id=${encodeURIComponent(artistId || artistName)}&name=${encodeURIComponent(artistName || artistId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Artist failed');
      const item = data.item;
      const tracks = dedupeQueue([...(item.topSongs || []), ...(item.singles || [])]);
      setSelectedCollection({ type: 'artist', title: item.name, subtitle: `${item.dominantType || 'Artist'}${item.fanCount ? ` • ${item.fanCount} fans` : ''}`, image: item.image, tracks, albums: item.topAlbums || [], related: item.similarArtists || [] });
      setQueue(tracks);
      setCenterTab('trending');
      setCollectionStatus('ready');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setCollectionStatus('error'); setError(err.message || 'Unable to load artist'); }
  }

  async function loadAllArtistAlbums() {
    if (!selectedCollection?.title) return;
    try {
      setCollectionStatus('loading');
      const response = await fetch(`/api/music/albums?q=${encodeURIComponent(`${selectedCollection.title} Tamil`)}&limit=50`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to load albums');
      setSelectedCollection((current) => ({ ...current, albums: data.items?.length ? data.items : current.albums, albumsExpanded: true }));
      setCollectionStatus('ready');
    } catch (err) { setCollectionStatus('error'); setError(err.message || 'Unable to load albums'); }
  }

  async function openAlbum(album) {
    if (!album?.id) return;
    try {
      setCollectionStatus('loading');
      setSelectedCollection({ type: 'album', title: album.title, image: album.image, tracks: [], albums: [] });
      const response = await fetch(`/api/music/album?id=${encodeURIComponent(album.id)}&title=${encodeURIComponent(album.title || '')}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Album failed');
      const item = data.item;
      const tracks = item.songs || [];
      setSelectedCollection({ type: 'album', title: item.title, subtitle: `${item.artists || 'Album'}${item.year ? ` • ${item.year}` : ''}${item.songCount ? ` • ${item.songCount} songs` : ''}`, image: item.image, tracks, albums: [] });
      setQueue(tracks);
      setCenterTab('trending');
      setCollectionStatus('ready');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setCollectionStatus('error'); setError(err.message || 'Unable to load album'); }
  }

  async function openPlaylist(playlist) {
    if (!playlist?.id) return;
    try {
      setCollectionStatus('loading');
      setShowSongCrud(false);
      setSelectedCollection({ type: 'playlist', title: playlist.title, image: playlist.image, tracks: [], albums: [] });
      const response = await fetch(`/api/music/playlist?id=${encodeURIComponent(playlist.id)}&title=${encodeURIComponent(playlist.title || '')}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Playlist failed');
      const item = data.item;
      const tracks = item.songs || [];
      setSelectedCollection({ type: 'playlist', id: item.id || playlist.id, isImported: Boolean(item.isImported || playlist.isImported), sourceUrl: item.sourceUrl || playlist.sourceUrl || '', title: item.title, subtitle: `${item.songCount || tracks.length || 0} songs`, image: item.image, tracks, albums: [] });
      setQueue(tracks);
      setCenterTab('trending');
      setCollectionStatus('ready');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { setCollectionStatus('error'); setError(err.message || 'Unable to load playlist'); }
  }

  function authHeaders() {
    const token = typeof window !== 'undefined' ? window.localStorage.getItem(AUTH_STORAGE_KEY) : '';
    return token ? { 'x-jash-token': token } : {};
  }

  async function refreshImportedPlaylists() {
    const response = await fetch('/api/music/playlists', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Unable to load playlists');
    setHome((current) => ({ ...current, playlists: data.items || [], importedPlaylists: data.items || [] }));
    return data.items || [];
  }

  async function importSpotifyPlaylists() {
    const raw = importText.trim();
    if (!raw) { setImportMessage('Paste one or more public Spotify playlist links first.'); return; }
    try {
      setImportStatus('importing');
      setImportMessage('Importing Spotify playlists and matching songs on JioSaavn...');
      const response = await fetch('/api/music/playlists', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ urlsText: raw }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Spotify import failed');
      await refreshImportedPlaylists();
      setImportText('');
      setCenterTab('playlists');
      setImportStatus(data.ok ? 'done' : 'error');
      const imported = data.imported || [];
      const failed = data.failed || 0;
      const firstError = (data.results || []).find((item) => !item.ok)?.error || '';
      setImportMessage(`Imported ${imported.length} playlist${imported.length === 1 ? '' : 's'}${failed ? ` • ${failed} failed${firstError ? `: ${firstError}` : ''}` : ''}.`);
    } catch (err) {
      setImportStatus('error');
      setImportMessage(err.message || 'Spotify import failed');
    }
  }

  async function renameImportedPlaylist(playlist) {
    const title = window.prompt('Playlist name', playlist.title || '');
    if (!title || title.trim() === playlist.title) return;
    try {
      setImportStatus('saving');
      const response = await fetch('/api/music/playlists', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: playlist.id, title: title.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Rename failed');
      await refreshImportedPlaylists();
      setImportStatus('done');
      setImportMessage('Playlist renamed.');
    } catch (err) {
      setImportStatus('error');
      setImportMessage(err.message || 'Rename failed');
    }
  }

  async function deleteImportedPlaylist(playlist) {
    if (!window.confirm(`Delete playlist “${playlist.title}”?`)) return;
    try {
      setImportStatus('saving');
      const response = await fetch(`/api/music/playlists?id=${encodeURIComponent(playlist.id)}`, {
        method: 'DELETE',
        cache: 'no-store',
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Delete failed');
      await refreshImportedPlaylists();
      setImportStatus('done');
      setImportMessage('Playlist deleted.');
      if (selectedCollection?.type === 'playlist' && selectedCollection.title === playlist.title) setSelectedCollection(null);
    } catch (err) {
      setImportStatus('error');
      setImportMessage(err.message || 'Delete failed');
    }
  }

  async function resyncImportedPlaylist(playlist) {
    if (!playlist?.sourceUrl) return;
    try {
      setImportStatus('importing');
      setImportMessage(`Refreshing ${playlist.title} from Spotify...`);
      const response = await fetch('/api/music/playlists', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ url: playlist.sourceUrl }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Refresh failed');
      await refreshImportedPlaylists();
      setImportStatus('done');
      setImportMessage(`Refreshed ${playlist.title}.`);
    } catch (err) {
      setImportStatus('error');
      setImportMessage(err.message || 'Refresh failed');
    }
  }

  async function mutateImportedPlaylistTrack(action, track = null, query = '') {
    if (!selectedCollection?.id) return;
    try {
      setImportStatus('saving');
      const response = await fetch('/api/music/playlist/tracks', {
        method: 'PATCH',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          playlistId: selectedCollection.id,
          action,
          trackKey: track ? trackKey(track) : '',
          query,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Track update failed');
      const item = data.item;
      const tracks = item.songs || item.tracks || [];
      setSelectedCollection((current) => ({
        ...(current || {}),
        title: item.title || current?.title,
        subtitle: `${item.songCount || tracks.length || 0} songs`,
        image: item.image || current?.image,
        tracks,
      }));
      setQueue(tracks);
      await refreshImportedPlaylists().catch(() => []);
      setImportStatus('done');
      setImportMessage(action === 'remove' ? 'Track removed.' : action === 'replace' ? 'Track replaced.' : 'Track added.');
    } catch (err) {
      setImportStatus('error');
      setImportMessage(err.message || 'Track update failed');
    }
  }

  function removeImportedTrack(track) {
    if (!window.confirm(`Remove “${track?.title || 'this song'}” from this playlist?`)) return;
    mutateImportedPlaylistTrack('remove', track);
  }

  function replaceImportedTrack(track) {
    const query = window.prompt('Search JioSaavn replacement', `${track?.spotify?.title || track?.title || ''} ${track?.spotify?.album || track?.album || ''}`.trim());
    if (!query) return;
    mutateImportedPlaylistTrack('replace', track, query);
  }

  function addImportedTrack() {
    const query = window.prompt('Search and add JioSaavn song');
    if (!query) return;
    mutateImportedPlaylistTrack('add', null, query);
  }

  const rawSections = home.sections || [];
  const mainSections = rawSections.filter((section) => (section.items || []).length);
  const importedPlaylists = home.playlists || [];
  const activeKeyValue = activeKey;
  const searchSongsList = searchResults.songs || [];
  const searchAlbumsList = searchResults.albums || [];
  const searchArtistsList = searchResults.artists || [];
  const searchPlaylistsList = searchResults.playlists || [];
  const searchTotal = searchResultCount(searchResults);
  const playingTrack = activeDetail || active;
  const currentArtistChips = artistChipsFromTrack(playingTrack);
  const playingImage = playingTrack?.image || '';
  const syncedLyricLines = useMemo(() => parseSyncedLyrics(lyricsData?.syncedLyrics || ''), [lyricsData?.syncedLyrics]);
  const activeLyricLineIndex = useMemo(() => {
    if (!syncedLyricLines.length) return -1;
    let index = 0;
    for (let i = 0; i < syncedLyricLines.length; i += 1) {
      if (currentTime + 0.25 >= syncedLyricLines[i].time) index = i;
      else break;
    }
    return index;
  }, [syncedLyricLines, currentTime]);
  const effectiveVolume = muted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0));
  const volumeIcon = effectiveVolume === 0 ? '🔇' : effectiveVolume < 0.45 ? '🔉' : '🔊';
  useEffect(() => {
    if (showLyrics && lyricAutoScroll && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [showLyrics, activeLyricLineIndex, centerTab]);

  /* ───────────────────────────── new design surface ───────────────────────────── */

  // A tab asks the facet endpoint for itself. `home` is a summary, and passing its summary off as the whole
  // facet is how a library advertises "Albums 0" while the albums endpoint has results.
  const loadFacet = useCallback(async (id, searchTerm = '') => {
    if (!id) return;
    setFacet({ id, status: 'loading', items: [], error: '' });
    const url = id === 'playlists'
      ? '/api/music/playlists'
      : `/api/music/${id}?q=${encodeURIComponent(String(searchTerm || '').trim() || (id === 'albums' ? 'tamil' : ''))}&limit=48`;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `${id} lookup failed`);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setFacet({ id, status: 'ready', items, error: '' });
    } catch (err) {
      setFacet({ id, status: 'error', items: [], error: err.message || `${id} lookup failed` });
    }
  }, []);

  const loadTrending = useCallback(async () => {
    setTrending((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const response = await fetch('/api/music/trending?limit=48', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'trending lookup failed');
      setTrending({ status: 'ready', items: Array.isArray(data?.items) ? data.items : [], error: '' });
    } catch (err) {
      setTrending({ status: 'error', items: [], error: err.message || 'trending lookup failed' });
    }
  }, []);

  const loadFresh = useCallback(async () => {
    setFresh((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const response = await fetch('/api/music/new?limit=48', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'new releases lookup failed');
      setFresh({
        status: 'ready',
        tracks: Array.isArray(data?.tracks) ? data.tracks : [],
        albums: Array.isArray(data?.albums) ? data.albums : [],
        error: '',
      });
    } catch (err) {
      setFresh({ status: 'error', tracks: [], albums: [], error: err.message || 'new releases lookup failed' });
    }
  }, []);

  const curtainVars = useMemo(() => muCurtainVars(trackKey(playingTrack) || 'idle'), [playingTrack]);
  const curtainPosition = muCurtainPosition(currentTime, duration);
  const lyricRows = useMemo(
    () => muLyricRows(syncedLyricLines, activeLyricLineIndex, { radius: LYRIC_WINDOW }),
    [syncedLyricLines, activeLyricLineIndex],
  );
  const plainLyricLines = useMemo(() => {
    const text = String(lyrics || plainFromSyncedLyrics(lyricsData?.syncedLyrics || '')).trim();
    if (!text) return [];
    return text.split('\n').filter(Boolean).map((line, index) => ({ index, text: line, time: null, state: 'plain', tappable: false, visible: true }));
  }, [lyrics, lyricsData?.syncedLyrics]);
  const qualityChips = muQualityChips(activeDetail?.streamUrls || {}, quality);
  const upNext = useMemo(() => {
    const key = trackKey(playingTrack);
    const index = queueTracks.findIndex((track) => trackKey(track) === key);
    return index >= 0 ? (queueTracks[index + 1] || queueTracks[0]) : queueTracks[0];
  }, [queueTracks, playingTrack]);
  const lockView = useMemo(() => muLockView({
    pocketMode,
    listeningMode,
    wakeLockStatus,
    hold: pocketHold,
    nextTitle: upNext?.title || '',
  }), [pocketMode, listeningMode, wakeLockStatus, pocketHold, upNext?.title]);
  const fromFacet = (id, fallback) => (facet.id === id && facet.items.length ? facet.items.length : fallback);
  const facetCounts = {
    albums: fromFacet('albums', home?.releases?.albums?.length || searchResults?.albums?.length || 0),
    artists: fromFacet('artists', home?.artists?.length || searchResults?.artists?.length || 0),
    playlists: fromFacet('playlists', importedPlaylists.length || searchResults?.playlists?.length || 0),
  };
  const facetHome = { albums: home?.releases?.albums || [], artists: home?.artists || [], playlists: importedPlaylists };
  const facetLists = {
    albums: facet.id === 'albums' && facet.items.length ? facet.items : facetHome.albums,
    artists: facet.id === 'artists' && facet.items.length ? facet.items : facetHome.artists,
    playlists: facet.id === 'playlists' && facet.items.length ? facet.items : facetHome.playlists,
  };
  const rowsFor = (list) => (list || []).filter(Boolean);
  const allShelfSongs = useMemo(() => dedupeQueue([
    ...mainSections.flatMap((section) => rowsFor(section.items).filter((item) => !(item?.type === 'album' || item?.type === 'playlist'))),
    ...rowsFor(home?.releases?.tracks),
  ]), [home]);
  const shelfCollections = useMemo(() => mainSections.flatMap((section) => rowsFor(section.items).filter((item) => item?.type === 'album' || item?.type === 'playlist')), [home]);
  const trendingShelf = useMemo(() => mainSections.find((section) => section.title === 'Trending Now'), [home]);

  return (
    <main className="ll jv-rail-shift">
      <LlAmbient vars={curtainVars} position={curtainPosition} dim={pocketMode || listeningMode} />
      <RailNav onOpenSearch={() => { setQuery(''); setCenterTab('trending'); setMSearch(true); }} />

      <div className="ll-inner">
        <header className={`ll-top${mSearch ? ' ll-msearch-open' : ''}`}>
          <p className="ll-brand"><span className="ll-brand-bars" aria-hidden="true"><span /><span /><span /><span /></span><span className="ll-sr">Music</span></p>
          <label className="ll-search">
            <span className="ll-sr">Search Tamil songs</span>
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search Tamil Songs..."
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <nav className="ll-nav" aria-label="Music">
            <button type="button" className={`ll-nav-btn${centerTab === 'trending' ? ' is-on' : ''}`} onClick={() => { setCenterTab('trending'); setSelectedCollection(null); setQuery(''); if (trending.status === 'idle') loadTrending(); }}>Home</button>
            <button type="button" className={`ll-nav-btn${centerTab === 'tracks' ? ' is-on' : ''}`} onClick={() => { setCenterTab('tracks'); setSelectedCollection(null); setQuery(''); }}>Explore</button>
            <button type="button" className={`ll-nav-btn${centerTab === 'library' ? ' is-on' : ''}`} onClick={() => { setCenterTab('library'); setSelectedCollection(null); setQuery(''); }}>My Library</button>
          </nav>
          <div className="ll-icons" role="group" aria-label="Quick actions">
            {playingTrack ? <button type="button" className={`ll-ghost${favoriteSet.has(trackKey(playingTrack)) ? ' is-on' : ''}`} onClick={() => toggleFavorite(playingTrack)} title="Favorite">♥<span className="ll-sr"> favorite</span></button> : null}
            <button type="button" className="ll-ghost" onClick={() => searchRef.current?.focus()} title="Search">⌕<span className="ll-sr"> search</span></button>
            <button type="button" className="ll-ghost" onClick={() => setCenterTab('trending')} title="Trending">▦<span className="ll-sr"> trending</span></button>
          </div>
          <button type="button" className="ll-msearch" aria-pressed={mSearch} onClick={() => setMSearch((current) => !current)} title="Search">⌕<span className="ll-sr"> search</span></button>
        </header>

        {homeWarning ? <LlNote>{homeWarning}</LlNote> : null}
        {error ? <LlNote tone="error">{error}</LlNote> : null}

        <div className="ll-stage">
          {!cardHidden ? (
            <section className="ll-deck" aria-label="Now playing">
              <div className="ll-art" data-playing={isPlaying ? 'true' : undefined}>
                {playingImage ? <img src={playingImage} alt="" /> : <span className="ll-art-empty" aria-hidden="true">♪</span>}
              </div>
              <div className="ll-deck-meta">
                <h2 className="ll-track">{playingTrack?.title || 'Nothing playing'}</h2>
                <p className="ll-artist">
                  {currentArtistChips.length
                    ? currentArtistChips.map((artist) => (
                      <button key={artist.id || artist.name} type="button" className="ll-artist-chip" onClick={() => { openArtist({ id: artist.id || artist.name, name: artist.name, image: artist.image }); }}>{artist.name}</button>
                    ))
                    : (playingTrack?.subtitle || playingTrack?.artists || 'Pick a song to start the night')}
                </p>
              </div>
              <div className="ll-transport" role="group" aria-label="Playback">
                <button type="button" className="ll-tbtn" onClick={playPrevious} title="Previous">⏮<span className="ll-sr"> previous</span></button>
                <button type="button" className="ll-tbtn ll-tbtn-play" aria-pressed={isPlaying} onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? '⏸' : '▶'}<span className="ll-sr"> {isPlaying ? 'pause' : 'play'}</span></button>
                <button type="button" className="ll-tbtn" onClick={() => playNext()} title="Next">⏭<span className="ll-sr"> next</span></button>
              </div>
              <div className="ll-progress" aria-hidden="true">
                <span className="ll-progress-fill" style={{ transform: `scaleX(${curtainPosition.toFixed(4)})` }} />
              </div>
              <p className="ll-time"><span>{formatTime(currentTime)}</span><span>{duration ? formatTime(duration) : '--:--'}</span></p>
              {qualityChips.length ? (
                <div className="ll-quality" role="group" aria-label="Stream quality">
                  {qualityChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className={`ll-qchip${chip.current ? ' is-on' : ''}`}
                      aria-pressed={chip.current}
                      onClick={() => setQuality(chip.key)}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="ll-extras" role="group" aria-label="Player options">
                <button type="button" className={`ll-ghost${shuffleEnabled ? ' is-on' : ''}`} aria-pressed={shuffleEnabled} onClick={() => setShuffleEnabled((current) => !current)} title="Shuffle">⇄<span className="ll-sr"> shuffle</span></button>
                <button type="button" className={`ll-ghost${repeatMode !== 'off' ? ' is-on' : ''}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === 'one' ? '🔂' : '🔁'}<span className="ll-sr"> repeat {repeatMode}</span></button>
                <button type="button" className={`ll-ghost${showLyrics ? ' is-on' : ''}`} aria-pressed={showLyrics} onClick={() => { const next = !showLyrics; setShowLyrics(next); setCenterTab(next ? 'lyrics' : 'trending'); if (next) openLyrics(); }} title="Lyrics">lyrics</button>
                {playingTrack ? <button type="button" className={`ll-ghost${favoriteSet.has(trackKey(playingTrack)) ? ' is-on' : ''}`} aria-pressed={favoriteSet.has(trackKey(playingTrack))} onClick={() => toggleFavorite(playingTrack)} title="Favorite">♥<span className="ll-sr"> favorite</span></button> : null}
                {playingTrack ? <button type="button" className="ll-ghost" onClick={enterPocketMode} title="Pocket mode">lock</button> : null}
                <button type="button" className="ll-ghost" onClick={() => loadHome()} title="Refresh the shelves">{status === 'loading' ? '…' : '⟳'}<span className="ll-sr"> refresh</span></button>
              </div>
              <label className="ll-vol">
                <button type="button" className="ll-ghost" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>{volumeIcon}<span className="ll-sr"> {muted ? 'unmute' : 'mute'}</span></button>
                <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => changeVolume(event.target.value)} />
              </label>
              <button type="button" className="ll-deck-x" onClick={() => setCardHidden(true)} title="Hide player">✕<span className="ll-sr"> hide player</span></button>
            </section>
          ) : null}

          <div className="ll-center">
            <div className="ll-centertabs" role="tablist" aria-label="Center">
              <button type="button" role="tab" aria-selected={centerTab === 'lyrics'}
                className={`ll-centertab${centerTab === 'lyrics' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('lyrics'); setShowLyrics(true); openLyrics(); }}>Lyrics</button>
              <button type="button" role="tab" aria-selected={centerTab === 'trending'}
                className={`ll-centertab${centerTab === 'trending' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('trending'); setShowLyrics(false); if (trending.status === 'idle') loadTrending(); }}>Trending</button>
              <button type="button" role="tab" aria-selected={centerTab === 'new'}
                className={`ll-centertab${centerTab === 'new' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('new'); setShowLyrics(false); if (fresh.status === 'idle') loadFresh(); }}>New</button>
              <button type="button" role="tab" aria-selected={centerTab === 'tracks'}
                className={`ll-centertab${centerTab === 'tracks' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('tracks'); setShowLyrics(false); }}>Tracks</button>
              <button type="button" role="tab" aria-selected={centerTab === 'playlists'}
                className={`ll-centertab${centerTab === 'playlists' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('playlists'); setShowLyrics(false); }}>Playlists</button>
              <button type="button" role="tab" aria-selected={centerTab === 'library'}
                className={`ll-centertab${centerTab === 'library' ? ' is-on' : ''}`}
                onClick={() => { setCenterTab('library'); setShowLyrics(false); }}>Library</button>
              <button type="button" role="tab" aria-selected={centerTab === 'queue'}
                className={`ll-centertab ll-centertab-queue${centerTab === 'queue' ? ' is-on' : ''}`}
                onClick={() => setCenterTab('queue')}>Queue · {queueTracks.length}</button>
            </div>
            <div className="ll-center-body">
              {query.trim() ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="Search results">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">search</p>
                        <h2 className="ll-title">{searchTotal} results</h2>
                        <p className="ll-note-dim">{searchStatus === 'loading' ? 'asking the source…' : 'songs, albums, artists and playlists are kept apart'}</p>
                      </div>
                      <div className="ll-head-actions">
                        <button type="button" className="ll-pill" onClick={() => setQuery('')}>clear</button>
                      </div>
                    </header>
                    {rowsFor(searchSongsList).length ? <LlTrackList tracks={searchSongsList} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, searchSongsList, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
                    {rowsFor(searchAlbumsList).length ? <div className="ll-grid">{searchAlbumsList.map((album) => <LlTile key={album.id || album.title} item={album} kind="album" onOpen={openAlbum} />)}</div> : null}
                    {rowsFor(searchArtistsList).length ? <div className="ll-grid">{searchArtistsList.map((artist) => <LlTile key={artist.id || artist.name} item={artist} kind="artist" onOpen={openArtist} />)}</div> : null}
                    {rowsFor(searchPlaylistsList).length ? <div className="ll-grid">{searchPlaylistsList.map((playlist) => <LlTile key={playlist.id} item={playlist} kind="playlist" onOpen={openPlaylist} />)}</div> : null}
                    {!searchTotal && searchStatus !== 'loading' ? <LlNote>No results for “{query.trim()}”. A shorter word usually matches.</LlNote> : null}
                  </section>
                </div>
              ) : selectedCollection ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="Collection">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">{selectedCollection.type} · {selectedCollection.tracks?.length || 0} songs</p>
                        <h2 className="ll-title">{selectedCollection.title || 'Collection'}</h2>
                        {selectedCollection.subtitle ? <p className="ll-note-dim">{selectedCollection.subtitle}</p> : null}
                      </div>
                      <div className="ll-head-actions">
                        <button type="button" className="ll-pill" onClick={() => { setSelectedCollection(null); }}>close</button>
                        {selectedCollection.type === 'artist' && (selectedCollection.albums?.length || 0) >= 24 && !selectedCollection.albumsExpanded
                          ? <button type="button" className="ll-pill" onClick={() => loadAllArtistAlbums()}>see all albums</button> : null}
                      </div>
                    </header>
                    {collectionStatus === 'loading' ? <LlNote>reading {selectedCollection.type}…</LlNote> : null}
                    {collectionStatus === 'error' ? <LlNote tone="error">{selectedCollection.error || 'This collection could not be read. The source may be rate limiting.'}</LlNote> : null}
                    {selectedCollection.tracks?.length ? <LlTrackList tracks={selectedCollection.tracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, selectedCollection.tracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
                    {selectedCollection.albums?.length ? (
                      <div className="ll-grid">
                        {rowsFor(selectedCollection.albums).map((album) => <LlTile key={album.id || album.title} item={album} kind="album" onOpen={openAlbum} />)}
                      </div>
                    ) : null}
                    {selectedCollection.isImported ? (
                      <div className="ll-crud">
                        <p className="ll-label">song controls · {showSongCrud ? 'open' : 'minimized'}</p>
                        <div className="ll-crud-row">
                          <input className="ll-input" placeholder={showSongCrud ? 'song name to add or replace' : ''} value={crudQuery}
                            onChange={(event) => setCrudQuery(event.target.value)} disabled={!showSongCrud} />
                          <button type="button" className="ll-pill" onClick={() => setShowSongCrud((current) => !current)}>{showSongCrud ? 'minimize' : 'expand'}</button>
                          <button type="button" className="ll-pill" disabled={!showSongCrud} onClick={() => addImportedTrack()}>add song</button>
                          <button type="button" className="ll-pill" disabled={!showSongCrud} onClick={() => replaceImportedTrack(selectedCollection.tracks?.[0])}>replace first</button>
                          <button type="button" className="ll-pill" disabled={!showSongCrud} onClick={() => removeImportedTrack(selectedCollection.tracks?.[0])}>remove first</button>
                          <button type="button" className="ll-pill" onClick={() => resyncImportedPlaylist(selectedCollection)}>re-sync</button>
                        </div>
                        {importMessage ? <LlNote>{importMessage}</LlNote> : null}
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : centerTab === 'lyrics' ? (
                <LlLyrics
                  rows={lyricRows.length ? lyricRows : plainLyricLines}
                  open={showLyrics}
                  autoScroll={lyricAutoScroll}
                  onToggleAutoScroll={() => setLyricAutoScroll((current) => !current)}
                  blur={lyricBlur}
                  onBlurToggle={() => setLyricBlur((current) => !current)}
                  onClose={() => { setShowLyrics(false); setCenterTab('trending'); }}
                  onJump={(time) => { if (Number.isFinite(time)) seekTo(time); }}
                  status={lyricsStatus === 'ready' && !syncedLyricLines.length && !lyricRows.length ? 'the source has no timed lyrics for this song' : lyricsStatus === 'error' ? 'lyrics could not be read; the panel will retry when you open it again' : ''}
                  loading={lyricsStatus === 'loading'}
                  note={playingTrack ? 'open lyrics to follow the line' : 'nothing playing'}
                  activeRef={activeLyricRef}
                />
              ) : centerTab === 'trending' ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="Trending now">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">live from the source</p>
                        <h2 className="ll-title">Trending Now</h2>
                        <p className="ll-note-dim">{trending.items.length ? `${trending.items.length} songs riding the wave` : 'Tamil songs, fresh off the wire'}</p>
                      </div>
                      <div className="ll-head-actions">
                        <button type="button" className="ll-pill" onClick={() => loadTrending()}>{trending.status === 'loading' ? 'asking…' : 'reload'}</button>
                      </div>
                    </header>
                    {trending.status === 'loading' && !trending.items.length ? <LlNote>asking the source for trending…</LlNote> : null}
                    {trending.status === 'error' ? <LlNote tone="error">{trending.error}</LlNote> : null}
                    {trending.items.length ? <LlTrackList tracks={trending.items} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, trending.items, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
                    {!trending.items.length && trending.status === 'ready' ? <LlNote>The source returned no trending songs right now — reload tries again.</LlNote> : null}
                    {trendingShelf && rowsFor(trendingShelf.items).filter((item) => item?.type === 'album' || item?.type === 'playlist').length ? (
                      <div className="ll-grid">
                        {rowsFor(trendingShelf.items).filter((item) => item?.type === 'album' || item?.type === 'playlist').map((item) => (
                          <LlTile key={`trending-${item.id || item.title}`} item={item} kind={item.type === 'playlist' ? 'playlist' : 'album'}
                            onOpen={(value) => (value.type === 'playlist' ? openPlaylist(value) : openAlbum(value))} />
                        ))}
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : centerTab === 'new' ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="New releases">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">just landed</p>
                        <h2 className="ll-title">New</h2>
                        <p className="ll-note-dim">{fresh.tracks.length ? `${fresh.tracks.length} tracks · ${fresh.albums.length} albums` : 'this year’s Tamil arrivals'}</p>
                      </div>
                      <div className="ll-head-actions">
                        <button type="button" className="ll-pill" onClick={() => loadFresh()}>{fresh.status === 'loading' ? 'asking…' : 'reload'}</button>
                      </div>
                    </header>
                    {fresh.status === 'loading' && !fresh.tracks.length ? <LlNote>asking the source for new releases…</LlNote> : null}
                    {fresh.status === 'error' ? <LlNote tone="error">{fresh.error}</LlNote> : null}
                    {fresh.tracks.length ? <LlTrackList tracks={fresh.tracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, fresh.tracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
                    {fresh.albums.length ? (
                      <div className="ll-grid">
                        {rowsFor(fresh.albums).map((album) => <LlTile key={album.id || album.title} item={album} kind="album" onOpen={openAlbum} />)}
                      </div>
                    ) : null}
                    {!fresh.tracks.length && !fresh.albums.length && fresh.status === 'ready' ? <LlNote>The source returned no new releases right now — reload tries again.</LlNote> : null}
                  </section>
                </div>
              ) : centerTab === 'tracks' ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="All tracks">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">every shelf, one list</p>
                        <h2 className="ll-title">Tracks</h2>
                        <p className="ll-note-dim">{allShelfSongs.length ? `${allShelfSongs.length} songs, de-duplicated` : status === 'error' ? 'The music source did not answer. Refresh re-reads it; nothing was cached as empty.' : 'reading the shelves…'}</p>
                      </div>
                    </header>
                    {allShelfSongs.length ? <LlTrackList tracks={allShelfSongs} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, allShelfSongs, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
                    {shelfCollections.length ? (
                      <>
                        <h3 className="ll-subtitle">From the shelves</h3>
                        <div className="ll-grid">
                          {shelfCollections.map((item) => (
                            <LlTile key={`shelf-${item.id || item.title}`} item={item} kind={item.type === 'playlist' ? 'playlist' : 'album'}
                              onOpen={(value) => (value.type === 'playlist' ? openPlaylist(value) : openAlbum(value))} />
                          ))}
                        </div>
                      </>
                    ) : null}
                  </section>
                </div>
              ) : centerTab === 'playlists' ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="Playlists">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">yours + the shelves</p>
                        <h2 className="ll-title">Playlists</h2>
                        <p className="ll-note-dim">{importedPlaylists.length} imported · {facetCounts.playlists} on the shelves</p>
                      </div>
                      <div className="ll-head-actions">
                        <button type="button" className="ll-pill" onClick={() => refreshImportedPlaylists()}>reload</button>
                      </div>
                    </header>
                    {shelfCollections.filter((item) => item?.type === 'playlist').length ? (
                      <div className="ll-grid">
                        {shelfCollections.filter((item) => item?.type === 'playlist').map((item) => (
                          <LlTile key={`pl-${item.id || item.title}`} item={item} kind="playlist" onOpen={openPlaylist} />
                        ))}
                      </div>
                    ) : null}
                    <h3 className="ll-subtitle">Imported playlists</h3>
                    {importedPlaylists.length ? (
                      <ul className="ll-rows">
                        {importedPlaylists.map((playlist) => (
                          <li key={playlist.id} className="ll-row">
                            <button type="button" className="ll-row-main" onClick={() => openPlaylist(playlist)}>
                              <span className="ll-row-body"><span className="ll-row-title">{playlist.title}</span>
                                <span className="ll-row-artist">{playlist.count || playlist.tracks?.length || 0} tracks · {playlist.owner || 'imported'}</span></span>
                            </button>
                            <span className="ll-row-tools">
                              {playlist.sourceUrl ? <button type="button" className="ll-row-fav" onClick={() => resyncImportedPlaylist(playlist)} title="Re-sync from Spotify">⟳</button> : null}
                              <button type="button" className="ll-row-fav" onClick={() => renameImportedPlaylist(playlist)} title="Rename">✎</button>
                              <button type="button" className="ll-row-fav" onClick={() => deleteImportedPlaylist(playlist)} title="Delete">🗑</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : <LlNote>No Spotify imports yet — Library is where they land.</LlNote>}
                  </section>
                </div>
              ) : centerTab === 'library' ? (
                <div className="ll-browse">
                  <section className="ll-panel" aria-label="Library">
                    <header className="ll-head">
                      <div>
                        <p className="ll-eyebrow">kept on this device + the stacks</p>
                        <h2 className="ll-title">Library</h2>
                        <p className="ll-note-dim">{facetCounts.albums} albums · {facetCounts.artists} artists · {favoriteTracks.length} starred · {recents.length} recent</p>
                      </div>
                    </header>
                    <div className="ll-facet">
                      <header className="ll-head">
                        <div>
                          <h3 className="ll-subtitle">Albums</h3>
                          <p className="ll-note-dim">{facetCounts.albums} returned by the source</p>
                        </div>
                        <div className="ll-head-actions">
                          <button type="button" className="ll-pill" onClick={() => loadFacet('albums', query)}>{facet.id === 'albums' && facet.status === 'loading' ? 'asking…' : 'reload'}</button>
                        </div>
                      </header>
                      {facetLists.albums.length ? (
                        <div className="ll-grid">
                          {rowsFor(facetLists.albums).map((item) => <LlTile key={item.id || item.title || item.name} item={item} kind="album" onOpen={openAlbum} />)}
                        </div>
                      ) : (
                        <LlNote tone={facet.id === 'albums' && facet.status === 'error' ? 'error' : 'info'}>
                          {facet.id === 'albums' && facet.status === 'loading' ? 'asking the source for albums…'
                            : facet.id === 'albums' && facet.error ? `albums: ${facet.error}`
                            : 'Nothing under albums right now — the source returned none. Import a Spotify playlist, or search a name above.'}
                        </LlNote>
                      )}
                    </div>
                    <div className="ll-facet">
                      <header className="ll-head">
                        <div>
                          <h3 className="ll-subtitle">Artists</h3>
                          <p className="ll-note-dim">{facetCounts.artists} returned by the source</p>
                        </div>
                        <div className="ll-head-actions">
                          <button type="button" className="ll-pill" onClick={() => loadFacet('artists', query)}>{facet.id === 'artists' && facet.status === 'loading' ? 'asking…' : 'reload'}</button>
                        </div>
                      </header>
                      {facetLists.artists.length ? (
                        <div className="ll-grid">
                          {rowsFor(facetLists.artists).map((item) => <LlTile key={item.id || item.title || item.name} item={item} kind="artist" onOpen={openArtist} />)}
                        </div>
                      ) : (
                        <LlNote tone={facet.id === 'artists' && facet.status === 'error' ? 'error' : 'info'}>
                          {facet.id === 'artists' && facet.status === 'loading' ? 'asking the source for artists…'
                            : facet.id === 'artists' && facet.error ? `artists: ${facet.error}`
                            : 'Nothing under artists right now — the source returned none. Import a Spotify playlist, or search a name above.'}
                        </LlNote>
                      )}
                    </div>
                    <h3 className="ll-subtitle">Favorites</h3>
                    {favoriteTracks.length ? <LlTrackList tracks={favoriteTracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, favoriteTracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
                      : <LlNote>Nothing starred yet — the ☆ on any row is all there is to it.</LlNote>}
                    <h3 className="ll-subtitle">Recently played</h3>
                    {recents.length ? <LlTrackList tracks={recents} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, recents, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
                      : <LlNote>No history yet.</LlNote>}
                    <div className="ll-import">
                      <p className="ll-label">Spotify playlist sync · tracks are matched and played through the music source only</p>
                      <textarea className="ll-input ll-textarea" rows="3" value={importText} placeholder="https://open.spotify.com/playlist/…"
                        onChange={(event) => setImportText(event.target.value)} />
                      <div className="ll-crud-row">
                        <button type="button" className="ll-pill" onClick={() => importSpotifyPlaylists()}>{importStatus === 'loading' ? 'importing…' : 'import'}</button>
                        <button type="button" className="ll-pill" onClick={() => refreshImportedPlaylists()}>reload list</button>
                      </div>
                      {importMessage ? <LlNote tone={importStatus === 'error' ? 'error' : 'info'}>{importMessage}</LlNote> : null}
                    </div>
                  </section>
                </div>
              ) : centerTab === 'queue' ? (
                <div className="ll-queuepane">
                  <p className="ll-label">queue · {queueTracks.length}</p>
                  <ol className="ll-queue-list">
                    {queueTracks.map((track, index) => (
                      <li key={`pane-${trackKey(track)}-${index}`}>
                        <button type="button" className={`ll-queue-row${trackKey(track) === activeKeyValue ? ' is-on' : ''}`} onClick={() => playTrack(track, queueTracks, true)}>
                          <span className="ll-queue-num">{index + 1}</span>
                          <span className="ll-queue-art">{track?.image ? <img src={track.image} alt="" loading="lazy" /> : <span aria-hidden="true">♪</span>}</span>
                          <span className="ll-queue-body">
                            <span className="ll-queue-title">{track.title || 'Untitled'}</span>
                            {track?.subtitle || track?.artists ? <span className="ll-queue-artist">{track.subtitle || track.artists}</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className="ll-note-dim">{playerStatus === 'error' ? 'this stream refused to start — another song will be tried next' : `lock mode · ${wakeLockStatusText()}`}</p>
                </div>
              ) : null}
            </div>
            <nav className="ll-bottomnav" aria-label="Center shortcuts">
              <button type="button" className={`ll-bottomnav-btn${centerTab === 'lyrics' ? ' is-on' : ''}`} aria-pressed={centerTab === 'lyrics'}
                onClick={() => { setCenterTab('lyrics'); setShowLyrics(true); openLyrics(); }}><span aria-hidden="true">♪</span> Lyrics</button>
              <button type="button" className={`ll-bottomnav-btn${centerTab === 'trending' ? ' is-on' : ''}`} aria-pressed={centerTab === 'trending'}
                onClick={() => { setCenterTab('trending'); setShowLyrics(false); if (trending.status === 'idle') loadTrending(); }}><span aria-hidden="true">♫</span> Trending</button>
              <button type="button" className={`ll-bottomnav-btn${centerTab === 'queue' ? ' is-on' : ''}`} aria-pressed={centerTab === 'queue'}
                onClick={() => setCenterTab('queue')}><span aria-hidden="true">☰</span> Queue</button>
            </nav>
          </div>
        </div>

        <section className="ll-strip" aria-label="Up next">
          <div className="ll-strip-head">
            <h2>Up Next</h2>
            <p>{playerStatus === 'error' ? 'this stream refused to start — another song will be tried next' : queueTracks.length ? `${queueTracks.length} in the queue` : 'queue is empty'}</p>
          </div>
          <ol className="ll-strip-queue">
            {queueTracks.slice(0, 12).map((track, index) => (
              <li key={`strip-${trackKey(track)}-${index}`}>
                <button type="button" className={`ll-card${trackKey(track) === activeKeyValue ? ' is-on' : ''}`} onClick={() => playTrack(track, queueTracks, true)}>
                  <span className="ll-card-art">{track?.image ? <img src={track.image} alt="" loading="lazy" /> : <span aria-hidden="true">♪</span>}</span>
                  <span className="ll-card-body">
                    <span className="ll-card-title">{track.title || 'Untitled'}</span>
                    {track?.subtitle || track?.artists ? <span className="ll-card-artist">{track.subtitle || track.artists}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>

      </div>

      <LlMini
        visible={Boolean(playingTrack) && !pocketMode && (cardHidden || (showMiniPlayer && centerTab !== 'lyrics'))}
        image={playingImage}
        title={playingTrack?.title || ''}
        position={curtainPosition}
        isPlaying={isPlaying}
        onToggle={togglePlay}
        onNext={() => playNext()}
        onDismiss={() => { closeMiniPlayer(); setCardHidden(false); }}
        onOpen={() => { setCardHidden(false); }}
        offset={dragDy}
        onDragStart={(event) => { dragStartRef.current = event.touches[0].clientY; }}
        onDragMove={(event) => {
          if (dragStartRef.current == null) return;
          const dy = event.touches[0].clientY - dragStartRef.current;
          setDragDy(Math.max(0, dy));
        }}
        onDragEnd={() => { if (dragDy > MU_MINI_DRAG_CLOSE_PX) { closeMiniPlayer(); setCardHidden(false); } setDragDy(0); dragStartRef.current = null; }}
      />

      <LlVeil view={lockView.kind === 'pocket' ? lockView : null}
        onHoldStart={startPocketUnlock} onHoldEnd={cancelPocketUnlock} onExit={() => setPocketMode(false)} />
      {listeningMode && !pocketMode ? (
        <div className="ll-listenbar" role="status">
          <span className="ll-listenbar-dot" />
          <span>{wakeLockStatusText()}</span>
          <button type="button" className="ll-pill" onPointerDown={startUnlockHold} onPointerUp={cancelUnlockHold} onPointerLeave={cancelUnlockHold}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') startUnlockHold(); }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') cancelUnlockHold(); }}>hold 1.5s to leave</button>
        </div>
      ) : null}

      <audio ref={videoRef} className="ll-audio" preload="auto" />
    </main>
  );
}
