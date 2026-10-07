/**
 * lib/player/capabilities.js
 *
 * One place that answers: "what can THIS browser actually play?"
 *
 * Everything downstream (engine choice, whether a channel is shown as
 * playable, which error copy to use) reads from here instead of guessing from
 * the user-agent string. All probes are feature-detection, cached once per
 * session, and safe to call during SSR (returns conservative defaults).
 *
 * Notes that drive the design:
 *   • MSE is the floor for HLS/DASH on every non-Apple browser.
 *   • iOS got MSE only with ManagedMediaSource (iOS 17.1+) — before that,
 *     native HLS is the ONLY route on iPhone.
 *   • ClearKey is an EME key system Safari does not implement: a ClearKey DASH
 *     stream cannot play in Safari/iOS through EME, no matter which library.
 *   • Codec support is not a browser constant: HEVC needs hardware (Chrome on
 *     Windows/Linux), AC-3/E-AC-3 is essentially missing from MSE everywhere.
 *
 * So capability = { transport support } × { codec support } and both are
 * probed, never assumed.
 */

const CACHE = { ready: null, promise: null };

const HAS_WINDOW = typeof window !== 'undefined' && typeof document !== 'undefined';

/* --------------------------------------------------------- codec probes */

/** Codec strings worth probing. Keep in sync with what the catalog ships. */
export const CODEC_PROBES = Object.freeze({
  h264: 'video/mp4; codecs="avc1.42E01E"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"',
  hevcDvh: 'video/mp4; codecs="dvh1.05.06"',
  av1: 'video/mp4; codecs="av01.0.04M.08"',
  vp9: 'video/mp4; codecs="vp09.00.10.08"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  opus: 'audio/webm; codecs="opus"',
});

/** WebCodecs decoder configs (broader than MSE: also covers raw annexb). */
export const WEBCODECS_PROBES = Object.freeze({
  h264: { codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720 },
  hevc: { codec: 'hev1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720 },
  av1: { codec: 'av01.0.04M.08', codedWidth: 1280, codedHeight: 720 },
  aac: { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000 },
  ac3: { codec: 'ac-3', numberOfChannels: 2, sampleRate: 48000 },
  eac3: { codec: 'ec-3', numberOfChannels: 2, sampleRate: 48000 },
});

function safe(fn, fallback = false) {
  try { return fn(); } catch { return fallback; }
}

function isTypeSupported(type) {
  return safe(() => typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type));
}

function canPlay(type) {
  return safe(() => {
    const el = document.createElement('video');
    return el.canPlayType(type) || '';
  }, '');
}

const isSafari = () => HAS_WINDOW && safe(() => /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent));
const isIOS = () => HAS_WINDOW && safe(() =>
  /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const isFirefox = () => HAS_WINDOW && safe(() => /firefox|fxios/i.test(navigator.userAgent));
const isChromium = () => HAS_WINDOW && safe(() => /chrome|chromium|crios|edg/i.test(navigator.userAgent) && !/firefox/i.test(navigator.userAgent));

/* -------------------------------------------------------------- probing */

async function probeWebCodecs() {
  const out = { video: false, audio: false, image: false, supported: {} };
  if (!HAS_WINDOW) return out;
  out.video = typeof window.VideoDecoder === 'function';
  out.audio = typeof window.AudioDecoder === 'function';
  out.image = typeof window.ImageDecoder === 'function';
  await Promise.all(Object.entries(WEBCODECS_PROBES).map(async ([name, config]) => {
    const Ctor = out.audio && name !== 'h264' && name !== 'hevc' && name !== 'av1'
      ? window.AudioDecoder
      : window.VideoDecoder;
    if (typeof Ctor !== 'function') return;
    try {
      const res = await Ctor.isConfigSupported(config);
      out.supported[name] = Boolean(res?.supported);
    } catch {
      out.supported[name] = false;
    }
  }));
  return out;
}

async function probeEme() {
  const out = { present: false, clearKey: false, widevine: false, playready: false, fairplay: false };
  if (!HAS_WINDOW || !navigator.requestMediaKeySystemAccess) return out;
  out.present = true;

  const attempt = async (keySystem, configs) => {
    try {
      await navigator.requestMediaKeySystemAccess(keySystem, configs);
      return true;
    } catch {
      return false;
    }
  };

  const cenc = [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }];
  const [ck1, ck2, wv, pr, fp] = await Promise.all([
    attempt('org.w3.clearkey', cenc),
    attempt('webkit-org.w3.clearkey', cenc),  // older Safari spelling, in case one day
    attempt('com.widevine.alpha', cenc),
    attempt('com.microsoft.playready', cenc),
    attempt('com.apple.fps.1_0', [{ initDataTypes: ['sinf'], videoCapabilities: [{ contentType: 'video/mp4' }] }]),
  ]);
  out.clearKey = ck1 || ck2;
  out.widevine = wv;
  out.playready = pr;
  out.fairplay = fp;
  return out;
}

/**
 * Full capability picture. Cached for the session; call freely.
 * @returns {Promise<object>}
 */
export async function probeCapabilities() {
  if (CACHE.ready) return CACHE.ready;
  if (CACHE.promise) return CACHE.promise;

  CACHE.promise = (async () => {
    const base = {
      ssr: !HAS_WINDOW,
      safari: isSafari(),
      ios: isIOS(),
      firefox: isFirefox(),
      chromium: isChromium(),
      secureContext: HAS_WINDOW ? Boolean(window.isSecureContext) : true,
      worker: HAS_WINDOW ? typeof Worker === 'function' : false,
      webCrypto: HAS_WINDOW ? Boolean(window.crypto?.subtle) : false,

      // transport
      mse: HAS_WINDOW ? typeof window.MediaSource === 'function' : false,
      managedMediaSource: HAS_WINDOW
        ? typeof window.ManagedMediaSource === 'function' || Boolean(window.MediaSource && window.MediaSource.name === 'ManagedMediaSource')
        : false,
      nativeHls: canPlay('application/vnd.apple.mpegurl') !== '' || canPlay('application/x-mpegURL') !== '',
      nativeTs: canPlay('video/mp2t') !== '',
      mseInWorker: HAS_WINDOW ? safe(() => 'MediaSource' in (window.Worker?.prototype || {})) : false,

      // codecs
      codecs: Object.fromEntries(Object.entries(CODEC_PROBES).map(([k, v]) => [k, isTypeSupported(v)])),

      // EME / WebCodecs / misc
      eme: await probeEme(),
      webcodecs: await probeWebCodecs(),
    };

    // A capacity flag the router uses to decide if MSE-based engines are an option at all.
    base.mseAny = base.mse || base.managedMediaSource;
    base.cachedAt = Date.now();
    CACHE.ready = base;
    return base;
  })();

  return CACHE.promise;
}

/** Sync variant for render paths that already probed once. */
export function capabilitiesSync() {
  return CACHE.ready || null;
}

/* --------------------------------------------------- derived judgements */

/** Can this browser run an MSE engine (Shaka / mpegts.js / hls.js)? */
export function canUseMse(caps) {
  if (!caps) return false;
  // ManagedMediaSource (iOS/iPadOS 17.1+) IS MSE for our purposes: Shaka,
  // hls.js and mpegts.js all run on it. Forgetting it here was the classic
  // "iPhones can't play DASH" bug.
  return Boolean(caps.mseAny || caps.mse || caps.managedMediaSource);
}

/**
 * Verdict for one stream's codec set against this browser.
 * @returns {{ok: boolean, reason?: string}}
 */
export function codecVerdict(caps, { video = '', audio = '' } = {}) {
  if (!caps) return { ok: true };
  const need = (name) => {
    if (!name) return true;
    const key = normalizeCodecName(name);
    if (!key) return true;                       // unknown codec: let the engine try
    if (caps.codecs[key] === true) return true;
    // HEVC/AV1 can still be decodable through WebCodecs even when MSE says no.
    if (caps.webcodecs?.supported?.[key]) return true;
    return false;
  };

  if (!need(video)) return { ok: false, reason: `video codec "${video}" is not decodable in this browser` };
  if (!need(audio)) return { ok: false, reason: `audio codec "${audio}" is not decodable in this browser` };
  return { ok: true };
}

export function normalizeCodecName(value = '') {
  const v = String(value).toLowerCase();
  if (!v) return '';
  if (/^(avc1|avc3|x264|h264)/.test(v)) return 'h264';
  if (/^(hvc1|hev1|h265|hevc)/.test(v)) return 'hevc';
  if (/^dvh1|^dvhe/.test(v)) return 'hevcDvh';
  if (/^av01/.test(v)) return 'av1';
  if (/^vp0?9/.test(v)) return 'vp9';
  if (/^(mp4a|aac)/.test(v)) return 'aac';
  if (/^ac-3/.test(v)) return 'ac3';
  if (/^ec-3/.test(v)) return 'eac3';
  if (/^opus/.test(v)) return 'opus';
  return '';
}

/** Human string for the diagnostics panel / bug reports. */
export function describeCapabilities(caps) {
  if (!caps) return 'capabilities: unknown (not probed)';
  const yes = (b) => (b ? 'yes' : 'no');
  const codecs = Object.entries(caps.codecs).filter(([, v]) => v).map(([k]) => k).join(',') || 'none';
  return [
    `mse=${yes(caps.mse)} mms=${yes(caps.managedMediaSource)} nativeHls=${yes(caps.nativeHls)} nativeTs=${yes(caps.nativeTs)}`,
    `eme(clearKey=${yes(caps.eme?.clearKey)}, widevine=${yes(caps.eme?.widevine)}, fairplay=${yes(caps.eme?.fairplay)})`,
    `webcodecs(video=${yes(caps.webcodecs?.video)}, audio=${yes(caps.webcodecs?.audio)})`,
    `mse codecs: ${codecs}`,
  ].join(' | ');
}
