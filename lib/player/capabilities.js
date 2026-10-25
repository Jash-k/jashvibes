/**
 * lib/player/capabilities.js
 * Browser capability probe — runs once and caches.
 * Detects MSE/ManagedMediaSource, EME keySystems, codecs, native HLS.
 * Pure browser API, no imports.
 */

let cached = null;
let pending = null;

/**
 * Test if a codec is supported via MediaSource.isTypeSupported
 */
function canPlayCodec(mime) {
  try {
    if (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported) {
      return MediaSource.isTypeSupported(mime);
    }
    // Fallback: ManagedMediaSource on iOS 17.4+
    if (typeof ManagedMediaSource !== 'undefined' && ManagedMediaSource.isTypeSupported) {
      return ManagedMediaSource.isTypeSupported(mime);
    }
  } catch {}
  return false;
}

/**
 * Probe EME keySystems (non-blocking, with timeout)
 */
async function probeEme(timeoutMs = 2500) {
  const result = { widevine: false, playready: false, fairplay: false, clearkey: false, clearkeyEme: false };
  if (typeof navigator === 'undefined' || !navigator.requestMediaKeySystemAccess) {
    return result;
  }

  const tests = [
    ['widevine', 'com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]],
    ['playready', 'com.microsoft.playready', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]],
    ['fairplay', 'com.apple.fps.1_0', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]],
    ['clearkey', 'org.w3.clearkey', [{ initDataTypes: ['cenc', 'keyids'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]],
  ];

  const promises = tests.map(async ([name, ks, config]) => {
    try {
      const access = await Promise.race([
        navigator.requestMediaKeySystemAccess(ks, config),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      result[name] = !!access;
    } catch {
      result[name] = false;
    }
  });

  await Promise.allSettled(promises);
  return result;
}

/**
 * Probe all capabilities
 * @param {object} opts
 * @param {boolean} opts.force - force re-probe
 * @returns {Promise<object>}
 */
export async function probeCapabilities({ force = false } = {}) {
  if (cached && !force) return cached;
  if (pending && !force) return pending;

  pending = (async () => {
    const hasMSE = typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
    const hasMMS = typeof ManagedMediaSource !== 'undefined' && typeof ManagedMediaSource.isTypeSupported === 'function';
    const hasEME = typeof navigator !== 'undefined' && !!navigator.requestMediaKeySystemAccess;

    let nativeHls = false;
    try {
      const probe = document.createElement('video');
      nativeHls = probe.canPlayType('application/vnd.apple.mpegurl') !== '' ||
                  probe.canPlayType('application/x-mpegURL') !== '';
    } catch {}

    const isIOS = /iPad|iPhone|iPod/.test(typeof navigator !== 'undefined' ? navigator.userAgent : '') ||
                  (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android).)*safari/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    const isTizen = /Tizen/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');
    const isWebOS = /Web0S|WebOS/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '');

    const codecs = {
      avc: canPlayCodec('video/mp4; codecs="avc1.42E01E"'),
      avcHigh: canPlayCodec('video/mp4; codecs="avc1.640028"'),
      hevc: canPlayCodec('video/mp4; codecs="hvc1.1.6.L93.B0"') || canPlayCodec('video/mp4; codecs="hev1.1.6.L93.B0"'),
      hevcMain10: canPlayCodec('video/mp4; codecs="hvc1.2.4.L120.B0"'),
      av1: canPlayCodec('video/mp4; codecs="av01.0.05M.08"'),
      vp9: canPlayCodec('video/webm; codecs="vp9"'),
      aac: canPlayCodec('audio/mp4; codecs="mp4a.40.2"'),
      ac3: canPlayCodec('audio/mp4; codecs="ac-3"'),
      ec3: canPlayCodec('audio/mp4; codecs="ec-3"'),
      mp3: canPlayCodec('audio/mpeg'),
      opus: canPlayCodec('audio/webm; codecs="opus"'),
    };

    // EME probe is async but we don't want to block initial render — run in parallel
    const eme = await probeEme();

    const caps = {
      hasMSE,
      hasMMS,
      hasEME,
      nativeHls,
      isIOS,
      isSafari,
      isTizen,
      isWebOS,
      codecs,
      eme,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      // Derived flags
      canPlayHevc: codecs.hevc,
      canPlayAv1: codecs.av1,
      canPlayDolby: codecs.ac3 || codecs.ec3,
      shouldUseMMS: hasMMS && isIOS, // iOS 17.4+ should use ManagedMediaSource for DASH/EME
      recommendNativeHls: isIOS && !hasMMS, // old iOS — native HLS only
      timestamp: Date.now(),
    };

    cached = caps;
    pending = null;
    return caps;
  })();

  return pending;
}

/**
 * Synchronous quick check for codec support (uses cache if available, else MSE check)
 */
function isCodecSupported(mime) {
  return canPlayCodec(mime);
}

/**
 * Check if a specific video codec string (from HLS CODECS) is supported
 * @param {string} codec - e.g. "hvc1.1.6.L93.B0", "avc1.640028", "av01.0.05M.08"
 */
export function isVideoCodecSupported(codec = '') {
  const c = String(codec || '').trim().toLowerCase();
  if (!c) return true; // unknown — try anyway
  if (c.startsWith('avc1') || c.startsWith('avc3')) return canPlayCodec(`video/mp4; codecs="${c}"`);
  if (c.startsWith('hvc1') || c.startsWith('hev1') || c.startsWith('h265')) return canPlayCodec(`video/mp4; codecs="${c}"`);
  if (c.startsWith('av01') || c.startsWith('av1')) return canPlayCodec(`video/mp4; codecs="${c}"`);
  if (c.startsWith('vp09') || c.startsWith('vp9')) return canPlayCodec(`video/mp4; codecs="${c}"`);
  if (c.startsWith('mp4v')) return true; // MPEG-4 Part 2 — widely supported
  return true; // unknown codec — let Shaka try
}

/**
 * Check if audio codec is supported
 */
export function isAudioCodecSupported(codec = '') {
  const c = String(codec || '').trim().toLowerCase();
  if (!c) return true;
  if (c.startsWith('mp4a')) return canPlayCodec(`audio/mp4; codecs="${c}"`);
  if (c.startsWith('ac-3')) return canPlayCodec('audio/mp4; codecs="ac-3"');
  if (c.startsWith('ec-3')) return canPlayCodec('audio/mp4; codecs="ec-3"');
  if (c.startsWith('opus')) return canPlayCodec('audio/webm; codecs="opus"');
  if (c === 'mp3' || c.startsWith('mp3')) return true;
  return true;
}

/**
 * Get cached capabilities without re-probing (null if not yet probed)
 */
function getCachedCapabilities() {
  return cached;
}

/**
 * Clear cache (for testing)
 */

export default { probeCapabilities, isCodecSupported, isVideoCodecSupported, isAudioCodecSupported, getCachedCapabilities };
