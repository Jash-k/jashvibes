'use client';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAudioPlayback } from '@/hooks/useAudioPlayback';
import { MEDIA_FOCUS_EVENT, claimMediaFocus, hasMediaFocus } from '@/lib/player/mediaFocus';
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const MUSIC_CACHE_KEY = 'jash:music:v11';
const SONG_DETAIL_CACHE_KEY = 'jash:music:songs:v1';
const FAVORITES_KEY = 'jash_music_favorites';
const RECENTS_KEY = 'jash_music_recents';
const AUTH_STORAGE_KEY = 'jash_theatre_access_token';
const VOLUME_KEY = 'jash_music_volume';
const MUTED_KEY = 'jash_music_muted';
const LYRIC_WINDOW = 7;



function useMusicController(enabled) {

  const videoRef = useRef(null);
  const [facet, setFacet] = useState({ id: '', status: 'idle', items: [], error: '' });
  const [facets, setFacets] = useState({});
  const facetGeneration = useRef({});
  const facetRequests = useRef({});
  useEffect(() => () => Object.values(facetRequests.current).forEach((request) => request.abort()), []);
  const [trending, setTrending] = useState({ status: 'idle', items: [], error: '' });
  const [fresh, setFresh] = useState({ status: 'idle', tracks: [], albums: [], error: '' });
  const [lyricAutoScroll, setLyricAutoScroll] = useState(true);
  // Wired in the Lyric Lounge's Focus toggle: dims every line but the one being sung.
  const [lyricBlur, setLyricBlur] = useState(false);
  const [lyricOffset, setLyricOffset] = useState(0);
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
  const [showLyrics, setShowLyrics] = useState(true);
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
  const collectionGeneration = useRef(0), lyricsGeneration = useRef(0), lyricsRequest = useRef(null), collectionRequest = useRef(null), currentTrackRef = useRef(''), attemptedAudio = useRef(new Set()), initialized = useRef(false);
  const [homeWarning, setHomeWarning] = useState('');
  const [favorites, setFavorites] = useState([]);
  const [recents, setRecents] = useState([]);

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
    if (!enabled || initialized.current) return;
    initialized.current = true;
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
      setLyricsData(cached.lyricsData?.source === 'error' ? {} : cached.lyricsData || {});
      setHomeWarning(cached.homeWarning || cached.home?.warning || cached.home?.warnings?.[0] || '');
      setStatus(cached.status || 'ready');
      restoreScroll(MUSIC_CACHE_KEY);
      return;
    }

    loadHome();
  }, [loadHome, enabled]);

  useEffect(() => {
    if (!initialized.current) return;
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
    if (trackKey(track) !== currentTrackRef.current) { setActiveDetail(null); setCurrentTime(0); }
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
        lyricsGeneration.current += 1;
        lyricsRequest.current?.abort();
        attemptedAudio.current = new Set();
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

  useAudioPlayback({ elementRef: videoRef, trackKey: activeDetail?.seokey || '', url: activeDetail?.streamUrls?.[quality] || '', autoplay: shouldAutoplay,
    onReady: () => setPlayerStatus('ready'), onError: (message) => { setPlayerStatus('error'); setError(message); },
  });
  useEffect(() => {
    if (playerStatus !== 'error' || !activeDetail?.streamUrls) return;
    const failed = activeDetail.streamUrls[quality]; if (failed) attemptedAudio.current.add(failed);
    const alternative = Object.entries(activeDetail.streamUrls).find(([, u]) => u && !attemptedAudio.current.has(u));
    if (alternative && attemptedAudio.current.size < 3) { setError(''); setPlayerStatus('loading'); setQuality(alternative[0]); }
  }, [playerStatus, activeDetail, quality]);
  useEffect(() => {
    const focus = (event) => { if (event.detail?.owner !== 'music') { videoRef.current?.pause(); setShouldAutoplay(false); } };
    window.addEventListener(MEDIA_FOCUS_EVENT, focus); return () => window.removeEventListener(MEDIA_FOCUS_EVENT, focus);
  }, []);

  const queueTracks = useMemo(() => queue.filter((t) => t?.seokey || t?.trackId), [queue]);

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

  const activeKey = trackKey(active);
  currentTrackRef.current = activeKey;
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


    };
    const onDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onPlay = () => { claimMediaFocus('music'); setIsPlaying(true); };
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
    if (!isPlaying || !hasMediaFocus('music') || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
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
        if (hasMediaFocus('music')) { try { navigator.mediaSession.setActionHandler(action, null); } catch {} }
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

  async function openLyrics(force = false) {
    const detail = activeDetail && trackKey(activeDetail) === currentTrackRef.current ? activeDetail : active;
    const currentKey = trackKey(detail); if (!currentKey || !detail?.title) return;
    setShowLyrics(true);
    if (!force && lyricsStatus === 'ready' && lyricsData.loadedFor === currentKey) return;
    lyricsRequest.current?.abort(); const controller = new AbortController(); lyricsRequest.current = controller;
    const token = ++lyricsGeneration.current; const timeout = setTimeout(() => controller.abort(), 12000);
    setLyricsStatus('loading'); setLyrics('');
    try {
      const params = new URLSearchParams({ title: detail.title, artist: detail.artists || '', album: detail.album || '', duration: String(detail.duration || ''), id: detail.trackId || '', seokey: detail.seokey || '' });
      const response = await fetch('/api/music/lyrics?' + params, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Lyrics unavailable');
      if (token !== lyricsGeneration.current || currentKey !== currentTrackRef.current) return;
      const plain = data.plainLyrics || data.lyrics || plainFromSyncedLyrics(data.syncedLyrics || '');
      setLyricsData({ ...data, loadedFor: currentKey }); setLyrics(plain || '');
      setLyricsStatus(plain || data.syncedLyrics ? 'ready' : 'not-found');
    } catch (e) {
      if (token !== lyricsGeneration.current || currentKey !== currentTrackRef.current) return;
      setLyrics(''); setLyricsData({ loadedFor: currentKey, source: 'error', message: e.name === 'AbortError' ? 'Lyrics lookup timed out. Retry when ready.' : e.message }); setLyricsStatus('error');
    } finally { clearTimeout(timeout); }
  }

  async function openCollection(type, value) {
    const id = String(value?.id || value?.name || '').trim(); if (!id) return;
    collectionRequest.current?.abort(); const controller = new AbortController(); collectionRequest.current = controller;
    const token = ++collectionGeneration.current;
    setCenterTab(type === 'album' ? 'albums' : type === 'artist' ? 'artists' : 'playlists');
    setCollectionStatus('loading'); setSelectedCollection({ ...value, id, type, tracks: [], albums: [], error: '' });
    try {
      const q = new URLSearchParams({ id, title: value.title || '', name: value.name || '' });
      const response = await fetch('/api/music/' + type + '?' + q, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json(); if (!response.ok || !data.item) throw new Error(data.error || 'Collection unavailable');
      if (token !== collectionGeneration.current) return;
      const item = data.item;
      const tracks = dedupeQueue(type === 'artist' ? [...(item.topSongs || []), ...(item.singles || [])] : item.songs || []);
      setSelectedCollection({ ...item, id: item.id || id, title: item.title || item.name || value.title || value.name, type, tracks, albums: item.topAlbums || [], fallback: Boolean(item.fallback), warning: item.warning || '', error: '' });
      setCollectionStatus('ready');
    } catch (e) {
      if (e.name === 'AbortError' || token !== collectionGeneration.current) return;
      setSelectedCollection((c) => ({ ...c, error: e.message })); setCollectionStatus('error');
    }
  }
  function openAlbum(item) { return openCollection('album', item); }
  function openArtist(item) { return openCollection('artist', item); }
  function openPlaylist(item) { return openCollection('playlist', item); }
  function loadAllArtistAlbums() { return loadFacet('albums', selectedCollection?.title || ''); }

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





  const [importStatus, setImportStatus] = useState('idle');
  const [importMessage, setImportMessage] = useState('');

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
      // Browsing/editing a playlist is not permission to replace the playing queue.

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
  const playingTrack = activeDetail && trackKey(activeDetail) === trackKey(active) ? activeDetail : active;
  const currentArtistChips = artistChipsFromTrack(playingTrack);
  const playingImage = playingTrack?.image || '';
  const syncedLyricLines = useMemo(() => parseSyncedLyrics(lyricsData?.syncedLyrics || ''), [lyricsData?.syncedLyrics]);
  const activeLyricLineIndex = useMemo(() => {
    if (!syncedLyricLines.length) return -1;
    let index = -1;
    for (let i = 0; i < syncedLyricLines.length; i += 1) {
      if (currentTime + lyricOffset >= syncedLyricLines[i].time) index = i;
      else break;
    }
    return index;
  }, [syncedLyricLines, currentTime, lyricOffset]);
  const effectiveVolume = muted ? 0 : Math.min(1, Math.max(0, Number(volume) || 0));
  const volumeIcon = effectiveVolume === 0 ? '🔇' : effectiveVolume < 0.45 ? '🔉' : '🔊';
  useEffect(() => {
    if (!showLyrics || !lyricAutoScroll || !activeLyricRef.current) return;
    // Smooth scrolling is motion, and a listener who asked for less of it should not
    // get a 30-line glide every time the song moves on. `lyricAutoScroll` is in the
    // deps because "Resume follow" has to actually resume the following.
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeLyricRef.current.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [showLyrics, lyricAutoScroll, activeLyricLineIndex, centerTab]);

  /* ───────────────────────────── new design surface ───────────────────────────── */

  // A tab asks the facet endpoint for itself. `home` is a summary, and passing its summary off as the whole
  // facet is how a library advertises "Albums 0" while the albums endpoint has results.
  const loadFacet = useCallback(async (id, searchTerm = '') => {
    if (!['albums', 'artists', 'playlists'].includes(id)) return;
    facetRequests.current[id]?.abort();
    const controller = new AbortController();
    facetRequests.current[id] = controller;
    const generation = (facetGeneration.current[id] || 0) + 1;
    facetGeneration.current[id] = generation;
    const publish = (value) => {
      if (controller.signal.aborted || generation !== facetGeneration.current[id]) return;
      setFacet(value);
      setFacets((previous) => ({ ...previous, [id]: value }));
    };
    publish({ id, status: 'loading', items: [], error: '' });
    const url = id === 'playlists'
      ? '/api/music/playlists'
      : `/api/music/${id}?q=${encodeURIComponent(String(searchTerm || '').trim() || 'Tamil')}&limit=48`;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `${id} lookup failed`);
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      publish({ id, status: 'ready', items, error: '' });
    } catch (err) {
      if (generation !== facetGeneration.current[id]) return;
      // A newer request owns aborts; a current timeout must remain retryable.
      const value = { id, status: 'error', items: [], error: err.name === 'AbortError' ? 'Library request timed out. Try again.' : err.message };
      setFacets((previous) => ({ ...previous, [id]: value }));
      setFacet(value);
    } finally { clearTimeout(timeout); }
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
  const facetLists = Object.fromEntries(['albums', 'artists', 'playlists'].map((id) => [
    id, facets[id]?.status === 'ready' ? facets[id].items : facetHome[id],
  ]));

  const rowsFor = (list) => (list || []).filter(Boolean);
  const allShelfSongs = useMemo(() => dedupeQueue([
    ...mainSections.flatMap((section) => rowsFor(section.items).filter((item) => !(item?.type === 'album' || item?.type === 'playlist'))),
    ...rowsFor(home?.releases?.tracks),
  ]), [home]);
  const shelfCollections = useMemo(() => mainSections.flatMap((section) => rowsFor(section.items).filter((item) => item?.type === 'album' || item?.type === 'playlist')), [home]);
  const trendingShelf = useMemo(() => mainSections.find((section) => section.title === 'Trending Now'), [home]);

    useEffect(() => { if (activeDetail?.seokey && activeDetail.seokey === active?.seokey) openLyrics(); /* current-song identity, not tab clicks */ }, [activeDetail?.seokey]);
  function retryTrack() {
    attemptedAudio.current = new Set(); songCacheRef.current.delete(trackKey(active)); setError('');
    if (active) { setActiveDetail(null); getTrackDetail({ ...active, streamUrls: {} }).then((d) => { if (trackKey(d) === currentTrackRef.current) { setActiveDetail(d); setQuality(chooseBestQuality(d.streamUrls || {})); setPlayerStatus('loading'); setShouldAutoplay(true); } }).catch((e) => { setError(e.message); setPlayerStatus('error'); }); }
  }
  function addToQueue(track) { setQueue((q) => dedupeQueue([...q, track])); }
  function backToAlbums() { ++collectionGeneration.current; collectionRequest.current?.abort(); setSelectedCollection(null); setCollectionStatus('idle'); setCenterTab('albums'); }
  return { videoRef, home, status, error, setError, homeWarning, loadHome, query, setQuery, searchResults, searchStatus, selectedCollection, collectionStatus, openAlbum, openArtist, openPlaylist, backToAlbums, queueTracks, playTrack, playNext, playPrevious, addToQueue, retryTrack, playingTrack, activeKey, currentTime, duration, quality, setQuality, qualityChips, playerStatus, isPlaying, togglePlay, seekTo, volume, changeVolume, toggleMute, muted, shuffleEnabled, setShuffleEnabled, repeatMode, cycleRepeat, favorites, favoriteSet, favoriteTracks, recents, toggleFavorite, centerTab, setCenterTab, lyrics, lyricsData, lyricsStatus, openLyrics, syncedLyricLines, activeLyricLineIndex, lyricRows, plainLyricLines, lyricAutoScroll, setLyricAutoScroll, lyricOffset, setLyricOffset, activeLyricRef, lyricBlur, setLyricBlur, facetLists, facet, facets, loadFacet, allShelfSongs, shelfCollections, trending, loadTrending, fresh, loadFresh, refreshImportedPlaylists, listeningMode, toggleListeningMode, pocketMode, enterPocketMode, setPocketMode, showSongCrud, setShowSongCrud, crudQuery, setCrudQuery, addImportedTrack, replaceImportedTrack, removeImportedTrack };

}
const MusicContext = createContext(null);
export function useMusic() { const music = useContext(MusicContext); if (!music) throw new Error('MusicProvider is required'); return music; }
export default function MusicProvider({ children }) {
  const pathname = usePathname(); const music = useMusicController(pathname === '/music');
  const mini = pathname !== '/music' && !pathname.startsWith('/watch') && pathname !== '/live' && music.playingTrack;
  return <MusicContext.Provider value={music}>{children}<audio ref={music.videoRef} preload="auto" playsInline />{mini ? <div className="mu-global-mini"><Link href="/music">♪ {music.playingTrack.title}</Link><button onClick={music.togglePlay} type="button">{music.isPlaying ? 'Pause' : 'Play'}</button><button onClick={() => music.playNext()} type="button">Next</button></div> : null}</MusicContext.Provider>;
}
