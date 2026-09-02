'use client';

/**
 * DirectWatchPlayer — custom cinematic player for direct HTTPS/Telegram file
 * streams (Stremio direct files, mirchi direct files). Wraps the <video>
 * element owned by the watch page (children) and renders an overlay UI:
 *   • branded control bar (gradient scrubber + buffered bar + hover tooltip)
 *   • double-tap seek zones, hold-for-2x, tap-toggle gestures (mobile)
 *   • keyboard shortcuts, PiP, fullscreen + landscape lock, wake-lock
 *   • ambient theater dim behind the player while playing
 *   • resume toast with Restart, next-episode pill, CC menu when tracks exist
 *   • auto-fallback hook: asks the parent to rotate sources on fatal stall
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHistoryEntry } from '@/lib/watchStore';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const FALLBACK_STALL_MS = 8000;

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function Icon({ d, className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  back10: 'M12 5V1L7 6l5 5V7c3.3 0 6 2.7 6 6s-2.7 6-6 6-6-2.7-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  fwd10: 'M12 5V1l5 5-5 5V7c-3.3 0-6 2.7-6 6s2.7 6 6 6 6-2.7 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z',
  vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12z',
  mute: 'M3 9v6h4l5 5V4L7 9H3zm14.1 3 2.5-2.5-1.4-1.4-2.5 2.5-2.5-2.5-1.4 1.4 2.5 2.5-2.5 2.5 1.4 1.4 2.5-2.5 2.5 2.5 1.4-1.4-2.5-2.5z',
  fs: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  fsExit: 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z',
  pip: 'M19 7h-8v6h8V7zm2-4H3C1.9 3 1 3.9 1 5v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z',
  bulb: 'M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm2 18a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-1h4v1z',
  cc: 'M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z',
  next: 'M6 18l8.5-6L6 6v12zm2 0V6l0 12zm1.5 0 0-12 0 12zM16 6h2v12h-2z',
  list: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z',
};

export default function DirectWatchPlayer({
  children,
  videoEl,
  watchKey,
  title,
  sources = [],
  activeSource = 0,
  onPickSource,
  onAutoFallback,
  nextEpisode,
  onError: onErrorProp,
  live = false,
  liveLabel = 'LIVE',
  onPrev,
  onNext,
}) {
  const wrapRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(() => Number(loadPref('jb-watch-vol', '1')) || 1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(() => Number(loadPref('jb-watch-speed', '1')) || 1);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState(null); // 'speed' | 'source' | 'cc'
  const [buffering, setBuffering] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [ambient, setAmbient] = useState(() => loadPref('jb-watch-ambient', 'on') === 'on');
  const [resumeToast, setResumeToast] = useState(null);
  const [flash, setFlash] = useState(null); // {id, kind:'play'|'pause'|'fwd'|'back', amount}
  const [hold2x, setHold2x] = useState(false);
  const [tooltip, setTooltip] = useState(null); // {x, seconds}
  const [ccTracks, setCcTracks] = useState([]);
  const [scrubbing, setScrubbing] = useState(null); // number | null

  // Seekable-window: Stremio providers can serve live-style manifests where
  // video.duration is Infinity — seeking via pct*duration mis-targets and the
  // stream restarts from 0. All seek math goes through video.seekable instead.
  const seekWindow = useCallback(() => {
    const v = videoEl;
    if (!v) return null;
    try {
      const sk = v.seekable;
      if (sk && sk.length) {
        const start = sk.start(0);
        const end = sk.end(sk.length - 1);
        if (end > start) return { start, end };
      }
    } catch {}
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    return d > 0 ? { start: 0, end: d } : null;
  }, [videoEl]);

  const hideTimerRef = useRef(0);
  const tapRef = useRef({ lastUp: 0, lastZone: '', pendingTimer: 0 });
  const holdRef = useRef({ timer: 0, active: false, prevRate: 1 });
  const stallTimerRef = useRef(0);
  const fallbackFiredRef = useRef(false);
  const autoplayMutedRef = useRef(false);
  const resumeShownRef = useRef(false);
  const wakeLockRef = useRef(null);
  const flashTimerRef = useRef(0);

  const pictInPictSupported = useMemo(() => typeof document !== 'undefined' && !!document.pictureInPictureEnabled, []);

  // ---------- controls visibility ----------
  const wake = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    // never auto-hide while paused, mid-scrub/hold, or while a menu is open
    if (!playing || menu || scrubbing !== null || hold2x) {
      setVisible(true);
      window.clearTimeout(hideTimerRef.current);
      return;
    }
    wake();
    return () => window.clearTimeout(hideTimerRef.current);
  }, [playing, menu, scrubbing, hold2x, wake]);

  // ---------- bind to the video element ----------
  useEffect(() => {
    if (!videoEl) return undefined;
    const v = videoEl;
    fallbackFiredRef.current = false;
    resumeShownRef.current = false;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTimeUpdate = () => { if (!scrubbing) setTime(v.currentTime || 0); };
    const onDur = () => setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    const onProgress = () => {
      try {
        const b = v.buffered;
        if (b.length) setBufferedEnd(b.end(b.length - 1));
      } catch {}
    };
    const onVolume = () => { setVolume(v.volume); setMuted(v.muted); };
    const onRate = () => setRate(v.playbackRate);
    const onWaiting = () => setBuffering(true);
    const onCanPlay = () => { setBuffering(false); window.clearTimeout(stallTimerRef.current); };
    const onStalled = () => {
      if (v.paused) return;
      window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = window.setTimeout(() => {
        fireFallback('stall');
      }, FALLBACK_STALL_MS / 2);
    };
    const fireFallback = (why) => {
      if (fallbackFiredRef.current) return;
      fallbackFiredRef.current = true;
      onAutoFallback?.(why);
    };
    const onError = () => {
      if (!v.error) return;
      onErrorProp?.(v.error?.message || (v.error?.code ? `Media error ${v.error.code}` : 'Playback error'));
      fireFallback('error');
    };
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);

    // ---------- autoplay boot with unmuted preference ----------
    autoplayMutedRef.current = false;
    const initialVol = Number(loadPref('jb-watch-vol', '1'));
    if (Number.isFinite(initialVol) && initialVol > 0) {
      v.volume = Math.min(1, initialVol);
    }
    v.muted = false;

    if (v.autoplay) {
      const playPromise = v.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          // If browser policy strictly blocked unmuted autoplay (NotAllowedError),
          // fallback to muted playback and unmute on first user tap/interaction.
          if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
            autoplayMutedRef.current = true;
            v.muted = true;
            v.play().catch(() => {});
          }
        });
      }

      const onFirstPlaying = () => {
        v.removeEventListener('playing', onFirstPlaying);
        if (!autoplayMutedRef.current) return;
        try {
          const pv = Number(window.localStorage.getItem('jb-watch-vol') || window.localStorage.getItem('jash-live-volume') || '1');
          if (Number.isFinite(pv) && pv > 0) v.volume = Math.min(1, pv);
        } catch {}
        v.muted = false;
        autoplayMutedRef.current = false;
        setMuted(false);
      };
      v.addEventListener('playing', onFirstPlaying);
    }

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('durationchange', onDur);
    v.addEventListener('progress', onProgress);
    v.addEventListener('volumechange', onVolume);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('seeking', onWaiting);
    v.addEventListener('seeked', onCanPlay);
    v.addEventListener('canplay', onCanPlay);
    v.addEventListener('playing', onCanPlay);
    v.addEventListener('stalled', onStalled);
    v.addEventListener('error', onError);
    v.addEventListener('enterpictureinpicture', onEnterPip);
    v.addEventListener('leavepictureinpicture', onLeavePip);

    // restore prefs
    try {
      const pRate = Number(loadPref('jb-watch-speed', '1'));
      if (pRate && pRate !== 1) v.playbackRate = pRate;
      const pVol = Number(loadPref('jb-watch-vol', '1'));
      if (pVol >= 0 && pVol <= 1) v.volume = pVol;
    } catch {}

    setPipSupported(pictInPictSupported);
    setPlaying(!v.paused);
    setDuration(Number.isFinite(v.duration) ? v.duration : 0);
    setTime(v.currentTime || 0);

    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('durationchange', onDur);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('volumechange', onVolume);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('seeking', onWaiting);
      v.removeEventListener('seeked', onCanPlay);
      v.removeEventListener('canplay', onCanPlay);
      v.removeEventListener('playing', onCanPlay);
      v.removeEventListener('stalled', onStalled);
      v.removeEventListener('error', onError);
      v.removeEventListener('enterpictureinpicture', onEnterPip);
      v.removeEventListener('leavepictureinpicture', onLeavePip);
      window.clearTimeout(stallTimerRef.current);
    };
  }, [videoEl, onAutoFallback, onErrorProp, pictInPictSupported, scrubbing]);

  // resume toast (after playback actually starts)
  useEffect(() => {
    if (!videoEl || !playing || resumeShownRef.current) return;
    resumeShownRef.current = true;
    const saved = getHistoryEntry(watchKey);
    if (saved?.progress > 20) {
      setResumeToast({ seconds: saved.progress });
      const t = setTimeout(() => setResumeToast(null), 7000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [videoEl, playing, watchKey]);

  // ---------- subtitle tracks ----------
  useEffect(() => {
    if (!videoEl) return undefined;
    const v = videoEl;
    const scan = () => {
      const tracks = Array.from(v.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
      setCcTracks(tracks.map((t, i) => ({ index: i, label: t.label || t.language || `Track ${i + 1}`, mode: t.mode })));
    };
    scan();
    const tt = v.textTracks;
    tt?.addEventListener?.('addtrack', scan);
    tt?.addEventListener?.('removetrack', scan);
    return () => {
      tt?.removeEventListener?.('addtrack', scan);
      tt?.removeEventListener?.('removetrack', scan);
    };
  }, [videoEl]);

  // ---------- fullscreen state ----------
  useEffect(() => {
    const onFs = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (active && /android|iphone|ipad/i.test(navigator.userAgent)) {
        try { window.screen.orientation?.lock?.('landscape').catch(() => {}); } catch {}
      } else {
        try { window.screen.orientation?.unlock?.(); } catch {}
      }
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // ---------- wake lock ----------
  useEffect(() => {
    let cancelled = false;
    const acquire = async () => {
      if (!('wakeLock' in navigator) || !playing) return;
      try { if (!wakeLockRef.current && !cancelled) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch {}
    };
    const release = () => { try { wakeLockRef.current?.release?.(); } catch {} wakeLockRef.current = null; };
    const onVis = () => { if (document.visibilityState === 'visible') acquire(); };
    if (playing) acquire(); else release();
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; release(); document.removeEventListener('visibilitychange', onVis); };
  }, [playing]);

  // ---------- actions ----------
  const togglePlay = useCallback(() => {
    const v = videoEl;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); }
    else v.pause();
    setFlash({ id: Date.now(), kind: v.paused ? 'play' : 'pause' });
    window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 600);
  }, [videoEl]);

  const seekAllowedNow = useCallback(() => {
    const w = seekWindow();
    return Boolean(w && Number.isFinite(w.end) && w.end - w.start > 0 && (!live || w.end - w.start > 120));
  }, [seekWindow, live]);

  const seekBy = useCallback((delta) => {
    const v = videoEl;
    const win = seekWindow();
    if (!v || !win || (live && win.end - win.start <= 120)) return;
    v.currentTime = Math.min(Math.max(win.start, v.currentTime + delta), Math.max(win.start, win.end - 0.25));
  }, [videoEl, seekWindow, live]);

  const tapSeek = useCallback((side) => {
    if (!seekAllowedNow()) return;
    // accumulate repeated double-taps for the on-screen counter
    setFlash((prev) => {
      const same = prev && prev.kind === (side === 'right' ? 'fwd' : 'back') && Date.now() - prev.id < 1200;
      const amt = (same ? prev.amount : 0) + 10;
      const id = same ? prev.id : Date.now();
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlash(null), 900);
      return { id, kind: side === 'right' ? 'fwd' : 'back', amount: amt };
    });
    seekBy(side === 'right' ? 10 : -10);
  }, [seekBy, seekAllowedNow]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }, []);

  const togglePiP = useCallback(async () => {
    const v = videoEl;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {}
  }, [videoEl]);

  const changeRate = useCallback((r) => {
    const v = videoEl;
    if (!v) return;
    v.playbackRate = r;
    savePref('jb-watch-speed', String(r));
    setMenu(null);
  }, [videoEl]);

  const setVol = useCallback((nv) => {
    const v = videoEl;
    if (!v) return;
    v.volume = Math.min(1, Math.max(0, nv));
    v.muted = false;
    savePref('jb-watch-vol', String(v.volume));
  }, [videoEl]);

  const setTrackMode = useCallback((index) => {
    const v = videoEl;
    if (!v) return;
    const tracks = Array.from(v.textTracks || []).filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
    tracks.forEach((t, i) => { t.mode = i === index ? 'showing' : 'disabled'; });
    setCcTracks(tracks.map((t, i) => ({ index: i, label: t.label || t.language || `Track ${i + 1}`, mode: t.mode })));
    setMenu(null);
  }, [videoEl]);

  const restart = useCallback(() => {
    const v = videoEl;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
    setResumeToast(null);
  }, [videoEl]);

  const toggleAmbient = useCallback(() => {
    setAmbient((prev) => { savePref('jb-watch-ambient', prev ? 'off' : 'on'); return !prev; });
  }, []);

  // ---------- scrub bar ----------
  const trackRef = useRef(null);
  const ratioFromEvent = (clientX) => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const onTrackDown = (event) => {
    const win = seekWindow();
    if (!win) return;
    const ratio = ratioFromEvent(event.clientX);
    setScrubbing(win.start + ratio * (win.end - win.start));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onTrackMove = (event) => {
    if (scrubbing !== null) {
      const win = seekWindow();
      if (!win) return;
      const ratio = ratioFromEvent(event.clientX);
      setScrubbing(win.start + ratio * (win.end - win.start));
    }
  };
  const onTrackHover = (event) => {
    const win = seekWindow();
    if (!win) return;
    const el = trackRef.current;
    const rect = el.getBoundingClientRect();
    setTooltip({ x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)), seconds: ratioFromEvent(event.clientX) * (win.end - win.start) });
  };
  const onTrackUp = () => {
    if (scrubbing === null) return;
    if (videoEl) videoEl.currentTime = scrubbing;
    setScrubbing(null);
  };

  // ---------- gestures on the touch layer ----------
  const onLayerPointerDown = (event) => {
    wake();
    // touch: restore sound if we force-muted it for autoplay
    if (autoplayMutedRef.current && videoEl && !videoEl.paused) {
      try { videoEl.muted = false; } catch {}
      autoplayMutedRef.current = false;
    }
    if (event.pointerType === 'mouse') return; // desktop uses clicks
    const zone = (() => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      return x < rect.width * 0.3 ? 'left' : x > rect.width * 0.7 ? 'right' : 'middle';
    })();
    holdRef.current = { timer: window.setTimeout(() => {
      holdRef.current.active = true;
      if (videoEl) { holdRef.current.prevRate = videoEl.playbackRate; videoEl.playbackRate = 2; setHold2x(true); }
    }, 380), active: false, prevRate: 1 };

    tapRef.current.lastZone = zone;
  };
  const onLayerPointerUp = (event) => {
    if (event.pointerType === 'mouse') return;
    window.clearTimeout(holdRef.current.timer);
    if (holdRef.current.active && videoEl) {
      holdRef.current.active = false;
      videoEl.playbackRate = holdRef.current.prevRate || 1;
      setHold2x(false);
      return;
    }
    const zone = tapRef.current.lastZone;
    const now = Date.now();
    const isDouble = now - tapRef.current.lastUp < 280;
    tapRef.current.lastUp = now;
    if (isDouble) {
      window.clearTimeout(tapRef.current.pendingTimer);
      if (zone === 'left') tapSeek('left');
      else if (zone === 'right') tapSeek('right');
      else togglePlay();
    } else {
      // Touch: single taps only SHOW/refresh the controls — they never hide
      // them (toggle-off felt like the UI vanishing under the user's finger).
      // Hiding happens via the idle timer; desktop keeps click-toggle.
      tapRef.current.pendingTimer = window.setTimeout(() => {
        wake();
      }, 280);
    }
  };
  const onLayerClick = () => { /* desktop: click shows/hides */ if (matchMedia('(pointer:fine)').matches) setVisible((p) => !p); };
  const onLayerDoubleClick = () => { if (matchMedia('(pointer:fine)').matches) toggleFullscreen(); };

  // ---------- keyboard ----------
  const onKeyDown = (event) => {
    const k = event.key.toLowerCase();
    const v = videoEl;
    if (!v) return;
    const handled = [' ', 'k', 'j', 'l', 'f', 'm', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k);
    if (!handled) return;
    event.preventDefault();
    wake();
    if (k === ' ' || k === 'k') togglePlay();
    else if (k === 'arrowleft' || k === 'j') seekBy(-10);
    else if (k === 'arrowright' || k === 'l') seekBy(10);
    else if (k === 'f') toggleFullscreen();
    else if (k === 'm') { v.muted = !v.muted; }
    else if (k === 'arrowup') setVol((v.volume || 0) + 0.1);
    else if (k === 'arrowdown') setVol((v.volume || 0) - 0.1);
  };

  const shownTime = scrubbing !== null ? scrubbing : time;
  const win = seekWindow();
  const winLength = win ? win.end - win.start : 0;
  const winFinite = Number.isFinite(winLength) && winLength > 0;
  // Seeking is available for VOD (finite window) and for LIVE streams only
  // when a usable DVR/timeshift window exists (> 120s of seekable range).
  const canSeek = Boolean(win && winFinite && Number.isFinite(win.end) && (!live || winLength > 120));
  const playedRatio = canSeek && winLength > 0 ? Math.min(1, Math.max(0, (shownTime - win.start) / winLength)) : 0;
  const bufferedRatio = canSeek && winLength > 0 ? Math.min(1, Math.max(0, (bufferedEnd - win.start) / winLength)) : 0;
  const remainingForNext = !live && winFinite && nextEpisode && playing && win.end - time <= 60;

  const ambientActive = ambient && playing && !isFullscreen;

  return (
    <div
      ref={wrapRef}
      data-dvp="root"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={`group/player absolute inset-0 h-full w-full outline-none jv-native-cursor ${ambientActive ? 'z-[60]' : ''} fullscreen:fixed fullscreen:z-[9999]`}
      onMouseMove={wake}
    >
      {children}

      {/* gesture layer */}
      <div
        data-dvp="gestures"
        className="absolute inset-0 z-10 touch-none select-none"
        onPointerDown={onLayerPointerDown}
        onPointerUp={onLayerPointerUp}
        onClick={onLayerClick}
        onDoubleClick={onLayerDoubleClick}
      />

      {/* buffering spinner */}
      {buffering ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-[3px] border-white/15 border-t-fuchsia-400 drop-shadow-[0_0_18px_rgba(217,70,239,0.55)]" />
        </div>
      ) : null}

      {/* center flash (play/pause) */}
      {flash && (flash.kind === 'play' || flash.kind === 'pause') ? (
        <div key={`c-${flash.id}`} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex h-20 w-20 animate-[dvpflash_0.6s_ease-out_forwards] items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
            <Icon d={flash.kind === 'play' ? PATHS.play : PATHS.pause} className="h-9 w-9 text-white" />
          </div>
        </div>
      ) : null}

      {/* seek flashes — center pulse, same style as play/pause */}
      {flash && (flash.kind === 'fwd' || flash.kind === 'back') ? (
        <div key={`s-${flash.kind}-${flash.id}`} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex flex-col items-center gap-1 rounded-full bg-black/60 px-7 py-5 backdrop-blur-sm animate-[dvpflash_0.6s_ease-out_forwards]">
            <Icon d={flash.kind === 'fwd' ? PATHS.fwd10 : PATHS.back10} className="h-9 w-9 text-fuchsia-300" />
            <span className="text-sm font-black text-white">{flash.kind === 'fwd' ? '+' : '-'}{flash.amount || 10}s</span>
          </div>
        </div>
      ) : null}

      {/* hold-speed badge */}
      {hold2x ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-full border border-fuchsia-400/40 bg-black/70 px-3.5 py-1.5 text-xs font-black uppercase tracking-widest text-fuchsia-200 backdrop-blur">
          2× Speed
        </div>
      ) : null}

      {/* resume toast */}
      {resumeToast ? (
        <div className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-fuchsia-400/30 bg-black/80 px-4 py-2.5 shadow-[0_12px_44px_rgba(0,0,0,0.6)] backdrop-blur">
          <p className="text-xs font-bold text-white sm:text-sm">
            Resumed from <span className="font-black text-fuchsia-300">{fmtTime(resumeToast.seconds)}</span>
          </p>
          <button onClick={restart} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white transition hover:border-fuchsia-400/50 hover:text-fuchsia-200">
            Restart
          </button>
        </div>
      ) : null}

      {/* top gradient + title */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-4 pt-3 pb-10 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="max-w-full truncate text-[13px] font-bold text-white drop-shadow sm:text-sm">
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-gradient-to-r from-fuchsia-400 to-amber-300 shadow-[0_0_10px_rgba(217,70,239,0.9)]" />
          {title || 'Now Playing'}
        </p>
      </div>

      {/* next-episode pill */}
      {remainingForNext ? (
        <button
          onClick={nextEpisode.onPlay}
          className="absolute bottom-24 right-4 z-30 flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-black/85 px-4 py-2 text-xs font-black text-white shadow-[0_0_28px_rgba(217,70,239,0.35)] backdrop-blur transition hover:scale-[1.03] hover:border-amber-300/60 sm:text-sm"
        >
          Next {nextEpisode.label}
          <Icon d={PATHS.next} className="h-4 w-4 text-amber-300" />
        </button>
      ) : null}

      {/* control bar */}
      <div
        data-dvp="controls"
        onPointerDown={wake}
        className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/92 via-black/55 to-transparent px-3 pb-2.5 pt-12 transition-opacity duration-300 ${visible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      >
        {/* scrubber (VOD / DVR live) or plain LIVE badge (live without window) */}
        {canSeek ? (
          <div
            ref={trackRef}
            className="group/track relative -my-2 cursor-pointer py-2"
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onMouseMove={onTrackHover}
            onMouseLeave={() => setTooltip(null)}
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/track:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferedRatio * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-fuchsia-500 via-fuchsia-400 to-amber-300" style={{ width: `${playedRatio * 100}%` }} />
            </div>
            <div
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white opacity-0 shadow-[0_0_14px_rgba(217,70,239,0.9)] transition-opacity group-hover/track:opacity-100"
              style={{ left: `${playedRatio * 100}%` }}
            />
            {tooltip ? (
              <div className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md bg-black/85 px-2 py-1 text-[11px] font-bold text-white" style={{ left: tooltip.x }}>
                {fmtTime(tooltip.seconds)}
              </div>
            ) : null}
          </div>
        ) : live ? (
          <div className="flex items-center gap-2 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="text-[11px] font-black uppercase tracking-[0.22em] text-red-300">{liveLabel}</span>
          </div>
        ) : null}

        {/* buttons row */}
        <div className="mt-1.5 flex items-center gap-1 sm:gap-2">
          {onPrev ? (
            <button onClick={onPrev} aria-label="Previous channel" className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
              <Icon d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" className="h-5 w-5" />
            </button>
          ) : null}
          <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
            <Icon d={playing ? PATHS.pause : PATHS.play} className="h-6 w-6" />
          </button>
          {canSeek ? (
            <>
              <button onClick={() => tapSeek('left')} aria-label="Back 10 seconds" className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
                <Icon d={PATHS.back10} className="h-5 w-5" />
              </button>
              <button onClick={() => tapSeek('right')} aria-label="Forward 10 seconds" className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
                <Icon d={PATHS.fwd10} className="h-5 w-5" />
              </button>
            </>
          ) : null}
          {onNext ? (
            <button onClick={onNext} aria-label="Next channel" className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
              <Icon d="M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12z" className="h-5 w-5" />
            </button>
          ) : null}

          <div className="group/vol hidden items-center sm:flex">
            <button onClick={() => { if (videoEl) videoEl.muted = !videoEl.muted; }} aria-label="Mute" className="rounded-full p-2 text-white transition hover:bg-white/10">
              <Icon d={muted || volume === 0 ? PATHS.mute : PATHS.vol} className="h-5 w-5" />
            </button>
            <input
              type="range" min="0" max="1" step="0.05"
              value={muted ? 0 : volume}
              onChange={(e) => setVol(Number(e.target.value))}
              className="w-0 cursor-pointer opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100 accent-fuchsia-400"
            />
          </div>

          {!live ? (
            <span className="ml-1 text-[11px] font-bold tabular-nums text-white sm:text-xs">
              {fmtTime(shownTime - (win?.start || 0))}
              {winFinite ? <span className="text-white/70"> / {fmtTime(winLength)}</span> : null}
            </span>
          ) : null}

          <div className="flex-1" />

          {/* speed (VOD only — meaningless on live edge) */}
          {!live ? (
            <div className="relative">
              <button onClick={() => setMenu(menu === 'speed' ? null : 'speed')} className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-black text-white transition hover:border-fuchsia-400/50 hover:text-fuchsia-200">
                {rate}×
              </button>
              {menu === 'speed' ? (
                <Menu title="Speed" onClose={() => setMenu(null)}>
                  {SPEED_OPTIONS.map((r) => (
                    <MenuItem key={r} active={r === rate} onClick={() => changeRate(r)}>{r === 1 ? 'Normal' : `${r}×`}</MenuItem>
                  ))}
                </Menu>
              ) : null}
            </div>
          ) : null}

          {/* source picker */}
          {sources.length > 1 ? (
            <div className="relative">
              <button onClick={() => setMenu(menu === 'source' ? null : 'source')} aria-label="Stream sources" className="rounded-full p-2 text-white transition hover:bg-white/10">
                <Icon d={PATHS.list} className="h-5 w-5" />
              </button>
              {menu === 'source' ? (
                <Menu title="Streams" onClose={() => setMenu(null)} wide>
                  {sources.map((s, i) => (
                    <MenuItem key={`${s.url}-${i}`} active={i === activeSource} onClick={() => { onPickSource?.(i); setMenu(null); }}>
                      {s.label || `Source ${i + 1}`}
                    </MenuItem>
                  ))}
                </Menu>
              ) : null}
            </div>
          ) : null}

          {/* subtitles */}
          {ccTracks.length > 0 ? (
            <div className="relative">
              <button onClick={() => setMenu(menu === 'cc' ? null : 'cc')} aria-label="Subtitles" className={`rounded-full p-2 transition hover:bg-white/10 ${ccTracks.some((t) => t.mode === 'showing') ? 'text-fuchsia-300' : 'text-white'}`}>
                <Icon d={PATHS.cc} className="h-5 w-5" />
              </button>
              {menu === 'cc' ? (
                <Menu title="Subtitles" onClose={() => setMenu(null)}>
                  <MenuItem active={!ccTracks.some((t) => t.mode === 'showing')} onClick={() => setTrackMode(-1)}>Off</MenuItem>
                  {ccTracks.map((t) => (
                    <MenuItem key={t.index} active={t.mode === 'showing'} onClick={() => setTrackMode(t.index)}>{t.label}</MenuItem>
                  ))}
                </Menu>
              ) : null}
            </div>
          ) : null}

          {/* ambient dim toggle */}
          <button onClick={toggleAmbient} aria-label="Ambient dim" className={`rounded-full p-2 transition hover:bg-white/10 ${ambient ? 'text-amber-300' : 'text-white/70'}`}>
            <Icon d={PATHS.bulb} className="h-5 w-5" />
          </button>

          {/* PiP */}
          {pipSupported ? (
            <button onClick={togglePiP} aria-label="Picture in picture" className={`rounded-full p-2 transition hover:bg-white/10 ${pipActive ? 'text-fuchsia-300' : 'text-white'}`}>
              <Icon d={PATHS.pip} className="h-5 w-5" />
            </button>
          ) : null}

          {/* fullscreen */}
          <button onClick={toggleFullscreen} aria-label="Fullscreen" className="rounded-full p-2 text-white transition hover:bg-white/10 active:scale-95">
            <Icon d={isFullscreen ? PATHS.fsExit : PATHS.fs} className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ambient theater scrim (portal, behind player at z-40; player wrapper lifts to z-[60]) */}
      {ambientActive && typeof document !== 'undefined'
        ? createPortal(
            <div data-dvp="ambient" className="pointer-events-none fixed inset-0 z-[45] bg-black/75 backdrop-blur-[1.5px] transition-opacity duration-700" />,
            document.body,
          )
        : null}

      <style jsx global>{`
        @keyframes dvpflash {
          0% { opacity: 0.9; transform: scale(0.7); }
          100% { opacity: 0; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

function Menu({ title, onClose, children, wide = false }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={`absolute bottom-full right-0 z-50 mb-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.7)] backdrop-blur ${wide ? 'w-72' : 'w-40'}`}>
        <p className="border-b border-white/10 px-3.5 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-fuchsia-300/80">{title}</p>
        <div className="max-h-56 overflow-y-auto py-1">{children}</div>
      </div>
    </>
  );
}

function MenuItem({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-xs font-semibold transition ${
        active ? 'bg-fuchsia-500/15 text-fuchsia-200' : 'text-white/85 hover:bg-white/5 hover:text-white'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-gradient-to-r from-fuchsia-400 to-amber-300 shadow-[0_0_8px_rgba(217,70,239,0.9)]' : 'bg-zinc-700'}`} />
      <span className="truncate">{children}</span>
    </button>
  );
}
