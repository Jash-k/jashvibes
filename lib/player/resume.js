/**
 * Resume + progress persistence for the unified player.
 *
 * Previously: the chrome showed a "Resumed from 12:34" toast but never sought
 * (the seek lived in each page), so /stremio-watch and /sports/player lied —
 * and /classics lacked /watch's finished-title guard. Both halves now come
 * from here, so no surface can have one without the other.
 */

export const RESUME_MIN_SECONDS = 20;
export const RESUME_END_MARGIN_SECONDS = 15;
export const FINISHED_RATIO = 0.95;
export const PERSIST_INTERVAL_MS = 5000;
/** Per-title opt-out from the resume toast/auto-seek (progress still persists). */
export const NEVER_RESUME_KEY = 'jash:player:never-resume';
const NEVER_RESUME_CAP = 200;

/**
 * Decide whether (and where) to seek on metadata load.
 *
 * @param {object} saved        { progress, duration } from the library store
 * @param {object} window       { start, end } from readSeekWindow(), may be null
 * @param {object} options      { forceSeek (user tapped Resume), min, margin }
 * @returns {{seek: boolean, target: number, reason: string}}
 */
export function planResume(saved = {}, window = null, options = {}) {
  const { forceSeek = false, min = RESUME_MIN_SECONDS, margin = RESUME_END_MARGIN_SECONDS } = options;
  const progress = Number(saved?.progress);
  if (!Number.isFinite(progress) || progress <= 0) return { seek: false, target: 0, reason: 'no-saved-position' };

  const duration = Number(window?.end - window?.start) > 0 ? Number(window.end - window.start) : Number(saved?.duration) || 0;
  const start = Number.isFinite(window?.start) ? Number(window.start) : 0;

  if (!forceSeek) {
    if (progress < min) return { seek: false, target: 0, reason: 'too-early' };
    // A near-complete title should replay from the top, not resume to a blank 5s.
    if (duration > 0 && progress >= duration * FINISHED_RATIO) return { seek: false, target: 0, reason: 'finished' };
    if (duration > 0 && progress > duration - margin && duration > margin * 2) return { seek: false, target: 0, reason: 'too-late' };
  }

  let target = start + progress;
  if (window && Number.isFinite(window.end)) target = Math.min(target, Math.max(start, window.end - 0.25));
  if (!Number.isFinite(target) || target < start) return { seek: false, target: 0, reason: 'out-of-window' };

  return { seek: true, target, reason: forceSeek ? 'user' : 'resume' };
}

/** Where the resume toast should say it resumed FROM (clamped for honesty). */
export function resumeToastValue(saved = {}, duration = 0) {
  const progress = Number(saved?.progress) || 0;
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  if (Number.isFinite(duration) && duration > 0) return Math.min(progress, Math.max(0, duration - 1));
  return progress;
}

/**
 * Throttled progress writer. Returns a `tick()` the engine calls from its
 * time loop, plus `flush()` for pagehide/visibilitychange/pause.
 */
export function createProgressWriter({ onChange, intervalMs = PERSIST_INTERVAL_MS, now = () => Date.now() }) {
  let lastWrite = 0;
  let pending = null;

  function readState(el) {
    const currentTime = Number(el?.currentTime) || 0;
    const duration = Number(el?.duration);
    return { currentTime, duration: Number.isFinite(duration) ? duration : 0 };
  }

  function tick(el) {
    const state = readState(el);
    if (!Number.isFinite(state.currentTime) || state.currentTime <= 0) return false;
    pending = state;
    if (now() - lastWrite < intervalMs) return false;
    return flush(el);
  }

  function flush(el) {
    const state = el ? readState(el) : pending;
    if (!state) return false;
    lastWrite = now();
    pending = null;
    onChange?.({ progress: Math.round(state.currentTime), duration: Math.round(state.duration || 0) });
    return true;
  }

  return { tick, flush, readState };
}

function defaultStore() {
  return typeof localStorage !== 'undefined' ? localStorage : null;
}

function readList(store) {
  try {
    const parsed = JSON.parse((store || defaultStore())?.getItem?.(NEVER_RESUME_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === 'string' && key) : [];
  } catch {
    return [];
  }
}

function writeList(store, list) {
  try {
    (store || defaultStore())?.setItem?.(NEVER_RESUME_KEY, JSON.stringify(list.slice(0, NEVER_RESUME_CAP)));
  } catch {}
}

/** The suppressed watch keys, most recent first (test/UI helper). */
export function readNeverResume(store) {
  return readList(store);
}

export function isResumeSuppressed(watchKey = '', store) {
  if (!watchKey) return false;
  return readList(store).includes(String(watchKey));
}

/**
 * Stop offering (and performing) a resume for one title. Deliberately does NOT
 * stop persistence: the row stays in Continue Watching, it just starts at 0.
 */
export function suppressResume(watchKey = '', store) {
  const key = String(watchKey || '');
  if (!key) return readList(store);
  const next = [key, ...readList(store).filter((item) => item !== key)];
  writeList(store, next);
  return next;
}

/** Undo it (used by My List's "resume this title again" and by tests). */
export function clearResumeSuppression(watchKey = '', store) {
  const next = readList(store).filter((item) => item !== String(watchKey || ''));
  writeList(store, next);
  return next;
}
