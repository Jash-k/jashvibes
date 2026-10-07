/**
 * lib/player/liveEngine.js
 *
 * The Live playback router: given one catalog row + this browser's
 * capabilities, it returns an ORDERED plan of attempts.
 *
 * Why a router instead of more flags in the player:
 *   • Every stream class needs a different engine, and the right engine
 *     depends on the browser, not on the URL:
 *       HLS        → native (Safari)         | Shaka (MSE browsers)
 *       DASH       → Shaka                   | nothing before iOS 17.1
 *       ClearKey   → Shaka + EME             | nothing on Safari/iOS
 *       raw TS/FLV → mpegts.js               | nothing without MSE
 *       file       → <video src>             | —
 *   • "It failed" and "this browser can never play it" need different UI.
 *     The plan says which one it is, before a single byte is fetched.
 *   • The proxy is a dimension of the attempt (direct → proxied), not a
 *     separate code path, so escalation stays in one place.
 *
 * Pure module: no React, no DOM. Safe in Node.
 */

import { canUseMse, codecVerdict } from '@/lib/player/capabilities';
import { classifyStream } from '@/lib/player/streamClassifier';

export const ENGINE = Object.freeze({
  NATIVE: 'native',        // el.src = url  (Safari HLS, mp4/webm files)
  SHAKA: 'shaka',          // HLS/DASH via MSE (+EME for ClearKey)
  MPEGTS: 'mpegts',        // mpegts.js: raw MPEG-TS / FLV → fMP4 → MSE
  WEBCODECS: 'webcodecs',  // advanced: decrypt/demux in JS, render via WebCodecs
});

export const PROXY = Object.freeze({
  NONE: 'none',
  HEADERS: 'headers',  // /api/live-proxy  (UA / Referer / Cookie / custom headers)
  JIO: 'jio',          // /api/live-jio    (token in URL + forbidden headers)
  STREAM: 'stream',    // channel.streamProxy (operator-provided relay)
});

const step = (engine, why, extra = {}) => ({ engine, why, proxy: PROXY.NONE, ...extra });

/**
 * Build the plan.
 *
 * @param {object} channel  Live catalog row (url, format, keyId/key, headers, …)
 * @param {object} caps     result of probeCapabilities()
 * @param {object} [options]
 *   allowNativeHls   prefer the browser's own HLS pipeline on Apple devices (default true)
 *   allowMpegts      enable the mpegts.js engine                       (default true)
 *   allowWebCodecs   enable the experimental WebCodecs engine          (default false)
 *   streamProxyUrl   channel.streamProxy, when the operator provides one
 *   pageIsHttps      is the app itself on https (mixed-content guard)
 * @returns {{stream: object, steps: object[], unsupported: null|object, notes: string[]}}
 */
export function planLivePlayback(channel = {}, caps = null, options = {}) {
  const {
    allowNativeHls = true,
    allowMpegts = true,
    allowWebCodecs = false,
    streamProxyUrl = '',
    pageIsHttps = true,
  } = options;

  const stream = classifyStream(channel);
  const notes = [];
  const steps = [];
  const mse = canUseMse(caps);
  const nativeHls = Boolean(allowNativeHls && caps?.nativeHls);

  const fail = (reason, action, hint) => ({
    stream,
    steps,
    unsupported: { reason, action, hint },
    notes,
  });

  /* ---------------------------------------------- hard blockers first */

  if (stream.scheme === 'http' && pageIsHttps && caps?.secureContext !== false) {
    return fail(
      'This stream is served over plain HTTP and the app runs on HTTPS, so the browser blocks it as mixed content.',
      'open-external',
      'Open the source in VLC, or serve the app over HTTP on your LAN.',
    );
  }
  if (stream.needsHeaders && stream.scheme === 'http' && !mse) {
    notes.push('Stream needs custom headers and the browser has no MSE — only the server proxy can supply them.');
  }

  const keySystem = stream.drm.system;
  const isClearKey = keySystem === 'clearkey';
  const canClearKey = Boolean(caps?.eme?.clearKey);

  /* ------------------------------------------------------------ HLS */

  if (stream.transport === 'hls') {
    if (isClearKey) {
      if (canClearKey && mse) {
        steps.push(step(ENGINE.SHAKA, 'HLS + ClearKey via EME (Chrome/Firefox/Edge)', { drm: true }));
      } else if (allowWebCodecs && caps?.webcodecs?.video && caps?.webCrypto) {
        steps.push(step(ENGINE.WEBCODECS, 'HLS + ClearKey decrypted in JS (experimental: no EME ClearKey in this browser)', { drm: true, experimental: true }));
      } else {
        return fail(
          'This channel is ClearKey-encrypted, and this browser has no ClearKey key system (Safari/iOS never shipped one).',
          'switch-device',
          'Play it on Chrome/Edge/Firefox, or keep a decrypted relay for Apple devices.',
        );
      }
    } else {
      if (nativeHls) steps.push(step(ENGINE.NATIVE, 'Native HLS (hardware path, PiP/AirPlay)'));
      if (mse) steps.push(step(ENGINE.SHAKA, 'HLS via MediaSource'));
      if (!nativeHls && !mse) {
        return fail('No HLS support in this browser (neither native HLS nor MSE).', 'open-external', 'Open the stream in VLC.');
      }
    }
  }

  /* ----------------------------------------------------------- DASH */

  if (stream.transport === 'dash') {
    if (isClearKey && !canClearKey) {
      if (allowWebCodecs && caps?.webcodecs?.video && caps?.webCrypto) {
        steps.push(step(ENGINE.WEBCODECS, 'DASH + ClearKey decrypted in JS (experimental)', { drm: true, experimental: true }));
      } else {
        return fail(
          'ClearKey-encrypted DASH needs a ClearKey CDM; Safari/iOS has none, so this cannot play here.',
          'switch-device',
          'Play it on Chrome/Edge/Firefox, or keep a decrypted relay for Apple devices.',
        );
      }
    } else if (!mse) {
      return fail(
        'DASH needs MediaSource. This device only has native HLS (iOS before 17.1 / very old browsers).',
        'switch-device',
        'Update to iOS 17.1+, or use a browser with MSE.',
      );
    } else {
      steps.push(step(ENGINE.SHAKA, `DASH via MediaSource${isClearKey ? ' + ClearKey' : ''}`, { drm: isClearKey }));
    }
  }

  /* --------------------------------------------- raw TS / FLV (MSE) */

  if (stream.transport === 'ts' || stream.transport === 'flv') {
    const codec = codecVerdict(caps, { video: channel.videoCodec || '', audio: channel.audioCodec || '' });
    if (!codec.ok) {
      return fail(codec.reason, 'switch-device', 'A device that can decode this codec is required (usually Safari for HEVC).');
    }
    if (allowMpegts && mse) {
      steps.push(step(ENGINE.MPEGTS, `${stream.transport === 'flv' ? 'FLV' : 'Raw MPEG-TS'} transmuxed to fMP4 in the browser`));
    }
    if (caps?.nativeTs && stream.transport === 'ts') {
      steps.push(step(ENGINE.NATIVE, 'Native MPEG-TS (rare, but some Safari builds handle it)'));
    }
    if (!allowMpegts || !mse) {
      return fail(
        'Raw transport streams need MediaSource (mpegts.js). This browser cannot play them directly.',
        caps?.ios ? 'switch-device' : 'open-external',
        caps?.ios ? 'iOS 17.1+ supports MSE via ManagedMediaSource.' : 'Open the stream in VLC.',
      );
    }
  }

  /* -------------------------------------- progressive files and the rest */

  if (stream.transport === 'progressive') {
    steps.push(step(ENGINE.NATIVE, 'Direct file (native <video>)'));
  }

  if (stream.transport === 'unknown') {
    // No extension and no hint: let Shaka sniff it (it follows redirects and
    // reads the body), then fall back to mpegts.js for headerless TS.
    if (mse) steps.push(step(ENGINE.SHAKA, 'Unknown manifest — let the manifest parser decide'));
    if (allowMpegts && mse) steps.push(step(ENGINE.MPEGTS, 'Unknown raw stream — try TS transmux'));
    if (!mse) return fail('Unrecognised stream type with no MediaSource available.', 'open-external', 'Open the stream in VLC.');
  }

  /* ------------------------------------------------- proxy escalation */

  if (stream.needsHeaders || stream.jio || streamProxyUrl) {
    const proxied = steps.map((s) => ({
      ...s,
      proxy: stream.jio ? PROXY.JIO : PROXY.HEADERS,
      why: `${s.why} — through the server proxy (this browser cannot set UA/Referer/Cookie)`,
    }));
    // Deduplicate: a proxied engine is only useful if the direct attempt can't carry headers.
    for (const candidate of proxied) {
      if (!steps.some((s) => s.engine === candidate.engine && s.proxy === candidate.proxy)) steps.push(candidate);
    }
    notes.push('Header-restricted stream: direct attempt first, server-proxied retry after a 401/403/451 or a stall.');
  }
  if (streamProxyUrl) {
    steps.push(step(steps[0]?.engine || ENGINE.SHAKA, 'Operator relay (channel.streamProxy)', { proxy: PROXY.STREAM, url: streamProxyUrl }));
  }
  if (stream.expiresAt) {
    const minutes = Math.round((stream.expiresAt - Date.now()) / 60000);
    notes.push(`CDN token expires in ~${minutes} min — re-resolve the channel before then (playlist refresh), do not just retry.`);
  }
  if (isClearKey) notes.push('ClearKey pair present: pass drm.clearKeys to Shaka; do not "drop DRM" on failure, the stream is encrypted.');

  return { stream, steps, unsupported: null, notes };
}

/**
 * Rebuild the plan after the first attempt failed.
 * `failedEngines` = engines already tried (in order), so the next step is a
 * genuinely different mechanism rather than the same one again.
 */
export function nextStep(plan = {}, failedEngines = [], { dropDrm = false } = {}) {
  const tried = new Set(failedEngines);
  const candidates = (plan.steps || []).filter((s) => !tried.has(s.engine) || s.proxy !== PROXY.NONE);
  return candidates[0] || null;
}

/** Short label for the UI badge / stats overlay. */
export function engineLabel(engine = '') {
  switch (engine) {
    case ENGINE.NATIVE: return 'Native';
    case ENGINE.SHAKA: return 'Shaka';
    case ENGINE.MPEGTS: return 'mpegts.js';
    case ENGINE.WEBCODECS: return 'WebCodecs';
    default: return engine || '—';
  }
}
