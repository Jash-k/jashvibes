'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';

const AUDIO_PREF_KEY = 'jash:video:audio-pref';
const BW_KEY = 'jash:video:hls-bw-estimate';

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function isHlsUrl(url = '') {
  return /\.m3u8(\?|#|$)/i.test(String(url || '')) || String(url || '').toLowerCase().includes('m3u8');
}

function withStartFragment(url = '', seconds = 0) {
  if (!seconds || seconds < 1) return url;
  if (url.includes('#')) return url;
  return `${url}#t=${Math.floor(seconds)}`;
}

function toVtt(text = '') {
  const body = String(text || '').replace(/\r+/g, '');
  if (/^﻿?WEBVTT/i.test(body.trim())) return body;
  return `WEBVTT\n\n${body.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')}`;
}

const LANG_NAMES = {
  en: 'English', eng: 'English',
  hi: 'हिंदी', hin: 'हिंदी',
  ta: 'தமிழ்', tam: 'தமிழ்',
  te: 'తెలుగు', tel: 'తెలుగు',
  kn: 'ಕನ್ನಡ', kan: 'ಕನ್ನಡ',
  ml: 'മലയാളം', mal: 'മലയാളം',
  bn: 'বাংলা', ben: 'বাংলা',
  mr: 'मराठी', mar: 'मराठी',
  pa: 'ਪੰਜਾਬੀ', pan: 'ਪੰਜਾਬੀ',
  ur: 'اردو', urd: 'اردو',
};

function getLanguageName(track, fallbackIndex = 0) {
  if (!track) return `Track ${fallbackIndex + 1}`;
  const name = String(track.name || track.label || '').trim();
  const lang = String(track.lang || track.language || '').toLowerCase().trim();
  const generic = !name || /^(audio|track|stream|und|unknown)[\s_-]*\d*$/i.test(name);
  if (!generic) return name;
  if (LANG_NAMES[lang]) return LANG_NAMES[lang];
  if (lang && lang !== 'und') return lang.toUpperCase();
  return `Track ${fallbackIndex + 1}`;
}

function audioMatchesPreference(track, preference = '') {
  const pref = String(preference || '').toLowerCase().trim();
  if (!pref) return false;
  const normalized = {
    tamil: 'tam', hindi: 'hin', english: 'eng', telugu: 'tel', kannada: 'kan', malayalam: 'mal',
  }[pref] || pref;
  const lang = String(track?.lang || '').toLowerCase();
  const name = String(track?.name || '').toLowerCase();
  return lang === normalized || lang.slice(0, 2) === normalized.slice(0, 2) || name.includes(pref);
}

function buildHlsErrorMessage(data = {}) {
  const code = data?.response?.code;
  const details = data?.details || 'HLS error';
  if (code === 403) return 'HLS stream was rejected with HTTP 403. This usually means the signed URL/origin is not allowed.';
  if (code === 404) return 'HLS stream returned HTTP 404. This title/path is not hosted on this server.';
  if (code === 401 || code === 410) return `HLS signed URL expired or was rejected with HTTP ${code}.`;
  if (code) return `HLS stream failed with HTTP ${code} (${details}).`;
  return `HLS playback failed (${details}).`;
}

export default function VideoPlayer({
  src,
  title = 'JaSH ViBeS',
  poster = '',
  inline = true,
  startTime = 0,
  preferredAudioLang = '',
  qualityOptions = [],
  qualityIndex = 0,
  onQualityChange,
  onBackClick,
  onProgress,
  onError,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const hideTimerRef = useRef(null);
  const startTimeRef = useRef(startTime);
  const playbackRateRef = useRef(1);
  const didSeekRef = useRef(false);
  const retryRef = useRef({ media: 0, network: 0 });
  const externalSubRef = useRef(null);

  startTimeRef.current = startTime;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [audioTracks, setAudioTracks] = useState([]);
  const [currentAudioTrackId, setCurrentAudioTrackId] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [currentSubtitleId, setCurrentSubtitleId] = useState(-1);
  const [settingsPanel, setSettingsPanel] = useState(null);
  const [externalSubUrl, setExternalSubUrl] = useState('');
  const [localError, setLocalError] = useState('');

  const progressPct = useMemo(() => {
    if (!duration) return 0;
    return Math.max(0, Math.min(100, (currentTime / duration) * 100));
  }, [currentTime, duration]);

  const externalQualityOptions = useMemo(() => {
    return (qualityOptions || [])
      .map((option, index) => ({
        index,
        label: String(option?.label || option?.title || `Stream ${index + 1}`).trim(),
        value: option?.value ?? index,
      }))
      .filter((option) => option.label);
  }, [qualityOptions]);
  const selectedExternalQuality = externalQualityOptions[qualityIndex]?.label || '';
  const hlsQualityLabel = currentLevel >= 0 && levels[currentLevel]?.height ? `${levels[currentLevel].height}p` : 'Quality';
  const qualityButtonLabel = selectedExternalQuality || hlsQualityLabel;

  const reportError = useCallback((message, extra = {}) => {
    setLocalError(message || 'Video playback failed.');
    setIsBuffering(false);
    setReconnecting(false);
    onError?.(message || 'Video playback failed.', extra);
  }, [onError]);

  const bumpControls = useCallback((visible = true) => {
    setShowControls(visible);
    clearTimeout(hideTimerRef.current);
    if (visible) {
      hideTimerRef.current = setTimeout(() => {
        const video = videoRef.current;
        if (video && !video.paused) setShowControls(false);
      }, 3200);
    }
  }, []);

  const tryAutoplay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {
        video.muted = true;
        setIsMuted(true);
        video.play().catch(() => {});
      });
    }
  }, []);

  const syncNativeTracks = useCallback(() => {
    const video = videoRef.current;
    if (!video?.textTracks) return;
    const tracks = Array.from(video.textTracks).map((track, index) => ({
      id: index,
      name: track.label || track.language || `Subtitle ${index + 1}`,
      lang: track.language || '',
    }));
    setSubtitleTracks(tracks);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;

    setIsBuffering(true);
    setReconnecting(false);
    setLocalError('');
    setCurrentTime(0);
    setDuration(0);
    setLevels([]);
    setCurrentLevel(-1);
    setAudioTracks([]);
    setCurrentAudioTrackId(-1);
    setSubtitleTracks([]);
    setCurrentSubtitleId(-1);
    setSettingsPanel(null);
    didSeekRef.current = false;
    retryRef.current = { media: 0, network: 0 };

    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
      hlsRef.current = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();

    const hlsSource = isHlsUrl(src);
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') || video.canPlayType('application/x-mpegURL');

    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      video.playbackRate = playbackRateRef.current;
      const seekTo = startTimeRef.current;
      if (seekTo > 1 && !didSeekRef.current && Number.isFinite(video.duration) && seekTo < video.duration - 5) {
        try { video.currentTime = seekTo; } catch {}
      }
      didSeekRef.current = true;
      syncNativeTracks();
      setIsBuffering(false);
      tryAutoplay();
    };

    const onNativeError = () => {
      reportError('Native video playback failed. Try another server.', { src, native: true });
    };

    if (hlsSource && Hls.isSupported()) {
      const query = src.includes('?') ? src.slice(src.indexOf('?') + 1) : '';
      const smallScreen = typeof window !== 'undefined' && (
        Math.min(window.innerWidth, window.innerHeight) <= 820 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      );
      const connection = typeof navigator !== 'undefined' ? navigator.connection || {} : {};
      const remembered = Number(typeof localStorage !== 'undefined' ? localStorage.getItem(BW_KEY) : 0) || 0;
      const estimate = remembered > 300_000
        ? remembered
        : (connection.downlink ? Math.max(500_000, connection.downlink * 1_000_000 * 0.7) : (smallScreen ? 900_000 : 3_000_000));

      const config = {
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: startTimeRef.current > 1 ? startTimeRef.current : -1,
        startFragPrefetch: true,
        testBandwidth: true,
        startLevel: -1,
        abrEwmaDefaultEstimate: estimate,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.6,
        capLevelOnFPSDrop: true,
        maxBufferLength: smallScreen ? 20 : 40,
        maxMaxBufferLength: smallScreen ? 90 : 600,
        maxBufferSize: (smallScreen ? 24 : 60) * 1000 * 1000,
        backBufferLength: smallScreen ? 30 : 90,
        manifestLoadingMaxRetry: 3,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 500,
        fragLoadingMaxRetryTimeout: 8000,
      };

      if (query) {
        const BaseLoader = Hls.DefaultConfig.loader;
        config.loader = class TokenLoader extends BaseLoader {
          load(context, cfg, callbacks) {
            if (context?.url && !context.url.includes('?')) context.url += `?${query}`;
            super.load(context, cfg, callbacks);
          }
        };
      }

      const hls = new Hls(config);
      hlsRef.current = hls;

      const syncHlsTracks = () => {
        setLevels(hls.levels || []);
        setAudioTracks(hls.audioTracks || []);
        setCurrentAudioTrackId(hls.audioTrack);
        setSubtitleTracks(hls.subtitleTracks || []);
        setCurrentSubtitleId(hls.subtitleTrack ?? -1);
      };

      const applyPreferredAudio = () => {
        const tracks = hls.audioTracks || [];
        if (!tracks.length) return;
        let pref = preferredAudioLang;
        try { pref = localStorage.getItem(AUDIO_PREF_KEY) || pref; } catch {}
        const index = tracks.findIndex((track) => audioMatchesPreference(track, pref));
        if (index >= 0) {
          hls.audioTrack = index;
          setCurrentAudioTrackId(index);
        }
      };

      hls.loadSource(src);
      hls.attachMedia(video);
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('error', onNativeError);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        syncHlsTracks();
        applyPreferredAudio();
        if (smallScreen) {
          const cap = (hls.levels || []).reduce((best, level, index) => (
            level.height && level.height <= 720 && (best < 0 || level.height > hls.levels[best].height) ? index : best
          ), -1);
          if (cap >= 0) hls.autoLevelCapping = cap;
        }
        setIsBuffering(false);
        tryAutoplay();
      });
      hls.on(Hls.Events.LEVEL_LOADED, syncHlsTracks);
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => { syncHlsTracks(); applyPreferredAudio(); });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, syncHlsTracks);
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => setCurrentAudioTrackId(data.id));
      hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data) => setCurrentSubtitleId(data.id));
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setCurrentLevel(hls.autoLevelEnabled ? -1 : data.level));
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        retryRef.current = { media: 0, network: 0 };
        setReconnecting(false);
        if (hls.bandwidthEstimate > 0) {
          try { localStorage.setItem(BW_KEY, String(Math.round(hls.bandwidthEstimate))); } catch {}
        }
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data?.fatal) {
          if (data?.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) setIsBuffering(true);
          return;
        }

        const status = data?.response?.code;
        if ([401, 403, 404, 410].includes(status)) {
          reportError(buildHlsErrorMessage(data), { src, hls: true, data });
          try { hls.stopLoad(); } catch {}
          return;
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && retryRef.current.media < 3) {
          retryRef.current.media += 1;
          setReconnecting(true);
          try { hls.recoverMediaError(); } catch {}
          return;
        }

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryRef.current.network < 4) {
          retryRef.current.network += 1;
          setReconnecting(true);
          const at = video.currentTime || startTimeRef.current || -1;
          setTimeout(() => {
            try { hls.startLoad(at > 1 ? at : -1); } catch {}
          }, Math.min(6000, 700 * retryRef.current.network));
          return;
        }

        reportError(buildHlsErrorMessage(data), { src, hls: true, data });
      });

      const onOnline = () => {
        setReconnecting(true);
        try { hls.startLoad(video.currentTime || -1); } catch {}
      };
      const onWake = () => {
        if (document.visibilityState !== 'visible') return;
        if (video.readyState < 3) {
          setReconnecting(true);
          try { hls.startLoad(video.currentTime || -1); } catch {}
        }
        if (!video.paused) video.play().catch(() => {});
      };
      window.addEventListener('online', onOnline);
      document.addEventListener('visibilitychange', onWake);
      window.addEventListener('pageshow', onWake);

      return () => {
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onWake);
        window.removeEventListener('pageshow', onWake);
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('error', onNativeError);
        try { hls.destroy(); } catch {}
        hlsRef.current = null;
        setReconnecting(false);
      };
    }

    // MP4/direct and native-HLS/Safari path: use the browser's <video> engine.
    video.preload = 'auto';
    video.src = hlsSource && nativeHls ? withStartFragment(src, startTimeRef.current) : src;
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onNativeError);
    video.load();

    const onOnline = () => {
      const at = video.currentTime || startTimeRef.current || 0;
      setReconnecting(true);
      video.src = hlsSource ? withStartFragment(src, at) : src;
      video.load();
      video.play().catch(() => {});
    };
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      if (video.error || video.readyState < 2) onOnline();
      else if (!video.paused) video.play().catch(() => {});
    };
    const onNativePlaying = () => setReconnecting(false);
    video.addEventListener('playing', onNativePlaying);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('pageshow', onWake);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onNativeError);
      video.removeEventListener('playing', onNativePlaying);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('pageshow', onWake);
      setReconnecting(false);
    };
  }, [src, preferredAudioLang, reportError, syncNativeTracks, tryAutoplay]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => () => {
    clearTimeout(hideTimerRef.current);
    if (externalSubRef.current) URL.revokeObjectURL(externalSubRef.current);
    if (hlsRef.current) {
      try { hlsRef.current.destroy(); } catch {}
    }
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    bumpControls(true);
  }, [bumpControls]);

  const seekBy = useCallback((seconds) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.25, video.currentTime + seconds));
    bumpControls(true);
  }, [bumpControls]);

  const seekToClientX = useCallback((clientX) => {
    const video = videoRef.current;
    const bar = containerRef.current?.querySelector('[data-progress-bar="true"]');
    if (!video || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
    bumpControls(true);
  }, [duration, bumpControls]);

  const toggleFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (!document.fullscreenElement) {
        if (window.jashRequestFullscreen) await window.jashRequestFullscreen(element);
        else {
          await element.requestFullscreen?.();
          await window.jashLockLandscape?.();
        }
      } else {
        await document.exitFullscreen();
        try { screen?.orientation?.unlock?.(); } catch {}
      }
    } catch {}
  }, []);

  const changeLevel = (level) => {
    if (hlsRef.current) hlsRef.current.currentLevel = level;
    setCurrentLevel(level);
    setSettingsPanel(null);
  };

  const changeExternalQuality = (index) => {
    if (index === qualityIndex) {
      setSettingsPanel(null);
      return;
    }
    setIsBuffering(true);
    setLocalError('');
    onQualityChange?.(index, externalQualityOptions[index]);
    setSettingsPanel(null);
  };

  const changeAudio = (index) => {
    if (hlsRef.current) hlsRef.current.audioTrack = index;
    setCurrentAudioTrackId(index);
    try { localStorage.setItem(AUDIO_PREF_KEY, audioTracks[index]?.lang || audioTracks[index]?.name || ''); } catch {}
    setSettingsPanel(null);
  };

  const changeSubtitles = (index) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = index;
      hlsRef.current.subtitleDisplay = index !== -1;
    }
    const tracks = videoRef.current?.textTracks || [];
    for (let i = 0; i < tracks.length; i += 1) {
      tracks[i].mode = (index === 999 && i === tracks.length - 1) || (index !== -1 && index !== 999 && i === index) ? 'showing' : 'disabled';
    }
    setCurrentSubtitleId(index);
    setSettingsPanel(null);
  };

  const changeSpeed = (rate) => {
    playbackRateRef.current = rate;
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setSettingsPanel(null);
  };

  const handleSubtitleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const url = URL.createObjectURL(new Blob([toVtt(text)], { type: 'text/vtt' }));
      if (externalSubRef.current) URL.revokeObjectURL(externalSubRef.current);
      externalSubRef.current = url;
      setExternalSubUrl(url);
      setTimeout(() => changeSubtitles(999), 100);
    } catch {}
    event.target.value = '';
  };

  const controlsButton = 'rounded-xl border border-white/10 bg-white/10 px-2 py-1.5 text-[11px] font-bold text-white transition hover:bg-white/20 active:scale-95 sm:px-3 sm:py-2 sm:text-sm';
  const panelButton = 'flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-semibold transition hover:bg-white/10';

  return (
    <div
      ref={containerRef}
      className={`${inline ? 'relative h-full w-full' : 'fixed inset-0 z-[9999] h-dvh w-screen'} overflow-hidden bg-black text-white select-none`}
      onMouseMove={() => bumpControls(true)}
      onDoubleClick={toggleFullscreen}
      style={{ touchAction: 'manipulation' }}
    >
      <video
        ref={videoRef}
        poster={poster || undefined}
        className="h-full w-full bg-black object-fill"
        playsInline
        autoPlay
        onClick={togglePlay}
        onTimeUpdate={() => {
          const video = videoRef.current;
          if (!video) return;
          setCurrentTime(video.currentTime || 0);
          setDuration(Number.isFinite(video.duration) ? video.duration : duration);
          onProgress?.(video.currentTime || 0, Number.isFinite(video.duration) ? video.duration : 0);
        }}
        onLoadedMetadata={() => {
          const video = videoRef.current;
          setDuration(Number.isFinite(video?.duration) ? video.duration : 0);
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => { setIsBuffering(false); setIsPlaying(true); setReconnecting(false); }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      >
        {externalSubUrl ? <track key={externalSubUrl} kind="subtitles" src={externalSubUrl} srcLang="en" label="Uploaded" default /> : null}
      </video>

      {isBuffering && !localError ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-blue-500" />
        </div>
      ) : null}

      {reconnecting && !localError ? (
        <div className="absolute top-4 left-1/2 z-40 -translate-x-1/2 rounded-full border border-white/10 bg-black/75 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-blue-100">
          Reconnecting…
        </div>
      ) : null}

      {localError ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75 p-5 text-center">
          <div className="max-w-lg rounded-2xl border border-red-500/30 bg-red-950/30 p-5">
            <p className="text-lg font-black text-white">Video player error</p>
            <p className="mt-2 text-sm leading-6 text-red-100">{localError}</p>
          </div>
        </div>
      ) : null}

      <div className={`absolute inset-x-0 top-0 z-50 bg-gradient-to-b from-black/90 to-transparent p-3 transition duration-300 sm:p-5 ${showControls ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="flex items-center gap-3">
          {onBackClick ? (
            <button type="button" onClick={onBackClick} className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-lg font-black hover:bg-white/20">‹</button>
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-sm font-black sm:text-lg">{title || 'JaSH ViBeS'}</p>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">HLS.js / Native Video Player</p>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        {!isPlaying && !isBuffering && !localError ? (
          <div className="rounded-full border border-white/10 bg-black/45 p-6 text-4xl shadow-2xl">▶</div>
        ) : null}
      </div>

      {settingsPanel ? (
        <>
          <button type="button" aria-label="Close settings" className="absolute inset-0 z-[55] cursor-default" onClick={() => setSettingsPanel(null)} />
          <div className="absolute inset-x-2 bottom-20 z-[60] max-h-[74dvh] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:right-6 sm:w-80 sm:max-w-[80vw]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="text-sm font-black capitalize">{settingsPanel}</p>
              <button type="button" onClick={() => setSettingsPanel(null)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="max-h-[calc(74dvh-3.25rem)] overflow-y-auto py-1 overscroll-contain">
              {settingsPanel === 'quality' ? (
                externalQualityOptions.length ? (
                  <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-1">
                    {externalQualityOptions.map((option, index) => (
                      <button key={`${option.label}-${index}`} type="button" onClick={() => changeExternalQuality(index)} className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-xs font-black transition sm:text-sm ${qualityIndex === index ? 'border-blue-400/50 bg-blue-500/20 text-blue-100' : 'border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/10'}`}>
                        <span className="truncate">{option.label}</span><span className="ml-2 shrink-0">{qualityIndex === index ? '✓' : ''}</span>
                      </button>
                    ))}
                  </div>
                ) : levels.length ? (
                  <>
                    <button type="button" onClick={() => changeLevel(-1)} className={`${panelButton} ${currentLevel === -1 ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                      <span>Auto</span><span>{currentLevel === -1 ? '✓' : ''}</span>
                    </button>
                    {levels.map((level, index) => (
                      <button key={`${level.height}-${index}`} type="button" onClick={() => changeLevel(index)} className={`${panelButton} ${currentLevel === index ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                        <span>{level.height ? `${level.height}p` : `Level ${index + 1}`}</span><span>{currentLevel === index ? '✓' : ''}</span>
                      </button>
                    ))}
                  </>
                ) : <p className="px-4 py-4 text-sm text-zinc-500">No quality options found.</p>
              ) : null}

              {settingsPanel === 'audio' ? (
                audioTracks.length ? audioTracks.map((track, index) => (
                  <button key={`${track.id ?? index}-${track.name || track.lang || index}`} type="button" onClick={() => changeAudio(index)} className={`${panelButton} ${currentAudioTrackId === index ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                    <span>{getLanguageName(track, index)}</span><span>{currentAudioTrackId === index ? '✓' : ''}</span>
                  </button>
                )) : <p className="px-4 py-4 text-sm text-zinc-500">No alternate audio tracks found.</p>
              ) : null}

              {settingsPanel === 'subtitles' ? (
                <>
                  <button type="button" onClick={() => changeSubtitles(-1)} className={`${panelButton} ${currentSubtitleId === -1 ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                    <span>Off</span><span>{currentSubtitleId === -1 ? '✓' : ''}</span>
                  </button>
                  {subtitleTracks.map((track, index) => (
                    <button key={`${track.id ?? index}-${track.name || track.lang || index}`} type="button" onClick={() => changeSubtitles(index)} className={`${panelButton} ${currentSubtitleId === index ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                      <span>{getLanguageName(track, index)}</span><span>{currentSubtitleId === index ? '✓' : ''}</span>
                    </button>
                  ))}
                  {externalSubUrl ? (
                    <button type="button" onClick={() => changeSubtitles(999)} className={`${panelButton} ${currentSubtitleId === 999 ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                      <span>Uploaded subtitle</span><span>{currentSubtitleId === 999 ? '✓' : ''}</span>
                    </button>
                  ) : null}
                  <label className="mx-3 my-2 block cursor-pointer rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs font-bold text-zinc-300 hover:border-blue-400 hover:text-white">
                    Upload .srt / .vtt
                    <input type="file" accept=".srt,.vtt,text/vtt,application/x-subrip" className="hidden" onChange={handleSubtitleUpload} />
                  </label>
                </>
              ) : null}

              {settingsPanel === 'speed' ? [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button key={rate} type="button" onClick={() => changeSpeed(rate)} className={`${panelButton} ${playbackRate === rate ? 'bg-blue-500/15 text-blue-300' : 'text-zinc-100'}`}>
                  <span>{rate === 1 ? 'Normal' : `${rate}x`}</span><span>{playbackRate === rate ? '✓' : ''}</span>
                </button>
              )) : null}
            </div>
          </div>
        </>
      ) : null}

      <div className={`absolute inset-x-0 bottom-0 z-50 bg-gradient-to-t from-black via-black/85 to-transparent p-2 transition duration-300 sm:p-5 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
        <div className="mb-2 flex justify-between px-1 text-[11px] font-bold text-white/70">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div
          data-progress-bar="true"
          className="group mb-3 cursor-pointer py-2"
          onClick={(event) => seekToClientX(event.clientX)}
          onTouchEnd={(event) => {
            const touch = event.changedTouches?.[0];
            if (touch) seekToClientX(touch.clientX);
          }}
        >
          <div className="h-1 rounded-full bg-white/25 transition-all group-hover:h-1.5">
            <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 sm:gap-3">
            <button type="button" onClick={() => seekBy(-10)} className={`${controlsButton} hidden sm:inline-flex`}>↺10</button>
            <button type="button" onClick={togglePlay} className="rounded-full bg-white px-3 py-1.5 text-base font-black text-black transition hover:scale-105 active:scale-95 sm:px-4 sm:py-2 sm:text-lg">
              {isPlaying ? '❚❚' : '▶'}
            </button>
            <button type="button" onClick={() => seekBy(10)} className={`${controlsButton} hidden sm:inline-flex`}>10↻</button>
            <button type="button" onClick={() => setIsMuted((value) => !value)} className={controlsButton}>{isMuted || volume === 0 ? '🔇' : '🔊'}</button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(event) => { setVolume(Number(event.target.value)); setIsMuted(false); }}
              className="hidden w-20 accent-blue-500 sm:block"
            />
          </div>

          <div className="flex max-w-full items-center gap-1 overflow-x-auto sm:gap-2">
            <button type="button" onClick={() => setSettingsPanel('speed')} className={controlsButton}>{playbackRate === 1 ? '1x' : `${playbackRate}x`}</button>
            <button type="button" onClick={() => setSettingsPanel('subtitles')} className={`${controlsButton} ${currentSubtitleId !== -1 ? 'text-blue-200' : ''}`}>CC</button>
            <button type="button" onClick={() => setSettingsPanel('audio')} className={controlsButton}>Audio</button>
            <button type="button" onClick={() => setSettingsPanel('quality')} className={`${controlsButton} max-w-[6rem] truncate sm:max-w-[9rem]`}>{qualityButtonLabel}</button>
            <button type="button" onClick={toggleFullscreen} className={controlsButton}>⛶</button>
          </div>
        </div>
      </div>
    </div>
  );
}
