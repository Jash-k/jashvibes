/**
 * Media-kind + seek-window primitives for the unified player.
 *
 * Pure module: no React, no DOM globals, no imports. Safe to unit-test in
 * plain Node (`tests/player-kind.test.js`) and safe to import from both the
 * engine and the chrome.
 */

const DIRECT_FILE_RX = /\.(mp4|webm|ogg|ogv|mp3|m4a|aac|opus|mkv|m4v|mov|avi|ts)(\?|#|%| |\/|$)/i;

export function isHlsUrl(url = '') {
  const lower = String(url || '').toLowerCase();
  return lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('/hls/');
}

export function isDashUrl(url = '') {
  return String(url || '').toLowerCase().includes('.mpd');
}

export function isDirectFileUrl(url = '') {
  return DIRECT_FILE_RX.test(String(url || ''));
}

/**
 * Resolve how a URL should be attached.
 * `streamType` is the hint the resolver API sends ('direct' | 'hls' | 'dash'
 * | 'video' | 'embed'); an explicit non-manifest hint still defers to a real
 * manifest URL, because Telegram/Stremio URLs sometimes carry both.
 */
export function detectKind(url = '', { streamType = '' } = {}) {
  if (isDashUrl(url)) return 'dash';
  if (isHlsUrl(url)) return 'hls';
  const hint = String(streamType || '').toLowerCase();
  if (hint === 'dash') return 'dash';
  if (hint === 'hls') return 'hls';
  if (hint === 'embed') return 'embed';
  return 'direct';
}

/**
 * Can this source be played by the custom <video> chrome at all?
 * 'embed' providers (iframe servers) are explicitly NOT playable here.
 */
export function isDirectPlayerSource(url = '', streamType = '') {
  const kind = detectKind(url, { streamType });
  if (kind === 'embed') return false;
  if (kind === 'hls' || kind === 'dash') return true;
  return isDirectFileUrl(url) || Boolean(url);
}

export function mimeTypeFor(kind = '') {
  if (kind === 'hls') return 'application/x-mpegurl';
  if (kind === 'dash') return 'application/dash+xml';
  return undefined;
}

export function nativeHlsSupported(doc = globalThis.document) {
  try {
    const probe = doc?.createElement?.('video');
    return Boolean(probe?.canPlayType?.('application/vnd.apple.mpegurl'));
  } catch {
    return false;
  }
}

/**
 * Does this source need Shaka?
 *   • DASH always (no browser ships native DASH)
 *   • HLS only when the browser has no native HLS (Safari has it)
 *   • plain files never — native is cheaper and keeps seeking/snapshots simple
 */
export function needsEngine(url = '', kind = detectKind(url), { allowNativeHls = true } = {}) {
  if (kind === 'dash') return true;
  if (kind === 'hls') return !(allowNativeHls && nativeHlsSupported());
  return false;
}

/**
 * The range it is legal to seek inside.
 *
 * Two different failures hide here, and they want opposite rules:
 *
 *  • A live-style manifest (Stremio add-ons sometimes emit `duration: Infinity`)
 *    has no timeline at all — multiplying by `duration` mis-targets and the
 *    stream jumps to 0. Those need the `seekable` range.
 *  • A plain file (a Telegram-hosted MP4/MKV) reports `seekable` as *what has
 *    been buffered so far*. Clamping to that, as this function used to do for
 *    every source, turns "seek to 58:00" into "seek to 4 s" — the exact
 *    "seeking restarts from 0" complaint on single-file streams, with no error
 *    and nothing to retry. A finite `duration` is the seek range for those,
 *    because the browser fetches the byte range on demand.
 *
 * So: `duration` wins whenever it is finite, and `seekable` only overrides it
 * when the window has actually slid forward (DVR trimming the head). Returns
 * null when neither exists, which is what "no scrubber" means.
 */
export function readSeekWindow(el) {
  if (!el) return null;
  const duration = Number(el.duration);
  const finiteDuration = Number.isFinite(duration) && duration > 0;
  let win = null;
  try {
    const range = el.seekable;
    if (range && range.length) {
      const start = Number(range.start(0));
      const end = Number(range.end(range.length - 1));
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) win = { start, end };
    }
  } catch {}
  if (finiteDuration) {
    // DVR past the head of a finite file: honour the trimmed start, but never
    // let a half-downloaded buffer shorten the range you may seek into.
    if (win && win.start > 0.5) return { start: win.start, end: Math.max(win.end, duration) };
    return { start: 0, end: duration };
  }
  if (win) return win;
  return null;
}

export function clampToSeekWindow(el, time) {
  const win = readSeekWindow(el);
  const target = Number(time);
  if (!win || !Number.isFinite(target)) return null;
  return Math.min(Math.max(win.start, target), Math.max(win.start, win.end - 0.25));
}

/**
 * Live-ness is derived from the element, not from a page flag, so a "live"
 * feed with hours of DVR gets a scrubber and a mislabelled VOD manifest with
 * Infinity duration gets the LIVE badge.
 *
 * `minDvrSeconds`: how much seekable range is worth exposing (a 20 s window is
 * useless to scrub, so it stays a live badge).
 */
export function derivePlaybackModel(el, { minDvrSeconds = 120 } = {}) {
  const win = readSeekWindow(el);
  const duration = Number(el?.duration);
  const finiteDuration = Number.isFinite(duration) && duration > 0;
  const range = win ? win.end - win.start : 0;
  const dvrSeconds = finiteDuration ? 0 : Math.max(0, range);
  const live = !finiteDuration;
  const canSeek = Boolean(win && range > 0) && (finiteDuration || range >= minDvrSeconds);
  return { live, dvrSeconds, canSeek, window: win };
}

/** Whole seconds played inside the current seek window (0 when unknown). */
export function elapsedInWindow(el) {
  const win = readSeekWindow(el);
  if (!win) return 0;
  return Math.max(0, (Number(el?.currentTime) || 0) - win.start);
}

/** Progress 0..1 across the seek window, for the scrubber. */
export function progressRatio(el) {
  const win = readSeekWindow(el);
  if (!win) return 0;
  const span = win.end - win.start;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, ((Number(el?.currentTime) || 0) - win.start) / span));
}

export function bufferedRatio(el) {
  const win = readSeekWindow(el);
  if (!win) return 0;
  const span = win.end - win.start;
  if (!(span > 0)) return 0;
  try {
    const buffered = el.buffered;
    if (!buffered || !buffered.length) return 0;
    const end = buffered.end(buffered.length - 1);
    return Math.min(1, Math.max(0, (end - win.start) / span));
  } catch {
    return 0;
  }
}
