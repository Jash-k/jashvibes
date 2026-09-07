'use client';

/**
 * JashPlayer — the one player chrome for every surface in JaSH ViBeS.
 *
 *   /watch            <JashPlayer source={{url}} library={{watchKey}} lineup={{…}} />
 *   /classics/[id]    <JashPlayer playbackPolicy={createStreamPolicy(stream)} />
 *   /live             <JashPlayer playbackPolicy={createLiveTvPolicy(ch)} compact />
 *   /stremio-watch    <JashPlayer source={{url}} library={{watchKey, entry}} />
 *   /sports/player    <JashPlayer source={{url}} policy={{live:true}} />
 *
 * It owns UI only. Media behaviour lives in usePlaybackEngine, and
 * source-specific rules (Jio tokens, ClearKeys, Pocket proxying) live in
 * lib/player/policy/*. If a page can attach a stream itself, this file is wrong.
 *
 * The page may own the <video> element (pass `children` + `videoEl`) or leave
 * it to the player (pass neither) — /live keeps its element because the
 * service panel and the resolver both reach for it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePlaybackEngine } from './usePlaybackEngine';
import { COMMANDS, commandForKey, digitSeekPercent } from '@/lib/player/commands';
import { INCIDENT_QUEUE_KEY } from '@/lib/player/prefs';
import { buildHeaderFilter, createDirectPolicy } from '@/lib/player/policy/stream';
import { fmtTime, warnForSource } from '@/lib/player/labels';
import { readSeekWindow } from '@/lib/player/kind';
import { Icon, PATHS } from './PlayerIcons';
import {
  AudioMenu,
  ContextMenu,
  QualityMenu,
  SettingsMenu,
  ShortcutList,
  SourcesMenu,
  SpeedMenu,
  SubtitlesMenu,
  TimeBubble,
} from './PlayerMenus';
import {
  CenterPulse,
  ErrorCard,
  HoldBadge,
  LiveBadge,
  LockedOverlay,
  NextEpisodePill,
  NoticeBar,
  ResumeToast,
  ScrubPreview,
  SkipButton,
  Spinner,
  StatsPanel,
  TopBar,
} from './PlayerOverlays';
import {
  useAirPlay,
  useCoarsePointer,
  useFullscreen,
  useLandscapePhone,
  useOnlineStatus,
  usePip,
  useVibrate,
  useWakeLock,
} from './usePlayerEnvironment';
import { usePlayerGestures } from './usePlayerGestures';

const HIDE_DELAY_MS = 4000;
const AUTO_ADVANCE_LEAD_SECONDS = 10;

function aspectClass(aspect) {
  if (aspect === 'fill') return 'h-full w-full';
  if (aspect === 'square') return 'aspect-square w-full';
  if (aspect === 'story') return 'max-h-full aspect-[9/16] w-full';
  return 'aspect-video w-full';
}

export function JashPlayer(props) {
  const {
    children,
    videoEl: videoElProp = null,
    source = {},
    playbackPolicy = null,
    policy = {},
    drm = null,
    http = null,
    library = {},
    lineup = {},
    display = {},
    marks = null,
    on = {},
    compact = false,
    autoPlay = true,
    className = '',
    allowNativeHls = true,
    gesturesEnabled = true,
    pipOnHide = false,
    audioOnly = Boolean(display.audioOnly),
    live: liveProp,
    liveLabel = 'LIVE',
    fallbackUrls,
    activeSource,
    onPickSource,
    nextEpisode,
    onPrev,
    onNext,
    title,
    poster,
  } = props;

  const coarse = useCoarsePointer();
  const landscapePhone = useLandscapePhone();
  const online = useOnlineStatus();

  // --------------------------------------------------------------- policy build
  const url = String(source.url || playbackPolicy?.url || '');
  const wantsLive = Boolean(policy.live ?? liveProp ?? playbackPolicy?.live);

  const headerFilter = useMemo(
    () => (http ? buildHeaderFilter({ referer: http.referer, userAgent: http.userAgent, headers: http.headers }) : null),
    [http],
  );

  const builtPolicy = useMemo(() => {
    if (playbackPolicy?.resolve) return playbackPolicy;
    const base = createDirectPolicy(url, {
      kind: source.kind && source.kind !== 'auto' ? source.kind : undefined,
      streamType: source.streamType,
      mimeType: source.mimeType,
      live: wantsLive,
      label: display.title || source.label,
      playerConfig: policy.playerConfig,
      loadTimeoutMs: policy.loadTimeoutMs,
    });
    const composedFilter = headerFilter && http?.requestFilter
      ? (type, request, ctx) => {
          headerFilter(type, request, ctx);
          http.requestFilter(type, request, ctx);
        }
      : http?.requestFilter || headerFilter;

    return {
      ...base,
      live: wantsLive,
      maxLadderMs: policy.maxLadderMs,
      needsMuxjs: policy.needsMuxjs ?? base.needsMuxjs,
      loadTimeoutMs: policy.loadTimeoutMs ?? base.loadTimeoutMs,
      playerConfig: policy.playerConfig ?? base.playerConfig,
      async resolve(arg) {
        const resolved = await base.resolve(arg);
        const nextDrm = drm?.clearKeys
          ? { clearKeys: drm.clearKeys, ...(drm.licenseServer ? { servers: { 'com.widevine.alpha': drm.licenseServer } } : {}) }
          : drm?.licenseServer
            ? { servers: { 'com.widevine.alpha': drm.licenseServer } }
            : resolved.drm;
        return {
          ...resolved,
          crossOrigin: source.crossOrigin ?? resolved.crossOrigin,
          allowNativeHls: policy.allowNativeHls ?? allowNativeHls,
          drm: nextDrm,
          hasDrm: Boolean(drm?.clearKeys && Object.keys(drm.clearKeys).length) || Boolean(drm?.licenseServer) || resolved.hasDrm,
          http: composedFilter || http?.responseFilter ? { requestFilter: composedFilter, responseFilter: http?.responseFilter } : resolved.http,
        };
      },
    };
  }, [allowNativeHls, display.title, drm, headerFilter, http, policy, playbackPolicy, source, url, wantsLive]);

  // --------------------------------------------------------------------- engine
  const sources = useMemo(
    () => lineup.sources || fallbackUrls || [],
    [fallbackUrls, lineup.sources],
  );
  const sourceUrls = useMemo(() => sources.map((item) => (typeof item === 'string' ? item : item?.url)).filter(Boolean), [sources]);
  const activeIndex = Number(lineup.activeIndex ?? activeSource ?? 0);
  const [rotateIndex, setRotateIndex] = useState(activeIndex);
  useEffect(() => setRotateIndex(activeIndex), [activeIndex]);

  const sourceKey = `${url}::${source.kind || ''}::${playbackPolicy?.name || ''}::${source.label || ''}::${library.watchKey || ''}`;

  const engine = usePlaybackEngine({
    policy: builtPolicy,
    sourceKey,
    watchKey: library.watchKey || '',
    resume: library.resume !== false,
    persistProgress: Boolean(library.watchKey) && library.persist !== false,
    fallbackUrls: sourceUrls,
    activeFallbackIndex: rotateIndex,
    autoPlay,
    allowNativeHls,
    mediaSession: display.mediaSession || null,
    libraryEntry: library.entry || null,
    handlers: {
      onStatus: on.onStatus,
      onError: on.onError,
      onEnded: on.onEnded,
      onFatal: on.onFatal,
      onRotateFallback: (index) => {
        setRotateIndex(index);
        onPickSource?.(index);
      },
    },
  });

  const setVideoRef = engine.setVideoRef;
  const videoEl = videoElProp || engine.videoEl;

  // A page-owned element is handed to the engine once; children are then
  // rendered untouched so React keeps reconciling it where it already is.
  useEffect(() => {
    if (videoElProp) setVideoRef(videoElProp);
  }, [setVideoRef, videoElProp]);

  // A page may pass its <video> as children without a ref: adopt the first one
  // inside the wrapper so the engine still owns attachment.
  useEffect(() => {
    if (videoElProp || children) {
      if (videoElProp) return undefined;
      const found = wrapRef.current?.querySelector?.('video');
      if (found) setVideoRef(found);
      return () => setVideoRef(null);
    }
    return undefined;
  }, [children, setVideoRef, videoElProp]);

  useEffect(() => () => setVideoRef(null), [setVideoRef]);

  // ---------------------------------------------------------------- chrome state
  const wrapRef = useRef(null);
  const trackRef = useRef(null);
  const hideTimerRef = useRef(0);
  const pulseTimerRef = useRef(0);
  const [visible, setVisible] = useState(true);
  const [menu, setMenu] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [locked, setLocked] = useState(false);
  const [pulse, setPulse] = useState(null);
  const [abLoop, setAbLoop] = useState({ a: null, b: null });
  const [dropTarget, setDropTarget] = useState(false);
  const [notice, setNotice] = useState(null);
  const [skipCountdown, setSkipCountdown] = useState(null);
  const [scrubValue, setScrubValue] = useState(null);
  const [preview, setPreview] = useState(null);
  const [frozenFrame, setFrozenFrame] = useState('');

  const { status, statusMessage, attemptNote, errorInfo, playing, time, model, prefs, tracks, stats, resumePrompt } = engine;
  const canSeek = Boolean(model.canSeek) && status === 'ready';
  const live = Boolean(model.live);
  const win = model.window;
  const winLength = win ? win.end - win.start : 0;
  const shownTime = scrubValue !== null ? scrubValue : time;
  const playedRatio = canSeek && winLength > 0 ? Math.min(1, Math.max(0, (shownTime - win.start) / winLength)) : 0;
  const bufferedRatio = useMemo(() => {
    if (!canSeek || !winLength || !videoEl) return 0;
    try {
      if (!videoEl.buffered?.length) return 0;
      const end = Number(videoEl.buffered.end(videoEl.buffered.length - 1));
      return Math.min(1, Math.max(0, (end - win.start) / winLength));
    } catch {
      return 0;
    }
  }, [canSeek, videoEl, win, winLength]);

  const flash = useCallback((next) => {
    const payload = typeof next === 'string' ? { id: Date.now(), kind: next } : { id: Date.now(), ...next };
    setPulse((current) => {
      const same = current && current.kind === payload.kind && Date.now() - current.id < 1200;
      const merged = same && payload.kind !== 'badge' ? { ...payload, id: current.id, amount: (current.amount || 0) + (payload.amount || 0) } : payload;
      return merged;
    });
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulse(null), 700);
  }, []);

  const vibrate = useVibrate(prefs);

  const wake = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimerRef.current), []);
  useEffect(() => () => window.clearTimeout(pulseTimerRef.current), []);

  // --------------------------------------------------------------- window/PiP/lock
  const { isFullscreen, canFullscreen, toggleFullscreen } = useFullscreen();
  const { pipActive, canPip, togglePip } = usePip(videoEl);
  const { canAirPlay, showAirPlay } = useAirPlay(videoEl);
  useWakeLock(playing);

  const ambientActive = Boolean(prefs.ambient) && playing && !isFullscreen && !compact;
  useEffect(() => {
    if (!ambientActive) return undefined;
    document.documentElement.classList.add('jv-theater');
    return () => document.documentElement.classList.remove('jv-theater');
  }, [ambientActive]);

  // PiP when the tab goes away, so a radio-ish stream keeps playing.
  const pipOnHideRef = useRef(pipOnHide);
  pipOnHideRef.current = pipOnHide;
  useEffect(() => {
    const onVisibility = () => {
      if (!pipOnHideRef.current || document.visibilityState !== 'hidden') return;
      if (!videoEl || videoEl.paused || !canPip) return;
      try {
        videoEl.requestPictureInPicture?.().catch?.(() => {});
      } catch {}
    };
    document.addEventListener?.('visibilitychange', onVisibility);
    return () => document.removeEventListener?.('visibilitychange', onVisibility);
  }, [canPip, videoEl]);

  // ------------------------------------------------------------------- gestures
  const { layerProps, bubble, hold2x, jog } = usePlayerGestures({
    engine,
    videoEl,
    status,
    enabled: gesturesEnabled && !audioOnly,
    coarse,
    locked,
    canSeek,
    onWake: wake,
    onToggleControls: () => setVisible((current) => !current),
    onTogglePlay: () => runCommand('togglePlay'),
    onToggleFullscreen: () => runCommand('toggleFullscreen'),
    onPulse: flash,
    onHaptic: vibrate,
  });

  // --------------------------------------------------------- controls visibility
  // Never auto-hide while paused, scrubbing, holding 2×, in a menu, while a
  // toast needs an answer, or right after a recovery rung (docs/PLAYER.md §5).
  const controlsAreBusy =
    !playing ||
    Boolean(menu) ||
    Boolean(contextMenu) ||
    scrubValue !== null ||
    jog !== null ||
    hold2x ||
    locked ||
    status === 'recovering' ||
    status === 'loading';
  const toastIsActionable = Boolean(resumePrompt) || Boolean(errorInfo) || skipCountdown !== null || Boolean(notice);
  useEffect(() => {
    if (controlsAreBusy || toastIsActionable) {
      setVisible(true);
      window.clearTimeout(hideTimerRef.current);
      return undefined;
    }
    hideTimerRef.current = window.setTimeout(() => setVisible(false), HIDE_DELAY_MS);
    return () => window.clearTimeout(hideTimerRef.current);
  }, [controlsAreBusy, toastIsActionable]);

  // ------------------------------------------------------------------- commands
  const markSkipTarget = useMemo(() => {
    if (!marks) return null;
    const current = Number(time) || 0;
    for (const key of ['intro', 'recap', 'credits']) {
      const range = marks[key];
      if (!range) continue;
      const start = Number(range.start) || 0;
      const end = Number(range.end) || 0;
      if (end > start && current >= start - 5 && current <= end) {
        return { key, end, label: range.label || (key === 'credits' ? 'Skip credits' : key === 'recap' ? 'Skip recap' : 'Skip intro') };
      }
    }
    return null;
  }, [marks, time]);

  const heights = useMemo(
    () => [...new Set((tracks.video || []).map((track) => Number(track.height)).filter((value) => value > 0))].sort((a, b) => b - a),
    [tracks.video],
  );

  const applyAbLoop = useCallback(
    (patch) => {
      setAbLoop((current) => {
        const next = { ...current, ...patch };
        const el = videoEl;
        if (el && next.a != null && next.b != null && next.b > next.a) {
          const current2 = Number(el.currentTime) || 0;
          if (current2 < next.a || current2 > next.b) {
            try {
              el.currentTime = next.a;
            } catch {}
          }
        }
        return next;
      });
    },
    [videoEl],
  );

  const rotateSource = useCallback(() => {
    if (sourceUrls.length > 1) engine.rotateFallback((rotateIndex + 1) % sourceUrls.length);
    else engine.retry();
  }, [engine, rotateIndex, sourceUrls.length]);

  const openExternal = useCallback((target) => {
    try {
      window.open(String(target), '_blank', 'noopener,noreferrer');
    } catch {}
  }, []);

  const copyText = useCallback(
    async (value, label) => {
      try {
        await navigator.clipboard?.writeText(String(value || ''));
        flash({ kind: 'badge', label });
      } catch {
        setNotice({ tone: 'warn', text: 'The clipboard is blocked here — copy from the address bar instead.' });
      }
    },
    [flash],
  );

  const reportDead = useCallback(() => {
    const incident = {
      at: new Date().toISOString(),
      url: String(url || '').slice(0, 300),
      title: display.title || title || '',
      status,
      error: errorInfo ? { kind: errorInfo.kind, code: errorInfo.code, message: errorInfo.message } : null,
      engine: stats?.engine || 'native',
      ua: String(navigator.userAgent || '').slice(0, 160),
    };
    try {
      const queue = JSON.parse(localStorage.getItem(INCIDENT_QUEUE_KEY) || '[]');
      queue.unshift(incident);
      localStorage.setItem(INCIDENT_QUEUE_KEY, JSON.stringify(queue.slice(0, 50)));
    } catch {}
    try {
      on.onReport?.(incident);
    } catch {}
    flash({ kind: 'badge', label: 'Logged on this device' });
  }, [display.title, errorInfo, flash, on, stats?.engine, status, title, url]);

  // One capture path for both "Save this frame" and freeze: same canvas, same
  // CORS failure mode (a cross-origin stream without CORS headers taints it).
  const captureFrame = useCallback(() => {
    const el = videoEl;
    if (!el || !el.videoWidth) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      canvas.getContext('2d')?.drawImage(el, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch {
      return undefined; // undefined = blocked, null = nothing to capture
    }
  }, [videoEl]);

  const snapshot = useCallback(() => {
    const data = captureFrame();
    if (data === null) {
      setNotice({ tone: 'info', text: 'Nothing to capture yet.' });
      return;
    }
    if (data === undefined) {
      setNotice({ tone: 'warn', text: 'This stream is cross-origin, so the browser blocks canvas capture.' });
      return;
    }
    const base = String(display.title || 'jashvibes-frame').replace(/[^\w.-]+/g, '-').slice(0, 60);
    const link = document.createElement('a');
    link.download = `${base}-${fmtTime(Number(videoEl?.currentTime) || 0).replace(':', 'm')}s.png`;
    link.href = data;
    link.click();
    flash({ kind: 'badge', label: 'Frame saved' });
  }, [captureFrame, display.title, flash, videoEl]);

  // Freeze frame: hold the picture while the stream keeps buffering. Useful on
  // live TV when the audio is the point, and as a pause-that-does-not-jitter.
  const toggleFreeze = useCallback(() => {
    if (frozenFrame) {
      setFrozenFrame('');
      return;
    }
    const data = captureFrame();
    if (!data) {
      setNotice({
        tone: 'warn',
        text: data === null ? 'Nothing to freeze yet — the first frame has not painted.' : 'This stream is cross-origin, so the browser blocks canvas capture.',
      });
      return;
    }
    engine.pause();
    setFrozenFrame(data);
    flash({ kind: 'badge', label: 'Frozen' });
  }, [captureFrame, engine, flash, frozenFrame]);

  // A new source or an error must never leave a stale picture on screen.
  useEffect(() => {
    setFrozenFrame('');
  }, [sourceKey, status]);

  const runCommand = useCallback(
    (name, context = {}) => {
      const el = videoEl;
      switch (name) {
        case 'togglePlay':
          engine.togglePlay();
          flash({ kind: el && el.paused ? 'play' : 'pause' });
          vibrate(8);
          break;
        case 'seekBack':
          engine.seekBy(-10);
          flash({ kind: 'back', amount: 10 });
          vibrate(10);
          break;
        case 'seekForward':
          engine.seekBy(10);
          flash({ kind: 'fwd', amount: 10 });
          vibrate(10);
          break;
        case 'seekBack30':
          engine.seekBy(-30);
          flash({ kind: 'back', amount: 30 });
          break;
        case 'seekForward30':
          engine.seekBy(30);
          flash({ kind: 'fwd', amount: 30 });
          break;
        case 'frameBack':
          engine.stepFrame(-1);
          break;
        case 'frameForward':
          engine.stepFrame(1);
          break;
        case 'jumpToPercent': {
          const percent = digitSeekPercent(context.event);
          if (percent !== null && canSeek) {
            engine.jumpToPercent(percent);
            flash({ kind: 'badge', label: `${percent}%` });
          }
          break;
        }
        case 'nudgeVolumeUp':
        case 'nudgeVolumeDown': {
          const delta = name === 'nudgeVolumeUp' ? 0.1 : -0.1;
          engine.setVolume((Number(el?.volume) || 0) + delta);
          flash({ kind: 'badge', label: 'Volume', value: `${Math.round(Math.min(1, Math.max(0, (Number(el?.volume) || 0) + delta)) * 100)}%` });
          break;
        }
        case 'mute':
          engine.toggleMute();
          break;
        case 'brightnessUp':
        case 'brightnessDown': {
          const delta = name === 'brightnessUp' ? 0.1 : -0.1;
          engine.nudgeBrightness(delta);
          const next = Math.min(1, Math.max(0.15, (Number(prefs.brightness) || 1) + delta));
          flash({ kind: 'badge', label: 'Brightness', value: `${Math.round(next * 100)}%` });
          break;
        }
        case 'speedUp':
          engine.nudgeRate(0.25);
          flash({ kind: 'badge', label: 'Speed', value: `${(Number(el?.playbackRate) || 1).toFixed(2)}×` });
          break;
        case 'speedDown':
          engine.nudgeRate(-0.25);
          flash({ kind: 'badge', label: 'Speed', value: `${(Number(el?.playbackRate) || 1).toFixed(2)}×` });
          break;
        case 'speedReset':
          engine.setRate(1);
          flash({ kind: 'badge', label: 'Speed', value: '1×' });
          break;
        case 'toggleFullscreen':
          toggleFullscreen(wrapRef.current);
          break;
        case 'togglePip':
          togglePip();
          break;
        case 'cycleCaptions':
          if (!engine.cycleCaptions()) setMenu('subtitles');
          break;
        case 'openSubtitles':
          setMenu(menu === 'subtitles' ? null : 'subtitles');
          break;
        case 'subtitleDelayUp':
          engine.shiftSubtitleDelay(250);
          break;
        case 'subtitleDelayDown':
          engine.shiftSubtitleDelay(-250);
          break;
        case 'cycleAudioTrack':
          if (!engine.cycleAudioTrack()) setNotice({ tone: 'info', text: 'This source carries one audio track.' });
          break;
        case 'cycleQuality':
          if (!engine.cycleQuality()) setNotice({ tone: 'info', text: 'This source exposes a single rendition.' });
          break;
        case 'qualityAuto':
          engine.setAutoQuality();
          break;
        case 'toggleAmbient':
          engine.setPref('ambient', !prefs.ambient);
          break;
        case 'toggleStats':
          engine.toggleStats();
          break;
        case 'toggleControls':
          setVisible((current) => !current);
          break;
        case 'lockControls':
          setLocked((current) => !current);
          break;
        case 'freezeFrame':
          toggleFreeze();
          break;
        case 'skipMarks':
          if (markSkipTarget) engine.seekTo(markSkipTarget.end + 0.5);
          break;
        case 'replaySegment':
          engine.seekBy(-10);
          break;
        case 'loopSegment':
          if (abLoop.a != null && abLoop.b != null) applyAbLoop({ a: null, b: null });
          else if (abLoop.a == null) applyAbLoop({ a: Math.floor(Number(time) || 0) });
          else applyAbLoop({ b: Math.ceil(Number(time) || 0) });
          break;
        case 'restart':
          engine.startOver();
          break;
        case 'closeMenus':
          if (contextMenu) setContextMenu(null);
          else if (menu) setMenu(null);
          else if (locked) setLocked(false);
          else if (isFullscreen) toggleFullscreen(wrapRef.current);
          break;
        case 'prevItem':
          onPrev?.();
          break;
        case 'nextItem':
          onNext?.();
          break;
        default:
          return false;
      }
      return true;
    },
    [
      abLoop.a,
      abLoop.b,
      applyAbLoop,
      canSeek,
      contextMenu,
      engine,
      flash,
      locked,
      isFullscreen,
      markSkipTarget,
      menu,
      onPrev,
      onNext,
      prefs,
      time,
      toggleFullscreen,
      togglePip,
      toggleFreeze,
      vibrate,
      videoEl,
    ],
  );

  // ------------------------------------------------------- wheel (desktop only)
  // Wheel over the video = volume, Shift+wheel = speed. Plain wheel is only
  // taken while the player is fullscreen or keyboard-focused, so scrolling a
  // page past an inline player still scrolls the page.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node?.addEventListener) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey) return; // browser/pinch zoom
      if (locked) return;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      const shift = event.shiftKey;
      const focused = isFullscreen || (typeof document !== 'undefined' && document.activeElement === node);
      if (!shift && !focused) return;
      event.preventDefault();
      wake();
      if (shift) {
        engine.nudgeRate(delta > 0 ? -0.25 : 0.25);
        flash({ kind: 'badge', label: 'Speed', value: `${(Number(videoEl?.playbackRate) || 1).toFixed(2)}×` });
        return;
      }
      const next = Math.min(1, Math.max(0, (Number(videoEl?.volume) || 0) + (delta > 0 ? -0.05 : 0.05)));
      engine.setVolume(next);
      flash({ kind: 'badge', label: 'Volume', value: `${Math.round(next * 100)}%` });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [engine, flash, isFullscreen, locked, videoEl, wake]);

  // ------------------------------------------------------------------ TV remotes
  // On a channel change the element (and sometimes the focused node) is gone,
  // which drops focus to <body> and silences the whole key map. Take it back —
  // but only when nothing else legitimately holds focus.
  useEffect(() => {
    if (typeof document === 'undefined' || !sourceKey) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    wrapRef.current?.focus?.({ preventScroll: true });
  }, [sourceKey]);

  // ------------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && (menu || contextMenu || locked)) {
        if (menu) setMenu(null);
        if (contextMenu) setContextMenu(null);
        if (locked) setLocked(false);
        event.preventDefault();
        return;
      }
      const name = commandForKey(event, { enabled: true });
      if (!name) return;
      // Only swallow keys while the player (or fullscreen) has focus, so the
      // page keeps working normally.
      const focused = wrapRef.current?.contains?.(document.activeElement) || document.fullscreenElement === wrapRef.current;
      if (!focused) return;
      if (locked && !(event.key === 'L' || event.key === 'l' || event.shiftKey)) return;
      event.preventDefault();
      event.stopPropagation();
      wake();
      runCommand(name, { event });
    };
    const node = wrapRef.current;
    node?.addEventListener?.('keydown', onKeyDown);
    if (isFullscreen) document.addEventListener?.('keydown', onKeyDown, true);
    return () => {
      node?.removeEventListener?.('keydown', onKeyDown);
      if (isFullscreen) document.removeEventListener?.('keydown', onKeyDown, true);
    };
  }, [contextMenu, isFullscreen, locked, menu, runCommand, wake]);

  // ---------------------------------------------------------------- hover preview
  const ratioFromClientX = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect?.();
    if (!rect) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
  }, []);

  const onTrackHover = useCallback(
    (event) => {
      if (!canSeek || !win) return;
      const rect = trackRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      const ratio = ratioFromClientX(event.clientX);
      setPreview({ x: Math.min(rect.width, Math.max(0, event.clientX - rect.left)), time: win.start + ratio * (win.end - win.start) });
    },
    [canSeek, ratioFromClientX, win],
  );

  // ------------------------------------------------------------------- scrub bar
  const onTrackDown = useCallback(
    (event) => {
      if (!canSeek || !win) return;
      const target = win.start + ratioFromClientX(event.clientX) * (win.end - win.start);
      setScrubValue(target);
      engine.setScrubbing(true, target);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [canSeek, engine, ratioFromClientX, win],
  );

  const onTrackMove = useCallback(
    (event) => {
      onTrackHover(event);
      if (scrubValue === null || !win) return;
      const target = win.start + ratioFromClientX(event.clientX) * (win.end - win.start);
      setScrubValue(target);
      engine.setScrubbing(true, target);
    },
    [engine, onTrackHover, ratioFromClientX, scrubValue, win],
  );

  const onTrackUp = useCallback(() => {
    if (scrubValue === null) return;
    engine.seekTo(scrubValue);
    engine.setScrubbing(false);
    setScrubValue(null);
  }, [engine, scrubValue]);

  // A-B loop enforcement (the element, not React state, so it stays frame-exact).
  useEffect(() => {
    const el = videoEl;
    if (!el || abLoop.a == null || abLoop.b == null || abLoop.b <= abLoop.a) return undefined;
    const onTime = () => {
      if (Number(el.currentTime) >= abLoop.b - 0.05) {
        try {
          el.currentTime = abLoop.a;
        } catch {}
      }
    };
    el.addEventListener?.('timeupdate', onTime);
    return () => el.removeEventListener?.('timeupdate', onTime);
  }, [abLoop.a, abLoop.b, videoEl]);

  // Resume prompts deserve a stronger buzz: the user must decide.
  useEffect(() => {
    if (resumePrompt && !resumePrompt.auto) vibrate([15, 40, 15]);
  }, [resumePrompt, vibrate]);

  // A first real gesture restores sound if autoplay forced us muted.
  const unmuteAfterGesture = engine.unmuteAfterGesture;
  useEffect(() => {
    const el = videoEl;
    if (!el) return undefined;
    const unmute = () => {
      if (unmuteAfterGesture()) flash({ kind: 'badge', label: 'Sound on' });
    };
    el.addEventListener?.('touchend', unmute, { once: true });
    el.addEventListener?.('click', unmute, { once: true });
    return () => {
      el.removeEventListener?.('touchend', unmute);
      el.removeEventListener?.('click', unmute);
    };
  }, [flash, unmuteAfterGesture, videoEl]);

  // ------------------------------------------------------------- auto-advance
  useEffect(() => {
    if (compact || live || !nextEpisode?.onPlay || !win) {
      if (skipCountdown !== null) setSkipCountdown(null);
      return undefined;
    }
    const remaining = win.end - (Number(time) || 0);
    if (remaining > AUTO_ADVANCE_LEAD_SECONDS || remaining <= 0) {
      if (skipCountdown !== null) setSkipCountdown(null);
      return undefined;
    }
    setSkipCountdown(Math.max(0, Math.round(remaining)));
    return undefined;
  }, [compact, live, nextEpisode, skipCountdown, time, win]);

  useEffect(() => {
    if (skipCountdown !== 0 || !playing) return undefined;
    const timer = window.setTimeout(() => {
      setSkipCountdown(null);
      try {
        nextEpisode?.onPlay?.();
      } catch {}
    }, 300);
    return () => window.clearTimeout(timer);
  }, [nextEpisode, playing, skipCountdown]);

  // ------------------------------------------------------------- codec warning
  const codecWarning = useMemo(
    () => warnForSource({ url, label: source.label || '', title: display.title || title || '' }),
    [display.title, source.label, title, url],
  );

  // --------------------------------------------------------------- subtitle drop
  const importSubtitleFile = useCallback(
    async (file) => {
      if (!file) return;
      try {
        const text = await (file.text ? file.text() : Promise.reject(new Error('unreadable')));
        const result = engine.addExternalSubtitle(file, String(text || ''));
        if (result?.ok) flash({ kind: 'badge', label: 'Subtitles loaded', value: result.label });
        else setNotice({ tone: 'warn', text: result?.reason || 'That subtitle file could not be read.' });
      } catch {
        setNotice({ tone: 'error', text: 'The subtitle file could not be read.' });
      }
    },
    [engine, flash],
  );

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return undefined;
    let depth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const onDragEnter = (event) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDropTarget(true);
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDropTarget(false);
    };
    const onDragOver = (event) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropTarget(false);
      importSubtitleFile(event.dataTransfer?.files?.[0]);
    };
    node.addEventListener?.('dragenter', onDragEnter);
    node.addEventListener?.('dragleave', onDragLeave);
    node.addEventListener?.('dragover', onDragOver);
    node.addEventListener?.('drop', onDrop);
    return () => {
      node.removeEventListener?.('dragenter', onDragEnter);
      node.removeEventListener?.('dragleave', onDragLeave);
      node.removeEventListener?.('dragover', onDragOver);
      node.removeEventListener?.('drop', onDrop);
    };
  }, [importSubtitleFile]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // ----------------------------------------------------------------- derived UI
  const commandList = useMemo(() => Object.entries(COMMANDS).map(([name, command]) => ({ name, ...command })), []);
  const qualityLabel = prefs.qualityAuto || !prefs.qualityHeight ? 'Auto' : Number(prefs.qualityHeight) >= 2160 ? '4K' : `${prefs.qualityHeight}p`;

  const subtitleOn = (tracks.text || []).some((track) => track.active) || Boolean(engine.externalSubtitle);

  const contextItems = useMemo(() => {
    const items = [];
    if (url) items.push({ id: 'copy', label: 'Copy stream URL', icon: PATHS.copy, onSelect: () => copyText(url, 'Stream URL copied') });
    if (display.title || title) items.push({ id: 'copy-title', label: 'Copy title', icon: PATHS.copy, onSelect: () => copyText(display.title || title, 'Title copied') });
    items.push('---');
    items.push({ id: 'stats', label: engine.showStats ? 'Hide stats' : 'Show stats', icon: PATHS.stats, hint: 'I', onSelect: () => engine.toggleStats() });
    items.push({ id: 'snapshot', label: 'Save this frame', icon: PATHS.camera, onSelect: snapshot });
    items.push({ id: 'freeze', label: frozenFrame ? 'Unfreeze frame' : 'Freeze frame', icon: PATHS.camera, hint: '⇧F', onSelect: toggleFreeze });
    items.push({ id: 'retry', label: 'Force retry', icon: PATHS.refresh, onSelect: () => engine.retry() });
    if (sourceUrls.length > 1) items.push({ id: 'rotate', label: 'Next source', icon: PATHS.next, onSelect: rotateSource });
    items.push('---');
    items.push({ id: 'report', label: 'Report dead', icon: PATHS.warning, hint: 'on device', onSelect: reportDead });
    return items;
  }, [copyText, display.title, engine, frozenFrame, reportDead, rotateSource, snapshot, sourceUrls.length, title, toggleFreeze, url]);

  // ---------------------------------------------------------------------- render
  const videoNode = children || (
    <video
      ref={setVideoRef}
      playsInline
      autoPlay={autoPlay}
      preload="auto"
      className="absolute inset-0 h-full w-full bg-black object-contain"
      onClick={coarse ? undefined : () => runCommand('togglePlay')}
    />
  );

  if (compact) {
    return (
      <div
        ref={wrapRef}
        data-dvp="root"
        data-dvp-compact="1"
        tabIndex={-1}
        // Every child of this variant is absolutely positioned (video, spinner, overlays, bar), so the
        // root needs the caller's box: h-full/w-full is the contract. Without it a compact player inside
        // an aspect-ratio wrapper collapsed to 0px and showed nothing at all.
        className={`group/player relative isolate h-full w-full overflow-hidden rounded-xl bg-black text-white outline-none ${className}`}
      >
        {videoNode}
        {status !== 'ready' && status !== 'error' ? <Spinner label={statusMessage || attemptNote || 'Loading…'} /> : null}
        {status === 'error' ? (
          <div className="absolute inset-0 z-30 grid place-items-center bg-black/80 p-2 text-center">
            <p className="line-clamp-3 px-1 text-[11px] font-bold leading-snug text-red-200">{errorInfo?.message || 'Preview failed.'}</p>
            <button type="button" onClick={() => engine.retry()} className="mt-2 rounded-full border border-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white/80">
              Retry
            </button>
          </div>
        ) : null}
        <div
          data-dvp="controls"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center gap-1.5 bg-gradient-to-t from-black/90 to-transparent px-2 pb-1.5 pt-6 transition-opacity ${
            visible || status !== 'ready' ? 'opacity-100' : 'opacity-0 group-hover/player:opacity-100 group-hover/player:pointer-events-auto'
          }`}
        >
          <button
            type="button"
            data-jash-command="togglePlay"
            onClick={() => runCommand('togglePlay')}
            aria-label={playing ? 'Pause preview' : 'Play preview'}
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-white transition hover:bg-white/10"
          >
            <Icon d={playing ? PATHS.pause : PATHS.play} className="h-4 w-4" />
          </button>
          <span className="min-w-0 flex-1 truncate text-[10px] font-black uppercase tracking-[0.18em] text-white/70">
            {live ? liveLabel : fmtTime(shownTime - (win?.start || 0))}
          </span>
          <button
            type="button"
            data-jash-command="restart"
            onClick={() => engine.retry()}
            aria-label="Reload preview"
            className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-white/70 transition hover:text-white"
          >
            <Icon d={PATHS.refresh} className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      data-dvp="root"
      tabIndex={0}
      role="region"
      aria-label={`${display.title || title || 'Video'} player`}
      onContextMenu={(event) => {
        if (event.target?.closest?.('[data-dvp="controls"]')) return;
        event.preventDefault();
        setContextMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`group/player jv-native-cursor relative isolate overflow-hidden bg-black text-white outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60 ${aspectClass(
        display.aspect,
      )} ${landscapePhone ? 'jv-landscape-phone' : ''} ${className}`}
    >
      {videoNode}

      {!audioOnly && !locked ? (
        <div data-dvp="gestures" className="absolute inset-0 z-10 touch-none select-none" {...layerProps} />
      ) : null}

      {dropTarget ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/60">
          <p className="rounded-2xl border border-fuchsia-400/40 bg-black/70 px-4 py-2 text-[12px] font-black uppercase tracking-wider text-fuchsia-100">Drop to load subtitles</p>
        </div>
      ) : null}

      {status === 'loading' || status === 'buffering' || (status === 'recovering' && !errorInfo) ? (
        <Spinner label={status === 'recovering' ? attemptNote || 'Recovering…' : statusMessage || 'Buffering stream…'} />
      ) : null}

      <CenterPulse pulse={pulse} />
      {hold2x ? <HoldBadge rate={2} /> : null}
      {bubble ? (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 text-center backdrop-blur"
          style={{ left: bubble.x, top: bubble.y }}
        >
          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/55">{bubble.label}</p>
          <p className="text-[13px] font-black tabular-nums text-white">{bubble.value}</p>
        </div>
      ) : null}
      {jog ? <TimeBubble label="Scrub" seconds={jog.seconds} delta={jog.delta} /> : null}

      {status === 'error' && errorInfo ? (
        <ErrorCard
          info={errorInfo}
          url={url}
          online={online}
          onRetry={() => engine.retry()}
          onRotate={rotateSource}
          onRefreshToken={() => {
            engine.switchSource({ keepPosition: true });
            setNotice({ tone: 'info', text: 'Refreshing access… use Live Service → Tools if this keeps happening.' });
          }}
          onDropDrm={() => engine.retry()}
          onExternal={openExternal}
          onReport={reportDead}
        />
      ) : null}

      {frozenFrame ? (
        <div data-dvp="controls" className="absolute inset-0 z-[25] flex items-center justify-center bg-black">
          <img src={frozenFrame} alt="Frozen frame" className="h-full w-full object-contain" />
          <button
            type="button"
            data-jash-command="freezeFrame"
            onClick={toggleFreeze}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-white/20 bg-black/75 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white backdrop-blur transition hover:border-fuchsia-400/60"
          >
            Unfreeze
          </button>
        </div>
      ) : null}

      {locked ? <LockedOverlay onUnlock={() => setLocked(false)} /> : null}

      <TopBar
        title={display.title || title}
        subtitle={display.subtitle}
        live={live}
        liveLabel={liveLabel}
        canSeek={canSeek}
        dvrMinutes={(model.dvrSeconds || 0) / 60}
        visible={visible || status !== 'ready'}
        onPrev={onPrev}
        onNext={onNext}
        badges={
          <>
            {display.badges}
            {codecWarning.risky ? (
              <span className="rounded-full border border-amber-300/40 bg-amber-950/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200" title={codecWarning.notes.join(' · ')}>
                {codecWarning.tags.join(' / ')}
              </span>
            ) : null}
            {!online ? <span className="rounded-full border border-red-400/40 bg-red-950/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-red-200">Offline</span> : null}
            {canFullscreen ? null : <span className="text-[9px] font-black uppercase tracking-wider text-white/35">no FS</span>}
          </>
        }
      />

      <ResumeToast
        prompt={resumePrompt}
        onAccept={engine.resumeFromPrompt}
        onDismiss={engine.startOver}
        onStartOver={engine.startOver}
        onNever={library.watchKey ? engine.neverResume : null}
      />

      {markSkipTarget ? <SkipButton label={markSkipTarget.label} side="right" onClick={() => engine.seekTo(markSkipTarget.end + 0.5)} /> : null}

      {skipCountdown !== null && nextEpisode ? (
        <NextEpisodePill
          label={nextEpisode.label || 'Next episode'}
          secondsLeft={skipCountdown}
          onPlay={() => {
            setSkipCountdown(null);
            try {
              nextEpisode.onPlay?.();
            } catch {}
          }}
          onCancel={() => setSkipCountdown(null)}
        />
      ) : null}

      {notice ? (
        <NoticeBar
          tone={notice.tone}
          action={notice.action ? { ...notice.action, onClick: () => { const fn = notice.action.onClick; setNotice(null); fn?.(); } } : null}
        >
          {notice.text}
        </NoticeBar>
      ) : null}

      <StatsPanel stats={engine.showStats ? stats : null} model={model} source={url} status={status} />

      <div
        data-dvp="controls"
        onPointerDown={wake}
        className={`absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/95 via-black/60 to-transparent px-2 pb-[max(env(safe-area-inset-bottom),0.625rem)] pt-12 transition-opacity duration-300 group-hover/player:pointer-events-auto group-hover/player:opacity-100 sm:px-3 ${
          visible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {canSeek ? (
          <div
            ref={trackRef}
            className="group/track relative -my-2 cursor-pointer py-3"
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onMouseMove={onTrackHover}
            onMouseLeave={() => setPreview(null)}
          >
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-all group-hover/track:h-1.5">
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/25" style={{ width: `${bufferedRatio * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-fuchsia-500 via-fuchsia-400 to-amber-300" style={{ width: `${playedRatio * 100}%` }} />
              {abLoop.a != null && win && winLength > 0 ? (
                <div
                  className="absolute inset-y-0 bg-emerald-400/45"
                  style={{
                    left: `${((abLoop.a - win.start) / winLength) * 100}%`,
                    width: `${(((abLoop.b ?? Number(time)) - abLoop.a) / winLength) * 100}%`,
                  }}
                />
              ) : null}
            </div>
            <div
              className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_14px_rgba(217,70,239,0.9)] transition-opacity group-hover/track:opacity-100"
              style={{ left: `${playedRatio * 100}%` }}
            />
            <ScrubPreview preview={preview} poster={display.poster || poster} seconds={preview ? { time: preview.time } : null} />
          </div>
        ) : live ? (
          <LiveBadge
            label={liveLabel}
            dvrMinutes={(model.dvrSeconds || 0) / 60}
            onCatchUp={() => {
              const window2 = readSeekWindow(videoEl);
              if (window2) engine.seekTo(window2.end - 3);
            }}
          />
        ) : null}

        <div className="mt-1 flex items-center gap-0.5 sm:gap-1.5">
          <button
            type="button"
            data-jash-command="togglePlay"
            onClick={() => runCommand('togglePlay')}
            aria-label={playing ? 'Pause' : 'Play'}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
          >
            <Icon d={playing ? PATHS.pause : PATHS.play} className="h-6 w-6" />
          </button>

          {canSeek ? (
            <>
              <button
                type="button"
                data-jash-command="seekBack"
                onClick={() => runCommand('seekBack')}
                aria-label="Back 10 seconds"
                className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
              >
                <Icon d={PATHS.back10} className="h-5 w-5" />
              </button>
              <button
                type="button"
                data-jash-command="seekForward"
                onClick={() => runCommand('seekForward')}
                aria-label="Forward 10 seconds"
                className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
              >
                <Icon d={PATHS.fwd10} className="h-5 w-5" />
              </button>
              <span className="ml-1 hidden min-w-[8rem] text-[11px] font-bold tabular-nums text-white sm:inline">
                {fmtTime(Math.max(0, shownTime - (win?.start || 0)))}
                {winLength > 0 ? <span className="text-white/55"> / {fmtTime(winLength)}</span> : null}
              </span>
            </>
          ) : null}

          <div className="group/vol hidden items-center sm:flex">
            <button
              type="button"
              data-jash-command="mute"
              onClick={() => runCommand('mute')}
              aria-label={videoEl?.muted ? 'Unmute' : 'Mute'}
              className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/10"
            >
              <Icon d={videoEl?.muted || (Number(videoEl?.volume) || 0) === 0 ? PATHS.mute : PATHS.vol} className="h-5 w-5" />
            </button>
            <input
              data-jash-command="nudgeVolumeUp"
              type="range"
              min="0"
              max="1"
              step="0.05"
              aria-label="Volume"
              value={Number(videoEl?.volume ?? prefs.volume)}
              onChange={(event) => engine.setVolume(Number(event.target.value))}
              className="h-8 w-0 cursor-pointer opacity-0 transition-all accent-fuchsia-400 group-hover/vol:w-20 group-hover/vol:opacity-100"
            />
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5 sm:gap-1">
            {/* Two controls on the right: the bitrate you are getting, and one
                sheet that holds everything else. The old bar had a pill per
                capability and on a phone most of them were `hidden sm:grid`, so
                quality looked missing while dead icons took the space. */}
            {/* The one entry point: the quality list is the first thing in it, so a
                phone is a single tap from "which bitrate am I getting". */}
            <button
              type="button"
              data-jash-command="cycleQuality"
              onClick={() => setMenu(menu === 'settings' ? null : 'settings')}
              aria-label="Quality and settings"
              className="grid h-11 min-w-[4.25rem] place-items-center gap-1.5 rounded-full border border-white/15 px-2.5 text-[11px] font-black text-white transition hover:border-fuchsia-400/50 hover:text-fuchsia-200"
            >
              <span className="flex items-center gap-1.5">
                <Icon d={PATHS.list} className="h-4 w-4" />
                {qualityLabel}
              </span>
            </button>

            {canFullscreen ? (
              <button
                type="button"
                data-jash-command="toggleFullscreen"
                onClick={() => toggleFullscreen(wrapRef.current)}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                className="grid h-11 w-11 place-items-center rounded-full text-white transition hover:bg-white/10 active:scale-95"
              >
                <Icon d={isFullscreen ? PATHS.fsExit : PATHS.fs} className="h-5 w-5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {menu === 'settings' ? (
        <SettingsMenu
          coarse={coarse}
          onClose={() => setMenu(null)}
          variants={tracks.video || []}
          heights={heights}
          activeHeight={Number(prefs.qualityHeight) || 0}
          autoQuality={Boolean(prefs.qualityAuto)}
          onPickHeight={(height) => engine.selectQualityHeight(height)}
          onAutoHeight={() => engine.setAutoQuality()}
          rate={Number(videoEl?.playbackRate) || 1}
          onPickRate={(value) => engine.setRate(value)}
          audio={tracks.audio || []}
          audioLanguage={prefs.audioLanguage}
          onPickAudio={(language) => engine.selectAudioLanguage(language)}
          sources={sources}
          activeSourceIndex={rotateIndex}
          onPickSource={(index) => {
            engine.rotateFallback(index);
            try {
              onPickSource?.(index);
            } catch {}
            setMenu(null);
          }}
          captionsOn={subtitleOn}
          textTracks={tracks.text || []}
          onToggleCaptions={() => runCommand('cycleCaptions')}
          onOpenSubtitles={() => setMenu('subtitles')}
          statsOn={engine.showStats}
          onToggleStats={() => engine.toggleStats()}
          frozen={Boolean(frozenFrame)}
          onToggleFreeze={toggleFreeze}
          onRestart={() => {
            setMenu(null);
            engine.startOver();
          }}
          onOpenShortcuts={() => setMenu('shortcuts')}
          canPip={canPip}
          pipActive={pipActive}
          onTogglePip={() => togglePip()}
          canAirPlay={canAirPlay}
          onAirPlay={() => showAirPlay()}
          note={codecWarning.risky ? `Codec flags: ${codecWarning.tags.join(', ')} — this file may not decode on some phones.` : undefined}
        />
      ) : null}
      {menu === 'speed' ? (
        <SpeedMenu rate={Number(videoEl?.playbackRate) || 1} onPick={(value) => { engine.setRate(value); setMenu(null); }} coarse={coarse} onClose={() => setMenu(null)} />
      ) : null}
      {menu === 'quality' ? (
        <QualityMenu
          variants={tracks.video || []}
          activeHeight={Number(prefs.qualityHeight) || 0}
          auto={Boolean(prefs.qualityAuto)}
          onPick={(height) => engine.selectQualityHeight(height)}
          onAuto={() => engine.setAutoQuality()}
          coarse={coarse}
          onClose={() => setMenu(null)}
          footer={(tracks.video || []).length ? null : 'A plain file has one rendition — the server decides the quality.'}
        />
      ) : null}
      {menu === 'audio' ? (
        <AudioMenu
          audio={tracks.audio || []}
          language={prefs.audioLanguage}
          onPick={(language2) => {
            engine.selectAudioLanguage(language2);
            setMenu(null);
          }}
          coarse={coarse}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu === 'subtitles' ? (
        <SubtitlesMenu
          text={tracks.text || []}
          external={engine.externalSubtitle}
          canStyleExternal={Boolean(engine.externalSubtitle)}
          delayMs={Number(prefs.subtitleDelayMs) || 0}
          scale={Number(prefs.subtitleScale) || 1}
          background={Number(prefs.subtitleBackground) || 0}
          onDelay={(delta) => engine.shiftSubtitleDelay(delta)}
          onScale={(value) => engine.setPref('subtitleScale', value)}
          onBackground={(value) => engine.setPref('subtitleBackground', value)}
          onPick={(id) => engine.selectTextTrack(id)}
          onFile={importSubtitleFile}
          onRemove={() => engine.removeExternalSubtitle()}
          coarse={coarse}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu === 'sources' ? (
        <SourcesMenu
          sources={sources}
          activeIndex={rotateIndex}
          note={codecWarning.risky ? `Codec flags: ${codecWarning.tags.join(', ')}` : undefined}
          onPick={(index) => {
            engine.rotateFallback(index);
            try {
              onPickSource?.(index);
            } catch {}
            setMenu(null);
          }}
          coarse={coarse}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {menu === 'shortcuts' ? <ShortcutList commands={commandList} coarse={coarse} onClose={() => setMenu(null)} /> : null}

      {contextMenu ? <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextItems} onClose={() => setContextMenu(null)} /> : null}

      {engine.subtitleCss ? <style>{`/* jashvibes subtitle style */${engine.subtitleCss}`}</style> : null}

      {ambientActive && typeof document !== 'undefined'
        ? createPortal(<div data-dvp="ambient" className="pointer-events-none fixed inset-0 z-[45] bg-black/75 backdrop-blur-[1.5px] transition-opacity duration-700" />, document.body)
        : null}
    </div>
  );
}

export default JashPlayer;
