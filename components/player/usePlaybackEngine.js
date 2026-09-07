'use client';

/**
 * usePlaybackEngine — the ONLY code in JaSH ViBeS that attaches media to a
 * <video> element.
 *
 * Before this, six places did it themselves (UniversalVideoPlayer, two forks
 * inside /live, /classics, /watch, /music) and each drifted: different buffering
 * goals, different retry rules, three competing `play()` callers, and a resume
 * toast that only two of five surfaces honoured.
 *
 * One owner for:
 *   • kind detection + Shaka / native / direct attachment
 *   • load generation tokens (no ghost audio when zapping channels fast)
 *   • one destroy path (unload → detach → destroy → src reset)
 *   • progress-based stall detection (instead of hammering play())
 *   • the recovery ladder (retry → re-anchor → reload → drop DRM → rotate → policy)
 *   • resume + throttled progress persistence
 *   • quality / audio-language / subtitle control incl. external subtitle import
 *   • live-vs-DVR model derived from the element, not a page flag
 *   • prefs, stats, MediaSession, offline + tab lifecycle
 *
 * Stabilising rule: props that are functions or fresh objects live in
 * `handlersRef` and are NEVER in a dependency array. That is what stops the
 * old listener-rebinding-per-render class of bug for good.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampSeekTarget,
  clampToSeekWindow,
  derivePlaybackModel,
  detectKind,
  mimeTypeFor,
  needsEngine,
  readSeekWindow,
} from '@/lib/player/kind';
import { isDrmConfigError, mapPlaybackError } from '@/lib/player/errors';
import { createProgressWriter, isResumeSuppressed, planResume, suppressResume } from '@/lib/player/resume';
import { clamp, readPrefs, writePref } from '@/lib/player/prefs';
import { getHistoryEntry, saveOrUpsertProgress } from '@/lib/watchStore';
import { DEFAULT_LADDER, RUNGS, capabilitiesFor, nextRecoveryAction } from '@/lib/player/recovery';
import { createSubtitleTrack, releaseSubtitleTrack, shiftVttCues, subtitleStyleToCss } from '@/lib/player/subtitles';

const TIME_TICK_MS = 250;
/** How long a seek may take to produce progress before the ladder may react.
 *  Telegram/Stremio files are fetched lazily, so a jump to an unbuffered
 *  minute can legitimately spend 10+ seconds on one byte-range request. */
const SEEK_GRACE_MS = 25_000;
const WATCHDOG_MS = 500;
const STALL_SAMPLES = 3; // ~1.5 s before the spinner appears
const FATAL_STALL_SAMPLES = 16; // ~8 s before the recovery ladder starts
const DEFAULT_LOAD_TIMEOUT_MS = 25_000;

let shakaPromise = null;

/** Shaka is heavy; load it once per page, and only when a manifest needs it. */
async function loadShaka() {
  if (typeof window === 'undefined') throw new Error('Shaka Player is only available in the browser.');
  if (!window.shaka) {
    shakaPromise = shakaPromise || import('shaka-player/dist/shaka-player.compiled.js');
    const module = await shakaPromise;
    const shaka = module.default || window.shaka || module;
    if (!shaka?.Player) throw new Error('Shaka Player failed to load.');
    shaka.polyfill?.installAll?.();
    window.shaka = shaka;
  }
  return window.shaka;
}

let muxPromise = null;

/**
 * Shaka's raw-MPEG-TS demuxer looks for a GLOBAL `muxjs`; without it several Jio
 * / live TS feeds never buffer. The assignment is required, not cruft.
 */
async function ensureMuxjs() {
  if (typeof window === 'undefined' || window.muxjs) return;
  muxPromise = muxPromise || import('mux.js');
  const module = await muxPromise;
  window.muxjs = module.default || module;
}

export function usePlaybackEngine(options = {}) {
  const {
    policy = null,
    sourceKey = '',
    watchKey = '',
    resume: resumeEnabled = true,
    persistProgress = true,
    fallbackUrls = [],
    activeFallbackIndex = 0,
    forceUrl = '',
    autoPlay = true,
    allowNativeHls = true,
    enableSubtitles = true,
    mediaSession = null,
    libraryEntry = null,
    handlers = {},
  } = options;

  // ------------------------------------------------------------- fresh props
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const libraryEntryRef = useRef(libraryEntry);
  libraryEntryRef.current = libraryEntry;
  const fallbacksRef = useRef({ urls: fallbackUrls, index: activeFallbackIndex, forceUrl });
  fallbacksRef.current = { urls: fallbackUrls, index: activeFallbackIndex, forceUrl };
  const allowNativeHlsRef = useRef(allowNativeHls);
  allowNativeHlsRef.current = allowNativeHls;
  const resumeEnabledRef = useRef(resumeEnabled);
  resumeEnabledRef.current = resumeEnabled;
  const persistRef = useRef(persistProgress);
  persistRef.current = persistProgress;
  const enableSubtitlesRef = useRef(enableSubtitles);
  enableSubtitlesRef.current = enableSubtitles;

  // ------------------------------------------------------------------- state
  const [videoEl, setVideoEl] = useState(null);
  const videoRef = useRef(null);
  const setVideoRef = useCallback((el) => {
    videoRef.current = el;
    setVideoEl((current) => (current === el ? current : el));
  }, []);

  const [status, setStatus] = useState('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorInfo, setErrorInfo] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [model, setModel] = useState({ live: false, dvrSeconds: 0, canSeek: false, window: null });
  const [prefs, setPrefs] = useState(() => readPrefs());
  const [tracks, setTracks] = useState({ video: [], audio: [], text: [] });
  const [activeVariantId, setActiveVariantId] = useState(null);
  const [externalSubtitle, setExternalSubtitle] = useState(null);
  const [stats, setStats] = useState(null);
  const [showStats, setShowStats] = useState(() => Boolean(readPrefs().showStats));
  const [resumePrompt, setResumePrompt] = useState(null);
  const [attemptNote, setAttemptNote] = useState('');

  // -------------------------------------------------------------------- refs
  const playerRef = useRef(null);
  const policyRef = useRef(policy);
  policyRef.current = policy;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const generationRef = useRef(0);
  const loadStartedAtRef = useRef(0);
  const loadTokenRef = useRef(0);
  const timeoutRef = useRef(0);
  const userWantsPlayRef = useRef(Boolean(autoPlay));
  const autoplayMutedRef = useRef(false);
  const pendingSeekRef = useRef(null);
  const resumeAppliedRef = useRef(false);
  const scrubbingRef = useRef({ active: false, value: 0 });
  const stallSamplesRef = useRef(0);
  const seekGraceUntilRef = useRef(0);
  // { target, tries } — a seek the element has not honoured yet. Some file hosts
  // answer the first `currentTime` write with a clamped position; one re-issue
  // usually lands it, and it is capped so we can never fight the user in a loop.
  const seekVerifyRef = useRef(null);
  // Set once a seek has been *demonstrated* to be refused: asked for X, landed nowhere near X, twice.
  // The refusal says the browser cannot resolve a jump in this file — no `Accept-Ranges`, or a
  // container with no seek index a browser demuxer can use (MKV without `Cues`). It does NOT say the
  // host is broken: the Telegram-backed Stremio sources answer `206` + `Content-Range` correctly and
  // still restart, because Chromium answers a cueless file by scanning forward from where it is.
  const coarseSeekRef = useRef(false);
  const coarseSeekHoldRef = useRef(0);
  const [seekRefused, setSeekRefused] = useState(false);
  const lastPositionRef = useRef(0);
  const lastSampleTimeRef = useRef(0);
  const dropDrmRef = useRef(false);
  const offlineRef = useRef(typeof navigator !== 'undefined' ? navigator.onLine === false : false);
  const suspendedRef = useRef(false);
  const ladderRef = useRef({ rungIndex: -1, counts: {}, startedAt: 0, reloadAttempts: 0 });
  const externalSubtitleRef = useRef(null);
  externalSubtitleRef.current = externalSubtitle;
  const statsTimerRef = useRef(0);
  const resumeTimerRef = useRef(0);
  const failureRef = useRef(null); // set once handleFailure exists

  // ------------------------------------------------------------------ helpers
  const isAlive = useCallback((generation) => generationRef.current === generation, []);

  const commitStatus = useCallback((next, message = '') => {
    setStatus(next);
    setStatusMessage(message || '');
    try {
      handlersRef.current.onStatus?.(next, message || '');
    } catch {}
  }, []);

  const setPref = useCallback((name, value) => {
    try {
      writePref(name, value);
    } catch {}
    setPrefs((current) => ({ ...current, [name]: value }));
  }, []);

  const refreshModel = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    const next = derivePlaybackModel(el, { minDvrSeconds: 120 });
    setModel((current) => {
      const unchanged =
        current.live === next.live &&
        current.canSeek === next.canSeek &&
        Math.round(current.dvrSeconds) === Math.round(next.dvrSeconds) &&
        current.window?.start === (next.window?.start ?? undefined) &&
        current.window?.end === (next.window?.end ?? undefined);
      return unchanged ? current : { live: next.live, canSeek: next.canSeek, dvrSeconds: next.dvrSeconds, window: next.window };
    });
  }, []);

  const refreshTracks = useCallback(() => {
    const player = playerRef.current;
    const el = videoRef.current;
    if (player?.getVariantTracks) {
      try {
        const variants = (player.getVariantTracks() || []).filter((track) => track.type === 'variant');
        const audio = (player.getAudioTracks?.() || []).filter((track) => !track.dead);
        const text = (player.getTextTracks?.() || []).filter((track) => !track.dead);
        const active = variants.find((track) => track.active) || null;
        setActiveVariantId(active?.id ?? null);
        setTracks({ video: variants, audio, text });
        return;
      } catch {}
    }
    try {
      const list = Array.from(el?.textTracks || []).map((track, index) => ({
        id: index,
        index,
        label: String(track.label || '').replace(/^jash:/, '') || track.language || `Track ${index + 1}`,
        language: track.language || '',
        kind: track.kind || 'subtitles',
        active: track.mode === 'showing',
      }));
      setTracks((current) => ({ ...current, text: list }));
    } catch {}
  }, []);

  // A live stream is not resumable and must not occupy a Continue Watching row. Pages in live mode are
  // expected to pass `library.persist: false`; this is the backstop, computed from the element so a
  // DVR-windowed simulcast cannot slip a row in through the progress writer.
  function playingLive(el) {
    try {
      return Boolean(derivePlaybackModel(el).live);
    } catch {
      return false;
    }
  }

  const flushProgress = useCallback(() => {
    if (!persistRef.current || !watchKey) return;
    const el = videoRef.current;
    if (!el || playingLive(el)) return;
    try {
      saveOrUpsertProgress(
        { key: watchKey, ...(libraryEntryRef.current || {}) },
        Number(el.currentTime) || 0,
        Number.isFinite(Number(el.duration)) ? Number(el.duration) : 0,
      );
    } catch {}
  }, [watchKey]);

  const progressWriter = useMemo(
    () =>
      createProgressWriter({
        onChange: ({ progress, duration: total }) => {
          if (!persistRef.current || !watchKey || playingLive(videoRef.current)) return;
          try {
            saveOrUpsertProgress({ key: watchKey, ...(libraryEntryRef.current || {}) }, progress, total);
          } catch {}
        },
      }),
    [watchKey],
  );

  // ------------------------------------------------------------ media actions
  const setVolume = useCallback((value) => {
    const el = videoRef.current;
    const next = clamp(value, 1, 0, 1);
    if (el) {
      el.volume = next;
      if (next > 0 && el.muted) el.muted = false;
    }
    setPref('volume', next);
    if (el) setPref('muted', Boolean(el.muted));
  }, [setPref]);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setPref('muted', el.muted);
  }, [setPref]);

  const setRate = useCallback((value) => {
    const el = videoRef.current;
    const next = clamp(value, 1, 0.25, 16);
    if (el) el.playbackRate = next;
    setPref('rate', next);
  }, [setPref]);

  const nudgeRate = useCallback((delta) => {
    const current = Number(videoRef.current?.playbackRate) || 1;
    setRate(Math.round((current + delta) * 100) / 100);
  }, [setRate]);

  /** Brightness is a CSS filter on the element — the only browser-legal knob. */
  const setBrightness = useCallback((value) => {
    const el = videoRef.current;
    const next = clamp(value, 1, 0.15, 1);
    setPref('brightness', next);
    if (el) el.style.filter = next >= 0.999 ? '' : `brightness(${next.toFixed(2)})`;
  }, [setPref]);

  const nudgeBrightness = useCallback((delta) => {
    setBrightness((Number(prefsRef.current.brightness) || 1) + delta);
  }, [setBrightness]);

  const seekTo = useCallback((target) => {
    const el = videoRef.current;
    if (!el) return false;
    const asked = Number(target);
    const clamped = clampSeekTarget(el, asked, { coarse: coarseSeekRef.current });
    if (clamped === null) return false;
    if (coarseSeekRef.current && Number.isFinite(asked) && Math.abs(clamped - asked) > 1) {
      commitStatus('ready', 'The browser cannot jump ahead in this file — the seek stayed inside what it has read.');
    }
    try {
      el.currentTime = clamped;
      setTime(clamped);
      lastPositionRef.current = clamped;
      // Give the fetch a chance before any recovery may fire (see SEEK_GRACE_MS).
      seekGraceUntilRef.current = Date.now() + SEEK_GRACE_MS;
      seekVerifyRef.current = { target: clamped, tries: 0, asked };
      return true;
    } catch {
      return false;
    }
  }, [commitStatus]);

  const seekBy = useCallback((delta) => {
    const el = videoRef.current;
    if (!el) return false;
    return seekTo((Number(el.currentTime) || 0) + Number(delta));
  }, [seekTo]);

  /** Frame step. Without keyframe indexing the honest granularity is 1/30 s. */
  const stepFrame = useCallback((direction) => {
    const el = videoRef.current;
    if (!el) return false;
    if (!el.paused) el.pause?.();
    return seekTo((Number(el.currentTime) || 0) + (direction > 0 ? 1 : -1) * (1 / 30));
  }, [seekTo]);

  const jumpToPercent = useCallback((percent) => {
    const win = readSeekWindow(videoRef.current);
    if (!win) return false;
    return seekTo(win.start + (clamp(percent, 0, 0, 100) / 100) * (win.end - win.start));
  }, [seekTo]);

  const play = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    userWantsPlayRef.current = true;
    try {
      el.play?.()?.catch?.(() => {});
    } catch {}
  }, []);

  const pause = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    userWantsPlayRef.current = false;
    try {
      el.pause?.();
    } catch {}
    flushProgress();
  }, [flushProgress]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) play();
    else pause();
  }, [play, pause]);

  /** The chrome calls this on the first real gesture to restore sound. */
  const unmuteAfterGesture = useCallback(() => {
    const el = videoRef.current;
    if (!el || !autoplayMutedRef.current) return false;
    el.muted = false;
    autoplayMutedRef.current = false;
    setPrefs((current) => ({ ...current, muted: false }));
    return true;
  }, []);

  const setScrubbing = useCallback((active, value) => {
    scrubbingRef.current.active = Boolean(active);
    if (active) scrubbingRef.current.value = Number(value) || 0;
  }, []);

  // ------------------------------------------------------------ subtitles
  const applySubtitlePayload = useCallback((payload) => {
    const el = videoRef.current;
    const player = playerRef.current;
    if (!payload?.url) return;
    if (player?.addTextTrackAsync) {
      player
        .addTextTrackAsync(payload.url, payload.lang || 'en', 'subtitles', 'text/vtt', undefined, `jash:${payload.label}`)
        .catch(() => {});
      return;
    }
    try {
      for (const child of Array.from(el?.querySelectorAll?.('track') || [])) {
        if (String(child.label || '').startsWith('jash:')) child.remove?.();
      }
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = `jash:${payload.label}`;
      track.srclang = payload.lang || 'en';
      track.src = payload.url;
      track.default = true;
      el?.appendChild?.(track);
      const created = el?.textTracks?.[el.textTracks.length - 1];
      if (created) created.mode = 'showing';
    } catch {}
  }, []);

  /**
   * Rebuild the cue blob from the ORIGINAL text so repeated delay nudges can
   * never drift cumulatively.
   */
  const applySubtitleDelay = useCallback((track) => {
    if (!track?.vtt) return track;
    try {
      URL.revokeObjectURL?.(track.appliedUrl);
    } catch {}
    const delayMs = Number(prefsRef.current.subtitleDelayMs) || 0;
    if (!delayMs) return { ...track, appliedUrl: track.baseUrl || track.url };
    const shifted = shiftVttCues(track.vtt, delayMs);
    const appliedUrl =
      typeof Blob !== 'undefined' && URL.createObjectURL
        ? URL.createObjectURL(new Blob([shifted], { type: 'text/vtt' }))
        : track.baseUrl || track.url;
    return { ...track, appliedUrl, url: appliedUrl };
  }, []);

  const addExternalSubtitle = useCallback(
    (fileLike, text) => {
      const created = createSubtitleTrack(fileLike, text);
      if (!created?.ok) return { ok: false, reason: created?.reason || 'That subtitle file could not be read.' };
      releaseSubtitleTrack(externalSubtitleRef.current);
      const next = applySubtitleDelay({ ...created, baseUrl: created.url });
      externalSubtitleRef.current = next;
      setExternalSubtitle(next);
      applySubtitlePayload(next);
      return { ok: true, label: next.label };
    },
    [applySubtitleDelay, applySubtitlePayload],
  );

  const reapplySubtitle = useCallback(() => {
    const current = externalSubtitleRef.current;
    if (!current) return;
    const next = applySubtitleDelay(current);
    externalSubtitleRef.current = next;
    setExternalSubtitle(next);
    applySubtitlePayload(next);
  }, [applySubtitleDelay, applySubtitlePayload]);

  const removeExternalSubtitle = useCallback(() => {
    releaseSubtitleTrack(externalSubtitleRef.current);
    externalSubtitleRef.current = null;
    setExternalSubtitle(null);
    const el = videoRef.current;
    try {
      for (const child of Array.from(el?.querySelectorAll?.('track') || [])) {
        if (String(child.label || '').startsWith('jash:')) child.remove?.();
      }
      for (const track of Array.from(el?.textTracks || [])) {
        if (String(track.label || '').startsWith('jash:')) track.mode = 'hidden';
      }
    } catch {}
  }, []);

  /**
   * Subtitle delay shifts the cue timings (see shiftVttCues) rather than the
   * player clock, so it works for both engines. Embedded manifest tracks have
   * no cue text we can rewrite, so the chrome reports the control as
   * unavailable for those instead of silently doing nothing.
   */
  const shiftSubtitleDelay = useCallback(
    (deltaMs) => {
      const next = clamp((Number(prefsRef.current.subtitleDelayMs) || 0) + Number(deltaMs), 0, -15_000, 15_000);
      setPref('subtitleDelayMs', next);
      if (externalSubtitleRef.current) reapplySubtitle();
      return next;
    },
    [reapplySubtitle, setPref],
  );

  const subtitleCss = useMemo(
    () =>
      subtitleStyleToCss({
        scale: prefs.subtitleScale,
        background: prefs.subtitleBackground,
        outline: prefs.subtitleOutline,
      }),
    [prefs.subtitleScale, prefs.subtitleBackground, prefs.subtitleOutline],
  );

  const nudgeSubtitleScale = useCallback(
    (delta) => {
      const next = clamp((Number(prefsRef.current.subtitleScale) || 1) + delta, 1, 0.6, 2.4);
      setPref('subtitleScale', Math.round(next * 100) / 100);
    },
    [setPref],
  );

  const selectTextTrack = useCallback((id) => {
    const el = videoRef.current;
    const player = playerRef.current;
    if (player?.setTextTrack) {
      try {
        player.setTextTrack(id === null || id === undefined || id < 0 ? -1 : Number(id));
        return;
      } catch {}
    }
    try {
      Array.from(el?.textTracks || []).forEach((track, index) => {
        if (String(track.label || '').startsWith('jash:')) return;
        track.mode = index === Number(id) ? 'showing' : 'disabled';
      });
    } catch {}
  }, []);

  const cycleCaptions = useCallback(() => {
    const el = videoRef.current;
    const list = Array.from(el?.textTracks || []).filter((track) => ['subtitles', 'captions'].includes(track.kind));
    if (!list.length) return false;
    const currentIndex = list.findIndex((track) => track.mode === 'showing');
    const next = currentIndex === -1 ? 0 : currentIndex + 1 >= list.length ? -1 : currentIndex + 1;
    list.forEach((track, index) => {
      track.mode = index === next ? 'showing' : 'disabled';
    });
    return true;
  }, []);

  // ------------------------------------------------------------- quality/audio
  const applyQualityLock = useCallback((height) => {
    const player = playerRef.current;
    if (!player?.getVariantTracks) return;
    try {
      if (!height) {
        player.configure('abr.enabled', true);
        return;
      }
      const variants = (player.getVariantTracks() || []).filter((track) => track.type === 'variant');
      const matching = variants.filter((track) => Number(track.height) === Number(height));
      if (!matching.length) {
        player.configure('abr.enabled', true);
        return;
      }
      player.configure('abr.enabled', false);
      player.selectVariantTrack(matching.find((track) => track.active) || matching[0], true);
    } catch {}
  }, []);

  const selectQualityHeight = useCallback((height) => {
    setPref('qualityAuto', !height);
    setPref('qualityHeight', Number(height) || 0);
    applyQualityLock(Number(height) || 0);
  }, [applyQualityLock, setPref]);

  const setAutoQuality = useCallback(() => {
    setPref('qualityAuto', true);
    setPref('qualityHeight', 0);
    try {
      playerRef.current?.configure?.('abr.enabled', true);
    } catch {}
  }, [setPref]);

  const selectAudioLanguage = useCallback((language) => {
    setPref('audioLanguage', language || '');
    try {
      playerRef.current?.selectAudioLanguage?.(language || undefined);
    } catch {}
  }, [setPref]);

  const cycleAudioTrack = useCallback(() => {
    const list = tracks.audio || [];
    if (!list.length) return false;
    const current = String(prefsRef.current.audioLanguage || '');
    const index = list.findIndex((track) => track.language === current);
    const next = list[(index + 1) % list.length];
    if (next?.language) selectAudioLanguage(next.language);
    return true;
  }, [selectAudioLanguage, tracks.audio]);

  const cycleQuality = useCallback(() => {
    const heights = [...new Set((tracks.video || []).map((track) => Number(track.height)).filter(Boolean))].sort((a, b) => b - a);
    if (!heights.length) return false;
    const current = Number(prefsRef.current.qualityHeight) || 0;
    if (prefsRef.current.qualityAuto || !current) {
      selectQualityHeight(heights[0]);
      return true;
    }
    const index = heights.indexOf(current);
    if (index >= 0 && index < heights.length - 1) selectQualityHeight(heights[index + 1]);
    else setAutoQuality();
    return true;
  }, [selectQualityHeight, setAutoQuality, tracks.video]);

  // ------------------------------------------------------------------- destroy
  const destroyPlayer = useCallback(async () => {
    const player = playerRef.current;
    playerRef.current = null;
    if (!player) return;
    try {
      await player.unload?.();
    } catch {}
    try {
      player.detach?.();
    } catch {}
    try {
      await player.destroy?.();
    } catch {}
  }, []);

  // ------------------------------------------------------------------- load
  const attach = useCallback(async ({ reason = 'initial', urlOverride = '', dropDrm = false, forceRefresh = false } = {}) => {
    const el = videoRef.current;
    const activePolicy = policyRef.current;
    if (!el) {
      commitStatus('idle', 'Waiting for the video element.');
      return;
    }
    if (!activePolicy?.resolve) {
      commitStatus('idle', 'No playback policy supplied.');
      return;
    }

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    loadTokenRef.current += 1;
    loadStartedAtRef.current = Date.now();
    window.clearTimeout(timeoutRef.current);

    const carriedSeek = pendingSeekRef.current;
    pendingSeekRef.current = null;

    stallSamplesRef.current = 0;
    lastSampleTimeRef.current = Number(el.currentTime) || 0;
    // Evidence is per-source, not per-reload: a recovery attempt on the same URL must keep the refusal
    // (otherwise the ladder and the seek fight each other forever), while a new source starts clean.
    if (reason === 'initial' && coarseSeekRef.current) {
      coarseSeekRef.current = false;
      coarseSeekHoldRef.current = 0;
      setSeekRefused(false);
    }
    setErrorInfo(null);
    setAttemptNote('');
    commitStatus(reason === 'initial' ? 'loading' : 'recovering', reason === 'initial' ? 'Loading stream…' : 'Recovering…');

    await destroyPlayer();
    if (!isAlive(generation)) return;

    try {
      el.pause?.();
      el.removeAttribute?.('src');
      el.load?.();
    } catch {}

    let source = null;
    try {
      source = await activePolicy.resolve({ force: forceRefresh, reason });
    } catch (resolveError) {
      if (!isAlive(generation)) return;
      const mapped = mapPlaybackError(resolveError, { offline: offlineRef.current });
      setErrorInfo(mapped);
      commitStatus('error', mapped.message);
      try {
        handlersRef.current.onError?.(mapped);
      } catch {}
      return;
    }
    if (!isAlive(generation)) return;

    const url = String(urlOverride || fallbacksRef.current.forceUrl || source.url || '');
    if (!url) {
      const mapped = { kind: 'unknown', message: 'No playable URL was resolved for this source.', retriable: false, action: 'none' };
      setErrorInfo(mapped);
      commitStatus('error', mapped.message);
      return;
    }

    const kind = source.kind && source.kind !== 'auto' ? source.kind : detectKind(url);
    const useShaka = needsEngine(url, kind, { allowNativeHls: allowNativeHlsRef.current });
    const suppliedDrm = dropDrm ? {} : source.drm || {};
    const hasDrm = Boolean(suppliedDrm?.clearKeys && Object.keys(suppliedDrm.clearKeys).length) || Boolean(suppliedDrm?.servers);
    activePolicy.lastDrm = hasDrm;

    if (source.crossOrigin) el.setAttribute('crossOrigin', source.crossOrigin);
    else el.removeAttribute?.('crossOrigin');

    try {
      if (useShaka) {
        const shaka = await loadShaka();
        if (!isAlive(generation)) return;
        if (activePolicy.needsMuxjs) await ensureMuxjs();
        if (!shaka.Player?.isBrowserSupported?.()) {
          const mapped = { kind: 'codec', message: 'This browser cannot play adaptive streams (no MediaSource support).', retriable: false, action: 'rotate-source' };
          setErrorInfo(mapped);
          commitStatus('error', mapped.message);
          return;
        }

        const player = new shaka.Player();
        playerRef.current = player;
        await player.attach(el);
        if (!isAlive(generation)) {
          await destroyPlayer();
          return;
        }

        player.configure({
          ...(activePolicy.playerConfig || {
            streaming: { bufferingGoal: 20, rebufferingGoal: 3 },
            abr: { enabled: true, defaultBandwidthEstimate: 1_200_000 },
          }),
          drm: suppliedDrm,
        });
        if (!prefsRef.current.qualityAuto) player.configure('abr.enabled', false);

        const engine = player.getNetworkingEngine?.();
        if (engine) {
          engine.clearAllRequestFilters();
          engine.clearAllResponseFilters();
          if (source.http?.requestFilter) engine.registerRequestFilter((type, request) => source.http.requestFilter(type, request, { shaka, url, source, kind }));
          if (source.http?.responseFilter) engine.registerResponseFilter((type, response) => source.http.responseFilter(type, response, { shaka, url, source, kind }));
        }

        player.addEventListener?.('error', (event) => {
          if (!isAlive(generation)) return;
          failureRef.current?.(mapPlaybackError(event?.detail, { offline: offlineRef.current }), 'engine');
        });
        player.addEventListener?.('trackschanged', () => {
          if (isAlive(generation)) refreshTracks();
        });
        player.addEventListener?.('variantchanged', () => {
          if (isAlive(generation)) refreshTracks();
        });
        player.addEventListener?.('buffering', (event) => {
          if (!isAlive(generation)) return;
          if (event?.buffering) stallSamplesRef.current = Math.max(stallSamplesRef.current, STALL_SAMPLES);
          else stallSamplesRef.current = 0;
          setStatus((current) => {
            if (event?.buffering) return current === 'ready' ? 'buffering' : current;
            return current === 'buffering' || current === 'recovering' ? 'ready' : current;
          });
        });

        await player.load(url, undefined, source.mimeType || mimeTypeFor(kind));
      } else {
        el.src = url;
        el.load?.();
      }
    } catch (loadError) {
      if (!isAlive(generation)) return;
      failureRef.current?.(mapPlaybackError(loadError, { offline: offlineRef.current }), 'load');
      return;
    }
    if (!isAlive(generation)) return;

    const timeoutMs = Number(activePolicy.loadTimeoutMs || DEFAULT_LOAD_TIMEOUT_MS);
    timeoutRef.current = window.setTimeout(() => {
      if (!isAlive(generation)) return;
      if ((videoRef.current?.readyState ?? 0) >= 2) return;
      failureRef.current?.(
        { kind: 'timeout', code: 'LOAD_TIMEOUT', message: `This source did not start within ${Math.round(timeoutMs / 1000)}s.`, retriable: true, action: 'rotate-source' },
        'timeout',
      );
    }, timeoutMs);

    el.volume = clamp(prefsRef.current.volume, 1, 0, 1);
    el.muted = false;
    if (Number(prefsRef.current.rate) !== 1) el.playbackRate = clamp(prefsRef.current.rate, 1, 0.25, 16);
    if (Number(prefsRef.current.brightness) < 1) el.style.filter = `brightness(${Number(prefsRef.current.brightness).toFixed(2)})`;

    commitStatus('ready', '');
    setAttemptNote('');
    refreshModel();
    refreshTracks();

    if (userWantsPlayRef.current) {
      try {
        el.play?.()?.then?.(() => {
          window.clearTimeout(timeoutRef.current);
        })?.catch?.((err) => {
          if (!isAlive(generation)) return;
          const mapped = mapPlaybackError(err, { offline: offlineRef.current });
          if (mapped.kind === 'autoplay') {
            // Single owner of the muted bootstrap.
            autoplayMutedRef.current = true;
            el.muted = true;
            el.play?.()?.catch?.(() => {});
            setPrefs((current) => ({ ...current, muted: true }));
          }
        });
      } catch {}
    }

    const applyResume = () => {
      if (!isAlive(generation)) return;
      if (carriedSeek != null) {
        pendingSeekRef.current = null;
        seekTo(carriedSeek);
        return;
      }
      if (resumeAppliedRef.current) return;
      resumeAppliedRef.current = true;
      const win = readSeekWindow(el);
      const liveNow = derivePlaybackModel(el).live;
      if (!resumeEnabledRef.current || !watchKey || liveNow) return;
      // The user said "never for this title" — start from 0, keep persisting.
      if (isResumeSuppressed(watchKey)) return;
      const saved = getHistoryEntry(watchKey);
      const plan = planResume(saved, win);
      if (plan.seek) {
        seekTo(plan.target);
        setResumePrompt({ seconds: Math.round(plan.target - (win?.start || 0)), auto: true });
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = window.setTimeout(() => setResumePrompt((current) => (current?.auto ? null : current)), 7000);
      } else if (saved?.progress > 0 && plan.reason !== 'finished') {
        setResumePrompt({ seconds: Math.round(saved.progress), auto: false, reason: plan.reason });
        window.clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = window.setTimeout(() => setResumePrompt((current) => (current?.auto ? null : current)), 8000);
      }
    };
    if (el.readyState >= 1) applyResume();
    else el.addEventListener?.('loadedmetadata', applyResume, { once: true });

    if (enableSubtitlesRef.current && externalSubtitleRef.current) reapplySubtitle();
    if (!prefsRef.current.qualityAuto) applyQualityLock(prefsRef.current.qualityHeight);

    ladderRef.current = { rungIndex: -1, counts: {}, startedAt: 0, reloadAttempts: 0 };
  }, [
    applyQualityLock,
    commitStatus,
    destroyPlayer,
    isAlive,
    refreshModel,
    refreshTracks,
    reapplySubtitle,
    seekTo,
    watchKey,
  ]);

  // ------------------------------------------------------------- recovery
  const handleFailure = useCallback((mapped, origin = 'error') => {
    const el = videoRef.current;
    const activePolicy = policyRef.current;
    void origin;

    if (!mapped?.retriable) {
      setErrorInfo(mapped);
      commitStatus('error', mapped.message);
      try {
        handlersRef.current.onError?.(mapped);
        handlersRef.current.onFatal?.(mapped);
      } catch {}
      return;
    }

    // A seek into a byte range the browser has not downloaded yet stops
    // `currentTime` without breaking the element — which is what the stall
    // watchdog reads as a dead player. Reloading there is what restarted the file
    // at 0:00, so hold instead: buffering stays visible and the counter is parked
    // one sample short, so the next tick asks again. Once `el.seeking` clears and
    // the grace window expires (SEEK_GRACE_MS after the last commanded seek), the
    // ladder below runs normally — a real stall is delayed, never excused.
    if (el && mapped.kind === 'stall' && (el.seeking || Date.now() < seekGraceUntilRef.current)) {
      commitStatus('buffering', mapped.message);
      setAttemptNote('Waiting for that part of the file to download…');
      stallSamplesRef.current = FATAL_STALL_SAMPLES - 1;
      return;
    }

    const state = ladderRef.current;
    if (!state.startedAt) state.startedAt = Date.now();

    const ladder = activePolicy?.ladder || DEFAULT_LADDER;
    const live = derivePlaybackModel(el).live;
    const caps = capabilitiesFor({
      engine: playerRef.current,
      url: el?.currentSrc || el?.src,
      hasDrm: !dropDrmRef.current && Boolean(activePolicy?.lastDrm),
      fallbackUrls: fallbacksRef.current.urls,
      live,
      model: { live, canSeek: derivePlaybackModel(el).canSeek },
      error: mapped,
      seeking: Boolean(el?.seeking) || Date.now() < seekGraceUntilRef.current || Date.now() < coarseSeekHoldRef.current,
    });
    caps.hasPolicyRecovery = typeof activePolicy?.recover === 'function' && Boolean(activePolicy.hasRecovery?.());
    if (isDrmConfigError(mapped) && !dropDrmRef.current) caps.hasDrm = true;

    const action = nextRecoveryAction(
      {
        rungIndex: state.rungIndex,
        attemptCounts: state.counts,
        startedAt: state.startedAt,
        now: Date.now(),
        reloadAttempts: state.reloadAttempts,
        maxLadderMs: activePolicy?.maxLadderMs,
      },
      caps,
      ladder,
    );

    if (!action) {
      setErrorInfo(mapped);
      commitStatus('error', mapped.message);
      try {
        handlersRef.current.onError?.(mapped);
        handlersRef.current.onFatal?.(mapped);
      } catch {}
      return;
    }

    state.counts[action.rung] = (state.counts[action.rung] || 0) + 1;
    if (action.rung === RUNGS.RELOAD) state.reloadAttempts += 1;
    const ladderIndex = ladder.indexOf(action.rung);
    if (ladderIndex >= 0) state.rungIndex = ladderIndex;

    commitStatus('recovering', action.message);
    setAttemptNote(action.message);
    if (action.hold) return;

    window.setTimeout(async () => {
      try {
        if (action.positionPreserved && el) {
          // Prefer the live position, then the last position we commanded, then
          // whatever a previous rung already parked. `el.currentTime` is 0 right
          // after the browser gave up on a seek, so it cannot be the only source.
          const keep = Number(el.currentTime) || lastPositionRef.current || Number(pendingSeekRef.current) || 0;
          if (keep > 1 || live) pendingSeekRef.current = keep;
        }

        switch (action.rung) {
          case RUNGS.RETRY_STREAMING:
            await playerRef.current?.retryStreaming?.();
            stallSamplesRef.current = 0;
            commitStatus('ready', '');
            break;
          case RUNGS.REANCHOR: {
            const win = readSeekWindow(el);
            if (win && (win.end - win.start) > 10 && derivePlaybackModel(el).live) seekTo(win.end - 3);
            else seekBy(-2);
            stallSamplesRef.current = 0;
            commitStatus('ready', '');
            break;
          }
          case RUNGS.DROP_DRM:
            dropDrmRef.current = true;
            await attach({ reason: 'drop-drm', dropDrm: true });
            break;
          case RUNGS.ROTATE_SOURCE: {
            const urls = fallbacksRef.current.urls || [];
            const nextIndex = (fallbacksRef.current.index + 1) % Math.max(1, urls.length);
            try {
              handlersRef.current.onRotateFallback?.(nextIndex, urls[nextIndex]);
            } catch {}
            await attach({ reason: 'rotate', urlOverride: urls[nextIndex] || '' });
            break;
          }
          case RUNGS.POLICY_RECOVER: {
            const recovered = await policyRef.current?.recover?.({ error: mapped });
            if (recovered?.message) setAttemptNote(recovered.message);
            await attach({ reason: 'policy', forceRefresh: recovered?.retry === 'reload' });
            break;
          }
          case RUNGS.RELOAD:
          default:
            await attach({ reason: 'reload' });
            break;
        }
      } catch {}
    }, action.delayMs || 0);
  }, [attach, commitStatus, seekBy, seekTo]);

  failureRef.current = handleFailure;

  const retry = useCallback(() => {
    dropDrmRef.current = false;
    resumeAppliedRef.current = false;
    ladderRef.current = { rungIndex: -1, counts: {}, startedAt: 0, reloadAttempts: 0 };
    attach({ reason: 'retry' });
  }, [attach]);

  const reload = useCallback(() => {
    attach({ reason: 'manual-reload' });
  }, [attach]);

  const rotateFallback = useCallback((index) => {
    const urls = fallbacksRef.current.urls || [];
    const url = urls[index];
    if (!url) return;
    const el = videoRef.current;
    if (el) pendingSeekRef.current = Number(el.currentTime) || 0;
    try {
      handlersRef.current.onRotateFallback?.(index, url);
    } catch {}
    attach({ reason: 'manual-source', urlOverride: url });
  }, [attach]);

  /** Switch to a brand new source (episode / channel change). */
  const switchSource = useCallback(({ keepPosition = false } = {}) => {
    const el = videoRef.current;
    if (keepPosition && el) pendingSeekRef.current = Number(el.currentTime) || 0;
    resumeAppliedRef.current = keepPosition;
    dropDrmRef.current = false;
    attach({ reason: keepPosition ? 'switch-keep' : 'switch' });
  }, [attach]);

  const toggleStats = useCallback(() => {
    const next = !showStats;
    setPref('showStats', next);
    setShowStats(next);
  }, [setPref, showStats]);

  // --------------------------------------------------- element listeners (once)
  useEffect(() => {
    const el = videoEl;
    if (!el) return undefined;
    resumeAppliedRef.current = false;
    stallSamplesRef.current = 0;
    lastSampleTimeRef.current = Number(el.currentTime) || 0;

    const markHealthy = () => {
      stallSamplesRef.current = 0;
      ladderRef.current = { rungIndex: -1, counts: {}, startedAt: 0, reloadAttempts: 0 };
      setAttemptNote('');
      window.clearTimeout(timeoutRef.current);
    };

    const onPlay = () => {
      userWantsPlayRef.current = true;
      setPlaying(true);
      setStatus((current) => (current === 'buffering' || current === 'recovering' || current === 'loading' || current === 'error' ? 'ready' : current));
    };
    const onPause = () => {
      setPlaying(false);
      setStatus((current) => (current === 'buffering' && userWantsPlayRef.current ? current : current === 'ready' ? 'ready' : current));
      flushProgress();
    };
    const onWaiting = () => {
      stallSamplesRef.current = Math.max(stallSamplesRef.current, STALL_SAMPLES);
      setStatus((current) => (current === 'ready' || current === 'loading' ? 'buffering' : current));
    };
    const onPlaying = () => {
      markHealthy();
      setPlaying(true);
      setStatus((current) => (current === 'buffering' || current === 'recovering' || current === 'loading' ? 'ready' : current));
    };
    const onCanPlay = () => {
      setStatus((current) => (current === 'loading' || current === 'buffering' ? 'ready' : current));
      refreshModel();
    };
    const onTimeUpdate = () => {
      if (!scrubbingRef.current.active) setTime(Number(el.currentTime) || 0);
      progressWriter.tick(el);
      refreshModel();
    };
    const onDurationChange = () => {
      const next = Number(el.duration);
      setDuration(Number.isFinite(next) ? next : 0);
      refreshModel();
    };
    const onProgress = () => {
      try {
        if (el.buffered?.length) setBufferedEnd(Number(el.buffered.end(el.buffered.length - 1)) || 0);
      } catch {}
    };
    const onVolumeChange = () => setPrefs((current) => ({ ...current, volume: Number(el.volume) || 0, muted: Boolean(el.muted) }));
    const onRateChange = () => setPrefs((current) => ({ ...current, rate: Number(el.playbackRate) || 1 }));
    const onEnded = () => {
      flushProgress();
      setPlaying(false);
      commitStatus('ended', '');
      try {
        handlersRef.current.onEnded?.();
      } catch {}
    };
    const onSeeked = () => {
      refreshModel();
      // The seek landed; from here a lack of progress is a real stall again.
      stallSamplesRef.current = Math.min(stallSamplesRef.current, STALL_SAMPLES);
      const verify = seekVerifyRef.current;
      if (!verify) return;
      const landed = Number(el.currentTime) || 0;
      const model = derivePlaybackModel(el);
      const missed = Math.abs(landed - verify.target) > 1.5;
      if (missed && verify.tries >= 1 && !coarseSeekRef.current && !model.live) {
        coarseSeekRef.current = true;
        setSeekRefused(true);
        // Hold the recovery ladder while playback continues from wherever the file actually is. A
        // reload re-opens the file, which is exactly the "starts from 0" complaint — so the ladder has
        // to be told that this particular pause is explained rather than fatal.
        coarseSeekHoldRef.current = Date.now() + 20_000;
        commitStatus('ready', 'No usable seek index for the browser: long jumps would re-read the file, so seeks stay inside what has downloaded.');
        seekVerifyRef.current = null;
        return;
      }
      if (!model.live && missed && verify.tries < 1 && verify.target < (Number(el.duration) || Infinity) - 1) {
        // We asked for X and the element reported Y — it refused the range rather
        // than finishing the seek. Push it once more before anything else decides
        // the file is broken (that decision is what used to restart playback).
        verify.tries += 1;
        seekGraceUntilRef.current = Date.now() + SEEK_GRACE_MS;
        try {
          el.currentTime = clampToSeekWindow(el, verify.target);
        } catch {
          seekVerifyRef.current = null;
        }
        return;
      }
      seekVerifyRef.current = null;
    };
    const onError = () => {
      if (!el.error) return;
      failureRef.current?.(mapPlaybackError(el.error, { offline: offlineRef.current }), 'element');
    };

    const events = {
      play: onPlay,
      pause: onPause,
      waiting: onWaiting,
      playing: onPlaying,
      canplay: onCanPlay,
      timeupdate: onTimeUpdate,
      durationchange: onDurationChange,
      progress: onProgress,
      volumechange: onVolumeChange,
      ratechange: onRateChange,
      ended: onEnded,
      seeked: onSeeked,
      error: onError,
    };
    for (const [name, handler] of Object.entries(events)) el.addEventListener?.(name, handler);

    // One sampler: progress-based stall detection + smooth clock + stats.
    const sampler = window.setInterval(() => {
      const current = Number(el.currentTime) || 0;
      if (!scrubbingRef.current.active) setTime(current);

      if (userWantsPlayRef.current && !el.paused && !el.ended) {
        const advanced = current - lastSampleTimeRef.current;
        if (advanced > 0.05) {
          lastPositionRef.current = current;
          // Playing again: the seek landed, so stop granting it protection.
          seekGraceUntilRef.current = 0;
          seekVerifyRef.current = null;
          if (stallSamplesRef.current >= STALL_SAMPLES) {
            markHealthy();
            setStatus((state) => (state === 'buffering' ? 'ready' : state));
          }
          stallSamplesRef.current = 0;
        } else {
          stallSamplesRef.current += 1;
          if (stallSamplesRef.current === STALL_SAMPLES) {
            setStatus((state) => (state === 'ready' || state === 'loading' ? 'buffering' : state));
          }
          if (stallSamplesRef.current === FATAL_STALL_SAMPLES) {
            failureRef.current?.(
              {
                kind: 'stall',
                code: 'STALL',
                message: 'Playback stalled — the stream stopped delivering data.',
                retriable: true,
                action: 'rotate-source',
              },
              'watchdog',
            );
          }
        }
      }
      lastSampleTimeRef.current = current;
    }, WATCHDOG_MS);

    // Browsers fire timeupdate only ~4x/s, so a 250 ms sample keeps the scrubber
    // from stepping. (Stats sampling has its own 1 Hz loop in the stats effect.)
    const clock = window.setInterval(() => {
      if (!scrubbingRef.current.active) setTime(Number(el.currentTime) || 0);
    }, TIME_TICK_MS);

    return () => {
      for (const [name, handler] of Object.entries(events)) el.removeEventListener?.(name, handler);
      window.clearInterval(sampler);
      window.clearInterval(clock);
    };
  }, [commitStatus, flushProgress, progressWriter, refreshModel, videoEl]);

  // ----------------------------------------------------------- lifecycle sync
  useEffect(() => {
    if (typeof document === 'undefined' && typeof window === 'undefined') return undefined;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
        const live = derivePlaybackModel(videoRef.current).live;
        if (live && !suspendedRef.current) {
          suspendedRef.current = true;
          generationRef.current += 1;
          void destroyPlayer();
        }
        return;
      }
      if (suspendedRef.current) {
        suspendedRef.current = false;
        attach({ reason: 'foreground' });
      }
    };
    const onPageHide = () => flushProgress();
    const onOnline = () => {
      if (!offlineRef.current) return;
      offlineRef.current = false;
      setStatus((current) => {
        if (current === 'error' || current === 'recovering') {
          attach({ reason: 'online' });
          return 'loading';
        }
        return current;
      });
    };
    const onOffline = () => {
      offlineRef.current = true;
    };

    document.addEventListener?.('visibilitychange', onVisibility);
    window.addEventListener?.('pagehide', onPageHide);
    window.addEventListener?.('online', onOnline);
    window.addEventListener?.('offline', onOffline);
    return () => {
      document.removeEventListener?.('visibilitychange', onVisibility);
      window.removeEventListener?.('pagehide', onPageHide);
      window.removeEventListener?.('online', onOnline);
      window.removeEventListener?.('offline', onOffline);
    };
  }, [attach, destroyPlayer, flushProgress]);

  // ------------------------------------------------------- source transitions
  const signature = `${sourceKey}::${forceUrl}`;
  const lastSignatureRef = useRef(null);
  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    dropDrmRef.current = false;
    resumeAppliedRef.current = false;
    attach({ reason: 'initial' });
    return () => {
      generationRef.current += 1;
      window.clearTimeout(timeoutRef.current);
      void destroyPlayer();
    };
  }, [attach, destroyPlayer, signature]);

  // ------------------------------------------------------------------- stats
  useEffect(() => {
    if (!showStats) {
      window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = 0;
      return undefined;
    }
    const sample = () => {
      const el = videoRef.current;
      const player = playerRef.current;
      let bufferedLead = 0;
      try {
        if (el?.buffered?.length) bufferedLead = Number(el.buffered.end(el.buffered.length - 1)) - (Number(el.currentTime) || 0);
      } catch {}
      const base = {
        engine: player ? 'shaka' : 'native',
        size: el?.videoWidth ? `${el.videoWidth}×${el.videoHeight}` : '—',
        readyState: el?.readyState ?? 0,
        networkState: el?.networkState ?? 0,
        bufferedLead,
        currentTime: Number(el?.currentTime) || 0,
        quality: el?.getVideoPlaybackQuality
          ? (() => {
              try {
                const q = el.getVideoPlaybackQuality();
                return { dropped: q.droppedVideoFrames || 0, total: q.totalVideoFrames || 0 };
              } catch {
                return null;
              }
            })()
          : null,
      };
      if (player?.getStats) {
        try {
          const s = player.getStats() || {};
          setStats({
            ...base,
            width: s.width,
            height: s.height,
            decoded: s.decodedFrames,
            dropped: s.droppedFrames,
            bandwidthKbps: Math.round((s.bandwidthEstimate || 0) / 1000),
            state: s.state,
            switchCount: (s.switchHistory || []).length,
          });
          return;
        } catch {}
      }
      setStats(base);
    };
    sample();
    statsTimerRef.current = window.setInterval(sample, 1000);
    return () => {
      window.clearInterval(statsTimerRef.current);
      statsTimerRef.current = 0;
    };
  }, [showStats]);

  // ------------------------------------------------------------ MediaSession
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !mediaSession?.title) return undefined;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: mediaSession.title,
        artist: mediaSession.artist || '',
        album: mediaSession.album || '',
        artwork: (mediaSession.artwork || [])
          .map((item) => ({ src: item.src || item.url, sizes: item.sizes, type: item.type }))
          .filter((item) => item.src),
      });
    } catch {}
    const handlers = {
      play: () => {
        userWantsPlayRef.current = true;
        videoRef.current?.play?.()?.catch?.(() => {});
      },
      pause: () => {
        userWantsPlayRef.current = false;
        videoRef.current?.pause?.();
      },
      seekbackward: () => seekBy(-10),
      seekforward: () => seekBy(10),
      seekto: (details) => seekTo(Number(details?.seekTime) || 0),
      previoustrack: () => {
        try {
          mediaSession.onPrev?.();
        } catch {}
      },
      nexttrack: () => {
        try {
          mediaSession.onNext?.();
        } catch {}
      },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {}
    }
    try {
      navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      const win = readSeekWindow(videoRef.current);
      if (navigator.mediaSession.setPositionState && win && win.end > win.start) {
        navigator.mediaSession.setPositionState({
          duration: win.end,
          playbackRate: Number(videoRef.current?.playbackRate) || 1,
          position: Math.min(Math.max(0, Number(videoRef.current?.currentTime) || 0), win.end),
        });
      }
    } catch {}
    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession?.setActionHandler?.(action, null);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSession?.title, mediaSession?.artist, playing, time]);

  // ------------------------------------------------------------------ return
  return {
    // element ownership
    setVideoRef,
    videoEl,
    // state
    status,
    statusMessage,
    attemptNote,
    errorInfo,
    playing,
    time,
    duration,
    bufferedEnd,
    model,
    prefs,
    tracks,
    activeVariantId,
    externalSubtitle,
    stats,
    showStats,
    resumePrompt,
    // controls
    play,
    pause,
    togglePlay,
    seekTo,
    seekBy,
    stepFrame,
    jumpToPercent,
    setVolume,
    toggleMute,
    setRate,
    nudgeRate,
    setBrightness,
    nudgeBrightness,
    unmuteAfterGesture,
    setScrubbing,
    flushProgress,
    setPref,
    // engine
    retry,
    reload,
    switchSource,
    rotateFallback,
    selectQualityHeight,
    setAutoQuality,
    selectAudioLanguage,
    cycleAudioTrack,
    cycleQuality,
    cycleCaptions,
    selectTextTrack,
    subtitleCss,
    nudgeSubtitleScale,
    addExternalSubtitle,
    removeExternalSubtitle,
    shiftSubtitleDelay,
    toggleStats,
    dismissResumePrompt: () => setResumePrompt(null),
    neverResume: () => {
      suppressResume(watchKey);
      resumeAppliedRef.current = true;
      setResumePrompt(null);
    },
    resumeFromPrompt: () => {
      const seconds = Number(resumePrompt?.seconds) || 0;
      resumeAppliedRef.current = true;
      setResumePrompt(null);
      seekTo(seconds);
    },
    startOver: () => {
      resumeAppliedRef.current = true;
      setResumePrompt(null);
      seekTo(0);
    },
    /**
     * True once the host has refused a seek twice. The bar uses it to show why the scrubber only
     * reaches as far as the download, instead of looking broken.
     */
    seekRefused,
  };
}

export default usePlaybackEngine;
