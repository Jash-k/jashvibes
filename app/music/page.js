'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSessionCache, restoreScroll, saveScroll, writeSessionCache } from '@/lib/clientCache';

const FAVORITES_KEY = 'jash_music_favorites';
const RECENTS_KEY = 'jash_music_recents';
const AUTH_STORAGE_KEY = 'jash_theatre_access_token';
const VOLUME_KEY = 'jash_music_volume';
const MUTED_KEY = 'jash_music_muted';
const MUSIC_CACHE_KEY = 'jash:music:v6';
const SONG_DETAIL_CACHE_KEY = 'jash:music:songs:v1';

const QUALITY_LABELS = {
  '320kbps': '320k',
  '160kbps': '160k',
  '96kbps': '96k',
  '48kbps': '48k',
  '12kbps': '12k',
  auto: 'Auto',
};

function trackKey(track) {
  if (!track || typeof track !== 'object') return '';
  return String(track.seokey || track.id || track.trackId || track.title || '');
}

function chooseBestQuality(streamUrls = {}) {
  return ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps', 'auto'].find((key) => streamUrls[key]) || Object.keys(streamUrls)[0] || '';
}

function isHlsUrl(url = '') {
  const lower = String(url || '').toLowerCase();
  return lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('/hls/');
}

function formatTime(value = 0) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function dedupeQueue(tracks = []) {
  const seen = new Set();
  const output = [];
  for (const track of tracks || []) {
    const key = trackKey(track);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(track);
  }
  return output;
}

function emptySearchResults() {
  return { songs: [], albums: [], artists: [], playlists: [] };
}

function normalizeSearchResults(value) {
  if (Array.isArray(value)) return { ...emptySearchResults(), songs: value.filter(Boolean) };
  return {
    songs: Array.isArray(value?.songs) ? value.songs.filter(Boolean) : Array.isArray(value?.items) ? value.items.filter(Boolean) : [],
    albums: Array.isArray(value?.albums) ? value.albums.filter(Boolean) : [],
    artists: Array.isArray(value?.artists) ? value.artists.filter(Boolean) : [],
    playlists: Array.isArray(value?.playlists) ? value.playlists.filter(Boolean) : [],
  };
}

function searchResultCount(results) {
  return (results?.songs?.length || 0) + (results?.albums?.length || 0) + (results?.artists?.length || 0) + (results?.playlists?.length || 0);
}

function splitArtistText(value = '') {
  return String(value || '')
    .split(/,|&|;|\band\b/gi)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function artistChipsFromTrack(track) {
  const rawList = Array.isArray(track?.artistList) ? track.artistList : [];
  const combined = rawList.length
    ? rawList
    : splitArtistText(track?.artists).map((name) => ({ id: name, name }));
  const seen = new Set();
  return combined
    .map((item) => ({ id: String(item?.id || item?.name || '').trim(), name: String(item?.name || '').trim(), image: item?.image || '' }))
    .filter((item) => item.name)
    .filter((item) => {
      const key = (item.id || item.name).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function parseLrcTimestamp(value = '') {
  const match = String(value).match(/(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (!match) return null;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  const millis = Number(String(match[3] || '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + millis / 1000;
}

function parseSyncedLyrics(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .flatMap((line) => {
      const stamps = [...line.matchAll(/\[(\d{1,2}:\d{1,2}(?:\.\d{1,3})?)\]/g)];
      if (!stamps.length) return [];
      const text = line.replace(/\[[^\]]+\]/g, '').trim();
      return stamps
        .map((stamp) => ({ time: parseLrcTimestamp(stamp[1]), text }))
        .filter((item) => item.time !== null && item.text);
    })
    .sort((a, b) => a.time - b.time);
}

function plainFromSyncedLyrics(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

function IconButton({ active = false, children, onClick, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-black transition ${
        active
          ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100 shadow-lg shadow-fuchsia-950/30'
          : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:border-fuchsia-400/40 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function SidebarButton({ active, icon, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-black transition ${
        active
          ? 'bg-fuchsia-500/15 text-fuchsia-100 shadow-lg shadow-fuchsia-950/20'
          : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'
      }`}
    >
      <span className="text-lg">{icon}</span>
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

function HorizontalRow({ children }) {
  const rowRef = useRef(null);
  const scroll = (direction) => {
    const node = rowRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(240, node.clientWidth * 0.82), behavior: 'smooth' });
  };

  return (
    <div className="relative min-w-0 max-w-full overflow-hidden rounded-[1.75rem]">
      <button
        type="button"
        onClick={() => scroll(-1)}
        className="absolute left-1 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-fuchsia-300/35 bg-black/90 text-xl font-black text-fuchsia-100 shadow-xl shadow-fuchsia-950/40 backdrop-blur transition hover:bg-fuchsia-300 hover:text-black active:scale-95 sm:h-10 sm:w-10"
        aria-label="Scroll left"
      >
        ‹
      </button>
      <div ref={rowRef} className="flex w-full min-w-0 max-w-full snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-11 pb-2 touch-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:px-12">
        {children}
      </div>
      <button
        type="button"
        onClick={() => scroll(1)}
        className="absolute right-1 top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-fuchsia-300/35 bg-black/90 text-xl font-black text-fuchsia-100 shadow-xl shadow-fuchsia-950/40 backdrop-blur transition hover:bg-fuchsia-300 hover:text-black active:scale-95 sm:h-10 sm:w-10"
        aria-label="Scroll right"
      >
        ›
      </button>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h2>
        {subtitle ? <p className="mt-1 text-xs font-medium text-zinc-500 sm:text-sm">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function TrackTile({ track, active, favorite, onPlay, onFavorite }) {
  if (!track) return null;
  return (
    <div className={`group w-40 shrink-0 snap-start rounded-[1.65rem] border p-3 transition sm:w-48 ${active ? 'border-fuchsia-400/70 bg-fuchsia-500/15 shadow-lg shadow-fuchsia-950/30' : 'border-white/10 bg-white/[0.045] hover:border-fuchsia-400/45 hover:bg-fuchsia-500/[0.08]'}`}>
      <button type="button" onClick={() => onPlay(track)} className="block w-full text-left">
        <div className="relative aspect-square overflow-hidden rounded-3xl bg-zinc-900 shadow-xl shadow-black/40">
          {track.image ? <img src={track.image} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" loading="lazy" /> : null}
          <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
          <span className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-fuchsia-400 text-sm font-black text-black opacity-0 shadow-xl shadow-fuchsia-500/30 transition group-hover:opacity-100">▶</span>
        </div>
        <h3 className="mt-3 line-clamp-2 min-h-10 text-sm font-black leading-5 text-white">{track.title}</h3>
        <p className="mt-1 truncate text-xs font-semibold text-zinc-400">{track.artists || 'Unknown Artist'}</p>
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-semibold text-zinc-600">{track.durationLabel || track.language || 'Tamil'}</span>
        <button type="button" onClick={() => onFavorite(track)} className={`grid h-8 w-8 place-items-center rounded-full border text-sm transition ${favorite ? 'border-yellow-300 bg-yellow-300/15 text-yellow-100' : 'border-white/10 bg-black/30 text-zinc-400 hover:text-white'}`}>{favorite ? '★' : '☆'}</button>
      </div>
    </div>
  );
}

function ArtistTile({ artist, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(artist)} className="w-32 shrink-0 snap-start text-center sm:w-36">
      <div className="mx-auto h-24 w-24 overflow-hidden rounded-full border border-fuchsia-400/20 bg-white/[0.045] shadow-xl shadow-fuchsia-950/20 sm:h-28 sm:w-28">
        {artist.image ? <img src={artist.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
      </div>
      <p className="mt-2 line-clamp-2 text-sm font-black text-white">{artist.name}</p>
      <p className="mt-1 truncate text-[11px] text-zinc-600">{artist.dominantType || artist.role || 'Music Director'}</p>
    </button>
  );
}

function AlbumTile({ album, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(album)} className="w-40 shrink-0 snap-start rounded-[1.65rem] border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-fuchsia-400/45 hover:bg-fuchsia-500/[0.08] sm:w-48">
      <div className="aspect-square overflow-hidden rounded-3xl bg-zinc-900">
        {album.image ? <img src={album.image} alt="" className="h-full w-full object-cover transition hover:scale-105" loading="lazy" /> : null}
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-sm font-black leading-5 text-white">{album.title}</p>
      <p className="mt-1 truncate text-xs text-zinc-500">{album.artists || album.subtitle || album.language || 'Album'}</p>
    </button>
  );
}

function PlaylistTile({ item, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(item)} className="w-44 shrink-0 snap-start rounded-[1.65rem] border border-white/10 bg-gradient-to-br from-fuchsia-500/15 via-white/[0.045] to-black p-4 text-left transition hover:border-fuchsia-400/45 sm:w-56">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-fuchsia-400 text-3xl text-black shadow-xl shadow-fuchsia-950/30">♬</div>
      <p className="mt-4 line-clamp-2 text-base font-black text-white">{item.title}</p>
      <p className="mt-1 truncate text-xs text-zinc-500">{item.subtitle || item.language || 'Playlist'}</p>
    </button>
  );
}

function TrackList({ tracks, activeKey, favoriteSet, onPlay, onFavorite }) {
  const safeTracks = (tracks || []).filter(Boolean);
  return (
    <div className="grid gap-2">
      {safeTracks.map((track, index) => {
        const key = trackKey(track);
        return (
          <button
            key={`${key}-${index}`}
            type="button"
            onClick={() => onPlay(track)}
            className={`flex items-center gap-3 rounded-2xl border p-2.5 text-left transition ${activeKey === key ? 'border-fuchsia-400/70 bg-fuchsia-500/15' : 'border-white/10 bg-white/[0.04] hover:border-fuchsia-400/35 hover:bg-fuchsia-500/[0.07]'}`}
          >
            <span className="hidden w-7 shrink-0 text-center text-xs font-black text-zinc-600 sm:block">{index + 1}</span>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-900">{track.image ? <img src={track.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-white">{track.title}</p><p className="truncate text-xs text-zinc-500">{track.artists || 'Unknown Artist'}</p></div>
            <span className="hidden text-xs text-zinc-600 md:block">{track.durationLabel}</span>
            <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); onFavorite(track); }} className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-sm ${favoriteSet.has(key) ? 'border-yellow-300 bg-yellow-300/15 text-yellow-100' : 'border-white/10 bg-black/30 text-zinc-400'}`}>{favoriteSet.has(key) ? '★' : '☆'}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function MusicPage() {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const songCacheRef = useRef(new Map());
  const prefetchingRef = useRef(new Set());
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
        if (!isHlsUrl(url)) { video.src = url; video.load(); return; }
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
    const onTime = () => setCurrentTime(video.currentTime || 0);
    const onDuration = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => playNext(true);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    return () => { video.removeEventListener('timeupdate', onTime); video.removeEventListener('durationchange', onDuration); video.removeEventListener('loadedmetadata', onDuration); video.removeEventListener('play', onPlay); video.removeEventListener('pause', onPause); video.removeEventListener('ended', onEnded); };
  }, [activeKey, repeatMode, shuffleEnabled, queueTracks]);

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

  async function openLyrics() {
    setShowLyrics((value) => !value);
    const detail = activeDetail || active;
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
      setSelectedCollection({ type: 'playlist', title: playlist.title, image: playlist.image, tracks: [], albums: [] });
      const response = await fetch(`/api/music/playlist?id=${encodeURIComponent(playlist.id)}&title=${encodeURIComponent(playlist.title || '')}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Playlist failed');
      const item = data.item;
      const tracks = item.songs || [];
      setSelectedCollection({ type: 'playlist', title: item.title, subtitle: `${item.songCount || tracks.length || 0} songs`, image: item.image, tracks, albums: [] });
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
    if (showLyrics && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [showLyrics, activeLyricLineIndex]);

  return (
    <main className="palette-music-magenta min-h-dvh overflow-x-hidden bg-[#050012] pb-28 text-zinc-100">
      <div className="mx-auto grid w-full min-w-0 max-w-[92rem] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="sticky top-0 z-50 border-b border-fuchsia-400/10 bg-[#080008]/90 px-3 py-3 backdrop-blur-xl lg:fixed lg:bottom-0 lg:left-0 lg:w-60 lg:border-b-0 lg:border-r lg:px-4 lg:py-5">
          <div className="flex items-center justify-between gap-3 lg:block">
            <Link href="/" className="inline-flex rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-fuchsia-400/40 hover:text-white">← Home</Link>
            <div className="text-right lg:mt-6 lg:text-left">
              <p className="text-[10px] font-black uppercase tracking-[0.32em] text-fuchsia-300/80">ராக வானம்</p>
              <h1 className="hidden text-3xl font-black text-white lg:block">Music</h1>
            </div>
          </div>
          <nav className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:mt-8 lg:grid lg:gap-2 lg:overflow-visible">
            {navItems.map(([id, icon, label]) => (
              <SidebarButton key={id} icon={icon} label={label} active={view === id} onClick={() => { setView(id); if (id !== 'search') setQuery(''); }} />
            ))}
          </nav>
        </aside>

        <section className="min-w-0 px-4 py-5 sm:px-6 lg:col-start-2 lg:px-8">
          <header className="relative overflow-hidden rounded-[2rem] border border-fuchsia-400/20 bg-[radial-gradient(circle_at_15%_18%,rgba(217,70,239,0.34),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(236,72,153,0.20),transparent_28%),linear-gradient(135deg,#160014,#050505_58%,#120012)] p-6 shadow-2xl shadow-fuchsia-950/30 sm:p-9">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-fuchsia-300/80">Tamil • JioSaavn only</p>
            <h2 className="mt-4 text-5xl font-black tracking-tight text-fuchsia-100 drop-shadow-[0_0_28px_rgba(217,70,239,0.85)] sm:text-7xl">ராக வானம்</h2>
            <input value={query} onChange={(event) => { setQuery(event.target.value); setView('search'); }} placeholder="Search songs, albums, artists, playlists..." className="mt-6 w-full max-w-xl rounded-full border border-fuchsia-400/20 bg-black/50 px-5 py-3 text-base font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-300" />
          </header>

          <div className="mt-8 space-y-9">
            {view === 'search' ? (
              <section className="min-w-0 overflow-hidden rounded-[2rem] border border-fuchsia-400/10 bg-white/[0.025] p-3 sm:p-5">
                <SectionHeader
                  title="Search Results"
                  subtitle={!query.trim() ? 'Search any keyword — songs, albums, artists and playlists appear separately.' : searchStatus === 'loading' ? 'Searching songs, albums, artists and playlists...' : `${searchTotal} results • ${searchSongsList.length} songs • ${searchAlbumsList.length} albums • ${searchArtistsList.length} artists • ${searchPlaylistsList.length} playlists`}
                />
                {!query.trim() ? <div className="rounded-3xl border border-white/10 bg-black/30 p-5 text-sm text-zinc-400">Type a movie, album, artist or playlist name. Example: <span className="font-black text-fuchsia-200">Balti album</span>.</div> : null}
                {query.trim() && searchStatus === 'loading' ? <div className="rounded-3xl border border-white/10 bg-black/30 p-5 text-sm text-zinc-400">Searching JioSaavn...</div> : null}
                {query.trim() && searchStatus !== 'loading' && searchTotal === 0 ? <div className="rounded-3xl border border-white/10 bg-black/30 p-5 text-sm text-zinc-400">No results found. Try a shorter keyword.</div> : null}
                <div className="space-y-7">
                  {searchAlbumsList.length ? <div><SectionHeader title="Albums" subtitle={`${searchAlbumsList.length} found`} /><HorizontalRow>{searchAlbumsList.map((album) => <AlbumTile key={album.id} album={album} onOpen={openAlbum} />)}</HorizontalRow></div> : null}
                  {searchArtistsList.length ? <div><SectionHeader title="Artists" subtitle={`${searchArtistsList.length} found`} /><HorizontalRow>{searchArtistsList.map((artist) => <ArtistTile key={artist.id || artist.name} artist={artist} onOpen={openArtist} />)}</HorizontalRow></div> : null}
                  {searchPlaylistsList.length ? <div><SectionHeader title="Playlists" subtitle={`${searchPlaylistsList.length} found`} /><HorizontalRow>{searchPlaylistsList.map((item) => <PlaylistTile key={item.id} item={item} onOpen={openPlaylist} />)}</HorizontalRow></div> : null}
                  {searchSongsList.length ? <div><SectionHeader title="Songs" subtitle={`${searchSongsList.length} found`} /><TrackList tracks={searchSongsList} activeKey={activeKeyValue} favoriteSet={favoriteSet} onPlay={(track) => playTrack(track, searchSongsList, true)} onFavorite={toggleFavorite} /></div> : null}
                </div>
              </section>
            ) : null}

            {status === 'loading' ? <div className="rounded-3xl border border-white/10 bg-zinc-950 p-8 text-center text-zinc-400">Loading music...</div> : null}
            {status === 'error' ? <div className="rounded-3xl border border-red-500/30 bg-red-950/20 p-6 text-red-200"><p>{error}</p><button type="button" onClick={loadHome} className="mt-4 rounded-full border border-red-300/30 bg-red-500/10 px-4 py-2 text-xs font-black text-red-100">Retry Music</button></div> : null}
            {status === 'ready' && homeWarning ? <div className="rounded-3xl border border-yellow-400/20 bg-yellow-500/10 p-4 text-sm leading-6 text-yellow-100"><p className="font-bold">Music source warning</p><p className="text-yellow-100/80">{homeWarning}</p><button type="button" onClick={loadHome} className="mt-3 rounded-full border border-yellow-300/30 px-4 py-2 text-xs font-black text-yellow-50">Retry</button></div> : null}
            {status === 'ready' && view === 'home' && !homeHasAnySongCards ? <div className="rounded-3xl border border-fuchsia-400/20 bg-fuchsia-500/10 p-5 text-sm leading-6 text-fuchsia-100"><p className="font-black">No song cards loaded yet.</p><p className="mt-1 text-fuchsia-100/75">JioSaavn may be asleep or your SAAVN env is wrong. Artists below still open search/fallback pages. Check <code className="rounded bg-black/40 px-1">/api/music/home</code> and set <code className="rounded bg-black/40 px-1">SAAVN=https://saavnapi.onrender.com</code>.</p><button type="button" onClick={loadHome} className="mt-3 rounded-full border border-fuchsia-300/30 bg-black/20 px-4 py-2 text-xs font-black">Retry JioSaavn</button></div> : null}

            {view === 'playlists' ? (
              <section className="rounded-[2rem] border border-fuchsia-400/15 bg-white/[0.04] p-4 sm:p-5">
                <SectionHeader title="Spotify Playlist Sync" subtitle="Paste public Spotify playlists. Tracks are matched and played through JioSaavn only." action={<button type="button" onClick={refreshImportedPlaylists} className="rounded-full border border-white/10 px-4 py-2 text-xs font-black text-zinc-200 hover:border-fuchsia-300/40">Refresh</button>} />
                <textarea
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  placeholder="Paste Spotify playlist links, one per line or comma separated..."
                  className="min-h-28 w-full rounded-3xl border border-white/10 bg-black/50 p-4 text-sm font-semibold text-white outline-none placeholder:text-zinc-600 focus:border-fuchsia-300"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={importSpotifyPlaylists} disabled={importStatus === 'importing'} className="rounded-full bg-fuchsia-400 px-5 py-2.5 text-xs font-black text-black shadow-lg shadow-fuchsia-950/30 disabled:opacity-60">{importStatus === 'importing' ? 'Importing...' : 'Add / Sync Playlists'}</button>
                  <span className={`text-xs font-semibold ${importStatus === 'error' ? 'text-red-300' : importStatus === 'done' ? 'text-green-300' : 'text-zinc-500'}`}>{importMessage}</span>
                </div>
                {importedPlaylists.length ? (
                  <div className="mt-5 grid gap-2">
                    {importedPlaylists.map((playlist) => (
                      <div key={playlist.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/25 p-2.5">
                        <button type="button" onClick={() => openPlaylist(playlist)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-zinc-900">{playlist.image ? <img src={playlist.image} alt="" className="h-full w-full object-cover" /> : null}</div>
                          <div className="min-w-0"><p className="truncate text-sm font-black text-white">{playlist.title}</p><p className="truncate text-xs text-zinc-500">{playlist.subtitle || `${playlist.songCount || 0} songs`}</p></div>
                        </button>
                        <button type="button" onClick={() => resyncImportedPlaylist(playlist)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-black text-zinc-300 hover:border-fuchsia-300/40">Sync</button>
                        <button type="button" onClick={() => renameImportedPlaylist(playlist)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] font-black text-zinc-300 hover:border-fuchsia-300/40">Edit</button>
                        <button type="button" onClick={() => deleteImportedPlaylist(playlist)} className="rounded-full border border-red-400/20 px-3 py-1.5 text-[11px] font-black text-red-200 hover:border-red-300/60">Delete</button>
                      </div>
                    ))}
                  </div>
                ) : <p className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-400">No imported playlists yet. Add your public Spotify playlist links above.</p>}
              </section>
            ) : null}

            {selectedCollection && ['artists', 'albums', 'playlists'].includes(view) ? (
              <section className="min-w-0 overflow-hidden rounded-[2rem] border border-fuchsia-400/15 bg-white/[0.045] p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex min-w-0 gap-4">
                    <div className={`${selectedCollection.type === 'artist' ? 'rounded-full' : 'rounded-3xl'} h-24 w-24 shrink-0 overflow-hidden bg-zinc-900 sm:h-32 sm:w-32`}>{selectedCollection.image ? <img src={selectedCollection.image} alt="" className="h-full w-full object-cover" /> : null}</div>
                    <div className="min-w-0 self-center"><p className="text-[10px] font-black uppercase tracking-[0.28em] text-fuchsia-300/80">{selectedCollection.type}</p><h2 className="mt-2 line-clamp-2 text-3xl font-black text-white sm:text-5xl">{selectedCollection.title}</h2>{selectedCollection.subtitle ? <p className="mt-2 text-sm text-zinc-400">{selectedCollection.subtitle}</p> : null}</div>
                  </div>
                  <button onClick={() => setSelectedCollection(null)} className="rounded-full border border-white/10 px-4 py-2 text-xs font-black text-zinc-300 hover:border-fuchsia-400/40">Close</button>
                </div>
                {collectionStatus === 'loading' ? <div className="mt-5 rounded-2xl bg-black/40 p-5 text-sm text-zinc-400">Loading {selectedCollection.type}...</div> : null}
                {selectedCollection.albums?.length ? <div className="mt-6"><SectionHeader title="Albums" action={selectedCollection.type === 'artist' && !selectedCollection.albumsExpanded ? <button type="button" onClick={loadAllArtistAlbums} className="rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-2 text-xs font-black text-fuchsia-100">See all</button> : null} /><HorizontalRow>{selectedCollection.albums.map((album) => <AlbumTile key={album.id} album={album} onOpen={openAlbum} />)}</HorizontalRow></div> : null}
                {selectedCollection.tracks?.length ? <div className="mt-6"><SectionHeader title={selectedCollection.type === 'album' ? 'Album Tracks' : selectedCollection.type === 'playlist' ? 'Playlist Songs' : 'Top Songs'} subtitle={`${selectedCollection.tracks.length} songs`} /><HorizontalRow>{selectedCollection.tracks.map((track) => <TrackTile key={trackKey(track)} track={track} active={activeKeyValue === trackKey(track)} favorite={favoriteSet.has(trackKey(track))} onPlay={(song) => playTrack(song, selectedCollection.tracks, true)} onFavorite={toggleFavorite} />)}</HorizontalRow></div> : null}
              </section>
            ) : null}

            {(view === 'home' || view === 'search') && mainSections.map((section) => (
              <section key={section.id}>
                <SectionHeader title={section.title} />
                <HorizontalRow>{(section.items || []).map((track) => <TrackTile key={trackKey(track)} track={track} active={activeKeyValue === trackKey(track)} favorite={favoriteSet.has(trackKey(track))} onPlay={(song) => playTrack(song, section.items, true)} onFavorite={toggleFavorite} />)}</HorizontalRow>
              </section>
            ))}

            {view === 'home' && home.releases?.tracks?.length ? <section><SectionHeader title="New Tamil Releases" /><HorizontalRow>{home.releases.tracks.map((track) => <TrackTile key={trackKey(track)} track={track} active={activeKeyValue === trackKey(track)} favorite={favoriteSet.has(trackKey(track))} onPlay={(song) => playTrack(song, home.releases.tracks, true)} onFavorite={toggleFavorite} />)}</HorizontalRow></section> : null}
            {(view === 'home' || view === 'artists') && home.artists?.length ? <section><SectionHeader title="Top Tamil Music Directors" /><HorizontalRow>{home.artists.map((artist) => <ArtistTile key={artist.id || artist.name} artist={artist} onOpen={openArtist} />)}</HorizontalRow></section> : null}
            {(view === 'home' || view === 'albums') && home.releases?.albums?.length ? <section><SectionHeader title="Tamil Albums" /><HorizontalRow>{home.releases.albums.map((album) => <AlbumTile key={album.id} album={album} onOpen={openAlbum} />)}</HorizontalRow></section> : null}
            {(view === 'home' || view === 'playlists') && home.playlists?.length ? <section><SectionHeader title="Imported Spotify Playlists" /><HorizontalRow>{home.playlists.map((item) => <PlaylistTile key={item.id} item={item} onOpen={openPlaylist} />)}</HorizontalRow></section> : null}
            {view === 'favorites' ? <section><SectionHeader title="Favorites" subtitle="Saved on this device" /><TrackList tracks={favoriteTracks} activeKey={activeKeyValue} favoriteSet={favoriteSet} onPlay={(track) => playTrack(track, favoriteTracks, true)} onFavorite={toggleFavorite} /></section> : null}
            {view === 'recent' ? <section><SectionHeader title="Recently Played" /><TrackList tracks={recents} activeKey={activeKeyValue} favoriteSet={favoriteSet} onPlay={(track) => playTrack(track, recents, true)} onFavorite={toggleFavorite} /></section> : null}
          </div>
        </section>
      </div>

      {showMiniPlayer && playingTrack ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 pb-28 backdrop-blur-xl sm:items-center sm:p-5" onClick={() => setShowMiniPlayer(false)}>
          <section
            className="w-full max-w-sm overflow-hidden rounded-[2.25rem] border border-fuchsia-300/25 bg-[radial-gradient(circle_at_20%_0%,rgba(217,70,239,0.34),transparent_30%),linear-gradient(160deg,#1a061b,#050008_58%,#120012)] p-4 shadow-2xl shadow-fuchsia-950/60 sm:max-w-md sm:p-5"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Now playing"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.34em] text-fuchsia-300/80">Now Playing</p>
                <p className="mt-1 text-xs font-semibold text-zinc-500">Tap artist name to open songs/albums</p>
              </div>
              <button type="button" onClick={() => setShowMiniPlayer(false)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-sm font-black text-zinc-200 transition hover:border-fuchsia-300/50 hover:text-white" aria-label="Close player">×</button>
            </div>

            <div className="mx-auto mt-4 aspect-square w-full max-w-[min(74vw,19rem)] overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 sm:max-w-[20rem]">
              {playingImage ? <img src={playingImage} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-950 via-black to-zinc-950 text-5xl">♫</div>}
            </div>

            <div className="mt-4 text-center">
              <h3 className="line-clamp-2 text-xl font-black leading-tight text-white sm:text-2xl">{playingTrack.title || 'Select a song'}</h3>
              {playingTrack.album ? <p className="mt-1 truncate text-xs font-semibold text-zinc-500">{playingTrack.album}</p> : null}
              {currentArtistChips.length ? (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {currentArtistChips.map((artist) => (
                    <button
                      key={artist.id || artist.name}
                      type="button"
                      onClick={() => { setShowMiniPlayer(false); openArtist({ id: artist.id || artist.name, name: artist.name, image: artist.image }); }}
                      className="rounded-full border border-fuchsia-300/30 bg-fuchsia-500/15 px-3 py-1.5 text-xs font-black text-fuchsia-50 shadow-lg shadow-fuchsia-950/20 transition active:scale-95 hover:bg-fuchsia-300 hover:text-black"
                      title={`Open ${artist.name}`}
                    >
                      {artist.name}
                    </button>
                  ))}
                </div>
              ) : <p className="mt-2 text-sm font-semibold text-zinc-400">{playingTrack.artists || 'Tamil Music'}</p>}
            </div>

            <div className="mt-5">
              <input type="range" min="0" max={Math.max(duration, 0)} value={Math.min(currentTime, duration || currentTime || 0)} onChange={(event) => seekTo(event.target.value)} className="h-1 w-full accent-fuchsia-300" aria-label="Seek now playing" />
              <div className="mt-1 flex justify-between text-[11px] font-bold text-zinc-500"><span>{formatTime(currentTime)}</span><span>{duration ? formatTime(duration) : '--:--'}</span></div>
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <IconButton active={shuffleEnabled} onClick={() => setShuffleEnabled((value) => !value)} title="Shuffle">🔀</IconButton>
              <IconButton onClick={playPrevious} title="Previous">⏮</IconButton>
              <button type="button" onClick={togglePlay} className="grid h-14 w-14 place-items-center rounded-full bg-fuchsia-300 text-xl font-black text-black shadow-xl shadow-fuchsia-500/35 transition active:scale-95 hover:bg-fuchsia-200" aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
              <IconButton onClick={() => playNext(false)} title="Next">⏭</IconButton>
              <IconButton active={repeatMode !== 'off'} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === 'one' ? '↻1' : '↻'}</IconButton>
            </div>

            <div className="mt-4 flex items-center justify-center gap-2">
              <button type="button" onClick={() => { setShowMiniPlayer(false); openLyrics(); }} className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-black text-zinc-200 transition hover:border-fuchsia-300/40 hover:text-white">Lyrics</button>
              <button type="button" onClick={() => toggleFavorite(playingTrack)} className={`rounded-full border px-4 py-2 text-xs font-black transition ${favoriteSet.has(trackKey(playingTrack)) ? 'border-yellow-300 bg-yellow-300/15 text-yellow-100' : 'border-white/10 bg-white/[0.05] text-zinc-200 hover:border-yellow-300/40'}`}>{favoriteSet.has(trackKey(playingTrack)) ? '★ Saved' : '☆ Save'}</button>
            </div>

            {playerStatus === 'loading' ? <p className="mt-3 text-center text-xs font-semibold text-fuchsia-200">Loading stream...</p> : null}
            {playerStatus === 'error' ? <p className="mt-3 line-clamp-2 text-center text-xs font-semibold text-red-300">{error}</p> : null}
          </section>
        </div>
      ) : null}

      {showLyrics ? (
        <div className="fixed inset-x-3 bottom-28 z-50 max-h-[45dvh] overflow-y-auto rounded-3xl border border-fuchsia-400/20 bg-[#120012]/95 p-4 shadow-2xl shadow-fuchsia-950/40 backdrop-blur-xl sm:left-auto sm:right-5 sm:w-[28rem]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.25em] text-fuchsia-200">Lyrics</h3>
              {lyricsData?.source ? <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">{lyricsData.source === 'lrclib' ? 'LRCLIB' : lyricsData.source}</p> : null}
            </div>
            <button onClick={() => setShowLyrics(false)} className="rounded-full border border-white/10 px-3 py-1 text-xs font-bold text-zinc-300">Close</button>
          </div>
          {lyricsStatus === 'loading' ? <p className="text-sm leading-7 text-zinc-200">Loading lyrics...</p> : null}
          {lyricsStatus !== 'loading' && syncedLyricLines.length ? (
            <div className="space-y-2 py-2">
              {syncedLyricLines.map((line, index) => (
                <p
                  key={`${line.time}-${index}`}
                  ref={index === activeLyricLineIndex ? activeLyricRef : null}
                  className={`rounded-2xl px-3 py-2 text-sm leading-6 transition ${index === activeLyricLineIndex ? 'bg-fuchsia-400/15 text-fuchsia-50 shadow-lg shadow-fuchsia-950/20' : index < activeLyricLineIndex ? 'text-zinc-500' : 'text-zinc-200'}`}
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}
          {lyricsStatus !== 'loading' && !syncedLyricLines.length ? <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{lyrics || 'Lyrics unavailable for this song.'}</p> : null}
          {lyricsData?.matched ? <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-5 text-zinc-500">Matched: {lyricsData.matched.trackName} • {lyricsData.matched.artistName}</p> : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-fuchsia-400/20 bg-[#080008]/95 px-3 py-3 shadow-2xl shadow-fuchsia-950/30 backdrop-blur-xl sm:px-5">
        <div className="mx-auto max-w-7xl">
          <input type="range" min="0" max={Math.max(duration, 0)} value={Math.min(currentTime, duration || currentTime || 0)} onChange={(event) => seekTo(event.target.value)} className="mb-3 h-1 w-full accent-fuchsia-400" aria-label="Seek" />
          <div className="flex items-center gap-2 sm:gap-3">
            <IconButton active={shuffleEnabled} onClick={() => setShuffleEnabled((value) => !value)} title="Shuffle">🔀</IconButton>
            <IconButton onClick={playPrevious} title="Previous">⏮</IconButton>
            <button type="button" onClick={togglePlay} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-fuchsia-400 text-base font-black text-black shadow-lg shadow-fuchsia-500/30 transition hover:bg-fuchsia-300" aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? 'Ⅱ' : '▶'}</button>
            <IconButton onClick={() => playNext(false)} title="Next">⏭</IconButton>
            <IconButton active={repeatMode !== 'off'} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>{repeatMode === 'one' ? '↻1' : '↻'}</IconButton>
            <button type="button" onClick={() => playingTrack && setShowMiniPlayer(true)} disabled={!playingTrack} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-zinc-900 text-left shadow-lg shadow-black/35 outline-none transition active:scale-95 disabled:opacity-60 focus:ring-2 focus:ring-fuchsia-300" aria-label="Open now playing player" title="Open now playing">
              {playingImage ? <img src={playingImage} alt="" className="h-full w-full object-cover transition group-hover:scale-105" /> : null}
              <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/0 text-[10px] font-black text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">OPEN</span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-white">{activeDetail?.title || active?.title || 'Select a song'}</p>
              {currentArtistChips.length ? (
                <div className="mt-1 flex max-w-full gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {currentArtistChips.map((artist) => (
                    <button
                      key={artist.id || artist.name}
                      type="button"
                      onClick={() => openArtist({ id: artist.id || artist.name, name: artist.name, image: artist.image })}
                      className="max-w-[8rem] shrink-0 truncate rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-black text-fuchsia-100 transition hover:border-fuchsia-300 hover:bg-fuchsia-400 hover:text-black"
                      title={`Open ${artist.name}`}
                    >
                      {artist.name}
                    </button>
                  ))}
                </div>
              ) : <p className="truncate text-xs text-zinc-500">{activeDetail?.artists || active?.artists || 'Tamil Music'}</p>}
              <p className="text-[11px] text-zinc-600">{formatTime(currentTime)} / {duration ? formatTime(duration) : '--:--'}</p>
              {playerStatus === 'loading' ? <p className="text-[11px] text-fuchsia-300">Loading stream...</p> : null}
              {playerStatus === 'error' ? <p className="truncate text-[11px] text-red-300">{error}</p> : null}
            </div>
            <video ref={videoRef} className="hidden" playsInline poster={activeDetail?.image || active?.image || undefined} />
            <div className="hidden items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 lg:flex" title="Volume">
              <button type="button" onClick={toggleMute} className="grid h-7 w-7 place-items-center rounded-lg text-sm transition hover:bg-fuchsia-400/15" aria-label={effectiveVolume === 0 ? 'Unmute' : 'Mute'}>{volumeIcon}</button>
              <input type="range" min="0" max="1" step="0.01" value={effectiveVolume} onChange={(event) => changeVolume(event.target.value)} className="h-1 w-24 accent-fuchsia-400" aria-label="Volume" />
              <span className="w-8 text-right text-[10px] font-black text-zinc-500">{Math.round(effectiveVolume * 100)}%</span>
            </div>
            {activeDetail?.streamUrls ? <select value={quality} onChange={(event) => setQuality(event.target.value)} className="hidden rounded-xl border border-white/10 bg-black px-3 py-2 text-xs font-bold text-white outline-none sm:block">{Object.entries(activeDetail.streamUrls).filter(([, url]) => Boolean(url)).map(([key]) => <option key={key} value={key}>{QUALITY_LABELS[key] || key}</option>)}</select> : null}
            <button type="button" onClick={openLyrics} className={`hidden rounded-xl border px-3 py-2 text-xs font-black transition sm:block ${showLyrics ? 'border-fuchsia-300 bg-fuchsia-500/20 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-fuchsia-400/40'}`}>Lyrics</button>
          </div>
        </div>
      </div>
    </main>
  );
}
