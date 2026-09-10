'use client';

/*
 * components/music/MusicCurtains.jsx — the music section as the Light Curtains design (concept 31, v8.15.0).
 *
 * This is a replacement, not a reskin. The previous UI — `palette-music-magenta`, its own sticky aside,
 * `VinylArt`, `SectionHeader`, `HorizontalRow`, `TrackTile`/`AlbumTile`/`ArtistTile`/`PlaylistTile`,
 * `TrackList` and every Tailwind surface in the render — was deleted, and the JSX below is written against
 * `components/music/Curtains.jsx` primitives and one `.jv-mu-*` class family. What is *kept* is the logic
 * that was already correct: the wake-lock and pocket-mode lock machine, the 0.9 s pre-end auto-advance that
 * makes a locked phone continue the queue, the two-track prefetch, the session cache and scroll restore,
 * the quality ladder, the lyrics reader, the Spotify import and the song CRUD calls. The pure helpers those
 * rely on moved to `lib/musicCore.js`, which is also where the new model lives (`muTabs`, `muLyricRows`,
 * `muQualityChips`, `muCurtainVars`, `muLockView`) so both are unit-testable without a browser.
 *
 * No `export const dynamic` anywhere: the page is static and the client fetches, so a sleeping free-tier
 * instance stays asleep on a library browse.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';
import {
  artistChipsFromTrack,
  chooseBestQuality,
  dedupeQueue,
  emptySearchResults,
  isHlsUrl,
  MU_CHIPS,
  MU_MINI_DRAG_CLOSE_PX,
  muCurtainPosition,
  muCurtainVars,
  muLockView,
  muLyricRows,
  muQualityChips,
  muTabs,
  normalizeSearchResults,
  parseSyncedLyrics,
  plainFromSyncedLyrics,
  searchResultCount,
  trackKey,
} from '@/lib/musicCore';
import {
  CurtainField,
  LockVeil,
  LyricsPanel,
  MiniCapsule,
  MuHeading,
  MuNote,
  MuPanel,
  MuTabs,
  MuTile,
  MuTrackList,
  MuTrackRow,
  NowPlayingPanel,
  TransportStrip,
} from '@/components/music/Curtains';

const MUSIC_CACHE_KEY = 'jash:music:v8-curtains';
const SONG_DETAIL_CACHE_KEY = 'jash:music:songs:v1';
const FAVORITES_KEY = 'jash_music_favorites';
const RECENTS_KEY = 'jash_music_recents';
const AUTH_STORAGE_KEY = 'jash_theatre_access_token';
const VOLUME_KEY = 'jash_music_volume';
const MUTED_KEY = 'jash_music_muted';
const LYRIC_WINDOW = 7;

export default function MusicCurtains() {
const MU_TABS_IDS = ['albums', 'artists', 'playlists'];

  const videoRef = useRef(null);
  const [facet, setFacet] = useState({ id: '', status: 'idle', items: [], error: '' });
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
  const [view, setView] = useState('home');
  const [query, setQuery] = useState('');
  const [home, setHome] = useState({ sections: [], artists: [], playlists: [], releases: { tracks: [], albums: [] } });
  const [searchResults, setSearchResults] = useState(() => emptySearchResults());
  const [selectedCollection, setSelectedCollection] = useState(null);
  const [queue, setQueue] = useState([]);
  const [active, setActive] = useState(null);
  const [activeDetail, setActiveDetail] = useState(null);
  const [showMiniPlayer, setShowMiniPlayer] = useState(false);
  const dragStartRef = useRef(null);
  const barTouchRef = useRef(null);
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
  const [dockVolumeOpen, setDockVolumeOpen] = useState(false);
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
      setView(cached.view || 'home');
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
    writeSessionCache(MUSIC_CACHE_KEY, { home, homeWarning, view, query, searchResults, selectedCollection, queue, active, activeDetail, quality, shuffleEnabled, repeatMode, showLyrics, lyrics, lyricsData, status });
  }, [home, homeWarning, view, query, searchResults, selectedCollection, queue, active, activeDetail, quality, shuffleEnabled, repeatMode, showLyrics, lyrics, lyricsData, status]);

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
        setView('search');
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
      setView('artists');
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
      setView('albums');
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
      setView('playlists');
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

  const navItems = [
    ['home', '⌂', 'Home'],
    ['search', '⌕', 'Search'],
    ['artists', '◎', 'Artists'],
    ['albums', '▣', 'Albums'],
    ['playlists', '♬', 'Playlists'],
    ['favorites', '★', 'Favorites'],
    ['recent', '◴', 'Recent'],
  ];

  const rawSections = home.sections || [];
  const mainSections = rawSections.filter((section) => (section.items || []).length);
  const importedPlaylists = home.playlists || [];
  const homeHasAnySongCards = mainSections.length || home.releases?.tracks?.length || home.releases?.albums?.length;
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
  }, [showLyrics, activeLyricLineIndex]);

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
  const tabs = muTabs(facetCounts);
  const activeTab = MU_TABS_IDS.includes(view) ? view : '';
  const facetHome = { albums: home?.releases?.albums || [], artists: home?.artists || [], playlists: importedPlaylists };
  const facetLists = {
    albums: facet.id === 'albums' && facet.items.length ? facet.items : facetHome.albums,
    artists: facet.id === 'artists' && facet.items.length ? facet.items : facetHome.artists,
    playlists: facet.id === 'playlists' && facet.items.length ? facet.items : facetHome.playlists,
  };
  const rowsFor = (list) => (list || []).filter(Boolean);

  return (
    <main className="jv-mu jv-rail-shift">
      <CurtainField vars={curtainVars} position={curtainPosition} dim={pocketMode || listeningMode} />
      <RailNav onOpenSearch={() => { setView('search'); setQuery(''); }} />

      <div className="jv-mu-inner">
        <header className="jv-mu-mast">
          <div>
            <p className="jv-mu-eyebrow">ராக வானம்</p>
            <h1 className="jv-mu-h1">Music</h1>
          </div>
          <div className="jv-mu-mast-tools">
            <label className="jv-mu-search">
              <span className="jv-mu-sr">Search songs, albums, artists and playlists</span>
              <input
                type="search"
                value={query}
                placeholder="search a song, album or artist"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="button" className="jv-mu-chip" onClick={() => loadHome()}>{status === 'loading' ? 'reading…' : 'refresh'}</button>
            <Link href="/" className="jv-mu-chip">back to the rail</Link>
          </div>
        </header>

        {homeWarning ? <MuNote>{homeWarning}</MuNote> : null}
        {error ? <MuNote tone="error">{error}</MuNote> : null}

        <MuTabs tabs={tabs} active={activeTab} chips={MU_CHIPS} chipActive={view}
          onSelect={(id) => {
            if (view === id) { setView('home'); return; }
            setView(id);
            loadFacet(id, query);
          }}
          onChip={(id) => { setView(view === id ? 'home' : id); if (id !== 'search') setQuery(''); }} />

        <MuPanel as="div" name="playing" data-mu-blur="true">
          <NowPlayingPanel
            track={playingTrack ? { ...playingTrack, album: playingTrack.album || selectedCollection?.title || '' } : null}
            image={playingImage}
            isPlaying={isPlaying}
            position={curtainPosition}
            currentTime={currentTime}
            duration={duration}
            chips={qualityChips}
            onQuality={(key) => setQuality(key)}
            artistChips={currentArtistChips}
            onArtist={(artist) => { openArtist({ id: artist.id || artist.name, name: artist.name, image: artist.image }); }}
          >
            <div className="jv-mu-side">
              <p className="jv-mu-side-label">queue · {queueTracks.length}</p>
              <ol className="jv-mu-side-queue">
                {queueTracks.slice(0, 5).map((track, index) => (
                  <li key={`${trackKey(track)}-${index}`}>
                    <button type="button" className={`jv-mu-side-row${trackKey(track) === activeKeyValue ? ' is-on' : ''}`} onClick={() => playTrack(track, queueTracks, true)}>
                      <span>{index + 1}</span> {track.title || 'Untitled'}
                    </button>
                  </li>
                ))}
              </ol>
              <p className="jv-mu-side-note">{playerStatus === 'error' ? 'this stream refused to start — another song will be tried next' : `lock mode · ${wakeLockStatusText()}`}</p>
            </div>
          </NowPlayingPanel>

          <TransportStrip
            isPlaying={isPlaying}
            shuffle={shuffleEnabled}
            repeat={repeatMode}
            volume={Number(volume) || 0}
            muted={muted}
            currentTime={currentTime}
            duration={duration}
            onToggle={togglePlay}
            onPrev={playPrevious}
            onNext={() => playNext()}
            onShuffle={() => setShuffleEnabled((current) => !current)}
            onRepeat={cycleRepeat}
            onVolume={(value) => changeVolume(value)}
            onMute={toggleMute}
            onLyrics={() => { const next = !showLyrics; setShowLyrics(next); if (next) openLyrics(); }}
            lyricsOn={showLyrics}
            onListening={toggleListeningMode}
            listeningOn={listeningMode}
            pocket={playingTrack ? enterPocketMode : null}
            lockLabel="pocket mode"
          />
        </MuPanel>

        {selectedCollection ? (
          <MuPanel as="div" name="collection">
            <MuHeading eyebrow={`${selectedCollection.type} · ${selectedCollection.tracks?.length || 0} songs`}
              title={selectedCollection.title || 'Collection'} note={selectedCollection.subtitle || ''}>
              <button type="button" className="jv-mu-chip" onClick={() => { setSelectedCollection(null); setView('home'); }}>close</button>
              {selectedCollection.type === 'artist' && (selectedCollection.albums?.length || 0) >= 24 && !selectedCollection.albumsExpanded
                ? <button type="button" className="jv-mu-chip" onClick={() => loadAllArtistAlbums()}>see all albums</button> : null}
            </MuHeading>
            {collectionStatus === 'loading' ? <MuNote>reading {selectedCollection.type}…</MuNote> : null}
            {collectionStatus === 'error' ? <MuNote tone="error">{selectedCollection.error || 'This collection could not be read. The source may be rate limiting.'}</MuNote> : null}
            {selectedCollection.tracks?.length ? <MuTrackList tracks={selectedCollection.tracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
              onPlay={(track) => playTrack(track, selectedCollection.tracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
            {selectedCollection.albums?.length ? (
              <div className="jv-mu-grid">
                {rowsFor(selectedCollection.albums).map((album) => <MuTile key={album.id || album.title} item={album} kind="album" onOpen={openAlbum} />)}
              </div>
            ) : null}
            {selectedCollection.isImported ? (
              <div className="jv-mu-crud">
                <p className="jv-mu-side-label">song controls · {showSongCrud ? 'open' : 'minimized'}</p>
                <div className="jv-mu-crud-row">
                  <input className="jv-mu-input" placeholder={showSongCrud ? 'song name to add or replace' : ''} value={crudQuery}
                    onChange={(event) => setCrudQuery(event.target.value)} disabled={!showSongCrud} />
                  <button type="button" className="jv-mu-chip" onClick={() => setShowSongCrud((current) => !current)}>{showSongCrud ? 'minimize' : 'expand'}</button>
                  <button type="button" className="jv-mu-chip" disabled={!showSongCrud} onClick={() => addImportedTrack()}>add song</button>
                  <button type="button" className="jv-mu-chip" disabled={!showSongCrud} onClick={() => replaceImportedTrack(selectedCollection.tracks?.[0])}>replace first</button>
                  <button type="button" className="jv-mu-chip" disabled={!showSongCrud} onClick={() => removeImportedTrack(selectedCollection.tracks?.[0])}>remove first</button>
                  <button type="button" className="jv-mu-chip" onClick={() => resyncImportedPlaylist(selectedCollection)}>re-sync</button>
                </div>
                {importMessage ? <MuNote>{importMessage}</MuNote> : null}
              </div>
            ) : null}
          </MuPanel>
        ) : null}

        {activeTab ? (
          <MuPanel as="div" name="facet">
            <MuHeading eyebrow={`tab · ${activeTab}`} title={activeTab === 'albums' ? 'Albums' : activeTab === 'artists' ? 'Artists' : 'Playlists'}
              note={`${facetCounts[activeTab]} returned by the source${query.trim() ? ` · filtered by “${query.trim()}”` : ''}`}>
              <button type="button" className="jv-mu-chip" onClick={() => setView('home')}>back to the pile</button>
              <button type="button" className="jv-mu-chip" onClick={() => loadFacet(activeTab, query)}>retry</button>
            </MuHeading>
            {facetLists[activeTab].length ? (
              <div className="jv-mu-grid">
                {rowsFor(facetLists[activeTab]).map((item) => (
                  <MuTile key={item.id || item.title || item.name} item={item} kind={activeTab === 'artists' ? 'artist' : 'album'}
                    onOpen={activeTab === 'artists' ? openArtist : activeTab === 'albums' ? openAlbum : openPlaylist} />
                ))}
              </div>
            ) : (
              <MuNote tone={facet.status === 'error' ? 'error' : 'info'}>
                {facet.status === 'loading'
                  ? `asking the source for ${activeTab}…`
                  : facet.error
                    ? `${activeTab}: ${facet.error}`
                    : `Nothing under ${activeTab} right now — the source returned no ${activeTab}. Import a Spotify playlist, or search a name above.`}
              </MuNote>
            )}
            {activeTab === 'playlists' ? (
              <div className="jv-mu-import">
                <p className="jv-mu-side-label">Spotify playlist sync · tracks are matched and played through the music source only</p>
                <textarea className="jv-mu-input jv-mu-textarea" rows="3" value={importText} placeholder="https://open.spotify.com/playlist/…"
                  onChange={(event) => setImportText(event.target.value)} />
                <div className="jv-mu-crud-row">
                  <button type="button" className="jv-mu-chip" onClick={() => importSpotifyPlaylists()}>{importStatus === 'loading' ? 'importing…' : 'import'}</button>
                  <button type="button" className="jv-mu-chip" onClick={() => refreshImportedPlaylists()}>reload list</button>
                </div>
                {importMessage ? <MuNote tone={importStatus === 'error' ? 'error' : 'info'}>{importMessage}</MuNote> : null}
                {importedPlaylists.length ? (
                  <ul className="jv-mu-rows">
                    {importedPlaylists.map((playlist) => (
                      <li key={playlist.id} className="jv-mu-row">
                        <button type="button" className="jv-mu-row-main" onClick={() => openPlaylist(playlist)}>
                          <span className="jv-mu-row-body"><span className="jv-mu-row-title">{playlist.title}</span>
                            <span className="jv-mu-row-artist">{playlist.count || playlist.tracks?.length || 0} tracks · {playlist.owner || 'imported'}</span></span>
                        </button>
                        <span className="jv-mu-row-tools">
                          <button type="button" className="jv-mu-row-fav" onClick={() => renameImportedPlaylist(playlist)} title="Rename">✎</button>
                          <button type="button" className="jv-mu-row-fav" onClick={() => deleteImportedPlaylist(playlist)} title="Delete">🗑</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </MuPanel>
        ) : null}

        {view === 'home' ? (
          <>
            {mainSections.map((section) => {
              const songs = rowsFor(section.items).filter((item) => !(item?.type === 'album' || item?.type === 'playlist'));
              const collections = rowsFor(section.items).filter((item) => item?.type === 'album' || item?.type === 'playlist');
              return (
                <MuPanel as="section" name="row" key={section.title}>
                  <MuHeading eyebrow="shelf" title={section.title}
                    note={`${collections.length} records · ${songs.length} songs from the source`} />
                  {collections.length ? (
                    <div className="jv-mu-grid">
                      {collections.map((item) => (
                        <MuTile key={`${section.title}-${item.id || item.title}`} item={item} kind={item.type === 'playlist' ? 'playlist' : 'album'}
                          onOpen={(value) => (value.type === 'playlist' ? openPlaylist(value) : openAlbum(value))} />
                      ))}
                    </div>
                  ) : null}
                  {songs.length ? (
                    <MuTrackList tracks={songs} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                      onPlay={(track) => playTrack(track, songs, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
                  ) : null}
                  {!songs.length && !collections.length ? <MuNote>This shelf came back empty from the source.</MuNote> : null}
                </MuPanel>
              );
            })}
            {!mainSections.length && !homeHasAnySongCards ? <MuPanel as="div" name="empty"><MuNote tone="error">{status === 'error' ? 'The music source did not answer. Refresh re-reads it; nothing was cached as empty.' : 'reading the shelves…'}</MuNote></MuPanel> : null}
            {rowsFor(home?.releases?.tracks).length ? (
              <MuPanel as="section" name="new">
                <MuHeading eyebrow="new releases" title="Tracks" note="played by this app, streamed by your browser" />
                <MuTrackList tracks={home.releases.tracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                  onPlay={(track) => playTrack(track, home.releases.tracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
              </MuPanel>
            ) : null}
            {view === 'home' && (favoriteTracks.length || recents.length) ? (
              <MuPanel as="section" name="pinned">
                <MuHeading eyebrow="kept on this device" title="Favorites & recent" note={`${favoriteTracks.length} starred · ${recents.length} recent · nothing is written to the database`} />
                <MuTrackList tracks={favoriteTracks.length ? favoriteTracks : recents} activeKey={activeKeyValue} favoriteSet={favoriteSet}
                  onPlay={(track) => playTrack(track, favoriteTracks.length ? favoriteTracks : recents, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
              </MuPanel>
            ) : null}
          </>
        ) : null}

        {view === 'search' && query.trim() ? (
          <MuPanel as="section" name="search">
            <MuHeading eyebrow="search" title={`${searchTotal} results`} note={searchStatus === 'loading' ? 'asking the source…' : 'songs, albums, artists and playlists are kept apart'} />
            {rowsFor(searchSongsList).length ? <MuTrackList tracks={searchSongsList} activeKey={activeKeyValue} favoriteSet={favoriteSet}
              onPlay={(track) => playTrack(track, searchSongsList, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} /> : null}
            {rowsFor(searchAlbumsList).length ? <div className="jv-mu-grid">{searchAlbumsList.map((album) => <MuTile key={album.id || album.title} item={album} kind="album" onOpen={openAlbum} />)}</div> : null}
            {rowsFor(searchArtistsList).length ? <div className="jv-mu-grid">{searchArtistsList.map((artist) => <MuTile key={artist.id || artist.name} item={artist} kind="artist" onOpen={openArtist} />)}</div> : null}
            {rowsFor(searchPlaylistsList).length ? <div className="jv-mu-grid">{searchPlaylistsList.map((playlist) => <MuTile key={playlist.id} item={playlist} kind="playlist" onOpen={openPlaylist} />)}</div> : null}
            {!searchTotal && searchStatus !== 'loading' ? <MuNote>No results for “{query.trim()}”. A shorter word usually matches.</MuNote> : null}
          </MuPanel>
        ) : null}

        {view === 'favorites' ? (
          <MuPanel as="section" name="list">
            <MuHeading eyebrow="on this device" title="Favorites" note={`${favoriteTracks.length} songs`} />
            {favoriteTracks.length ? <MuTrackList tracks={favoriteTracks} activeKey={activeKeyValue} favoriteSet={favoriteSet}
              onPlay={(track) => playTrack(track, favoriteTracks, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
              : <MuNote>Nothing starred yet — the ☆ on any row is all there is to it.</MuNote>}
          </MuPanel>
        ) : null}

        {view === 'recent' ? (
          <MuPanel as="section" name="list">
            <MuHeading eyebrow="on this device" title="Recently played" note={`${recents.length} remembered`} />
            {recents.length ? <MuTrackList tracks={recents} activeKey={activeKeyValue} favoriteSet={favoriteSet}
              onPlay={(track) => playTrack(track, recents, true)} onFavorite={toggleFavorite} onPrefetch={prefetchTrack} />
              : <MuNote>No history yet.</MuNote>}
          </MuPanel>
        ) : null}

        <MuPanel as="aside" name="lyrics">
          <LyricsPanel
            rows={lyricRows.length ? lyricRows : plainLyricLines}
            open={showLyrics}
            autoScroll={lyricAutoScroll}
            onToggleAutoScroll={() => setLyricAutoScroll((current) => !current)}
            blur={lyricBlur}
            onBlurToggle={() => setLyricBlur((current) => !current)}
            onClose={() => setShowLyrics(false)}
            onJump={(time) => { if (Number.isFinite(time)) seekTo(time); }}
            status={lyricsStatus === 'ready' && !syncedLyricLines.length && !lyricRows.length ? 'the source has no timed lyrics for this song' : lyricsStatus === 'error' ? 'lyrics could not be read; the panel will retry when you open it again' : ''}
            loading={lyricsStatus === 'loading'}
            note={playingTrack ? 'open lyrics to follow the line' : 'nothing playing'}
          />
        </MuPanel>

        <footer className="jv-mu-foot">
          <p>Streams are resolved by this app and fetched by this browser; nothing is stored on the server. Quality switching reloads the file from the top — that is the source's limit, not a bug.</p>
        </footer>
      </div>

      <MiniCapsule
        visible={showMiniPlayer && !pocketMode && Boolean(playingTrack)}
        image={playingImage}
        title={playingTrack?.title || ''}
        position={curtainPosition}
        isPlaying={isPlaying}
        onToggle={togglePlay}
        onNext={() => playNext()}
        onDismiss={closeMiniPlayer}
        offset={dragDy}
        onDragStart={(event) => { dragStartRef.current = event.touches[0].clientY; }}
        onDragMove={(event) => {
          if (dragStartRef.current == null) return;
          const dy = event.touches[0].clientY - dragStartRef.current;
          setDragDy(Math.max(0, dy));
        }}
        onDragEnd={() => { if (dragDy > MU_MINI_DRAG_CLOSE_PX) closeMiniPlayer(); setDragDy(0); dragStartRef.current = null; }}
      />

      <LockVeil view={lockView.kind === 'pocket' ? lockView : null}
        onHoldStart={startPocketUnlock} onHoldEnd={cancelPocketUnlock} onExit={() => setPocketMode(false)} />
      {listeningMode && !pocketMode ? (
        <div className="jv-mu-listenbar" role="status">
          <span className="jv-mu-listenbar-dot" />
          <span>{wakeLockStatusText()}</span>
          <button type="button" className="jv-mu-chip" onPointerDown={startUnlockHold} onPointerUp={cancelUnlockHold} onPointerLeave={cancelUnlockHold}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') startUnlockHold(); }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') cancelUnlockHold(); }}>hold 1.5s to leave</button>
        </div>
      ) : null}

      <audio ref={videoRef} className="jv-mu-audio" preload="auto" />
    </main>
  );
}
