/**
 * lib/player/liveEngine.js
 * Universal Live engine router — pure function.
 * classifyStream + capabilities → ordered playback Plan.
 *
 * Each plan step is { engine, url, drmConfig, needsProxy, mimeType, reason }
 * Engine priority:
 *  1. shaka  (HLS/DASH + DRM via MSE/EME)
 *  2. mpegts (raw TS/FLV via MSE)
 *  3. native-hls (Safari/iOS native <video src=m3u8>)
 *  4. native (progressive MP4/MP3 native)
 *  5. iframe (embed/YouTube/unsupported)
 */

import { classifyStream } from '@/lib/player/streamClassifier';
import { detectKind, mimeTypeFor } from '@/lib/player/kind';
import { isVideoCodecSupported, isAudioCodecSupported } from '@/lib/player/capabilities';
import { buildLiveDrm, buildClearKeys } from '@/lib/player/policy/liveTv';
import { needsProxy as checkNeedsProxy } from '@/lib/player/httpProxy';

/**
 * Build ordered playback plan for a live channel
 * @param {object} channel - Live channel row (toClientChannel output)
 * @param {object} caps - capabilities from probeCapabilities()
 * @param {object} opts
 * @param {string} opts.forceEngine - override ('shaka'|'mpegts'|'native'|'native-hls'|null)
 * @returns {{ plan: Array, meta: object }}
 */
export function buildLivePlan(channel = {}, caps = {}, opts = {}) {
  const cls = classifyStream(channel);
  const { forceEngine = null } = opts;

  const plan = [];
  const meta = {
    transport: cls.transport,
    drm: cls.drm,
    scheme: cls.scheme,
    needsHeaders: cls.needsHeaders,
    expiresAt: cls.expiresAt,
    jio: cls.jio,
    url: cls.url,
    warnings: [],
    unsupported: null,
  };

  const url = cls.url;
  const drm = cls.drm;
  const hasDrm = drm.system !== 'none' && drm.system !== 'unknown' ? true : Object.keys(buildClearKeys(channel)).length > 0;
  const headerNeedsProxy = checkNeedsProxy(channel);

  // Extract codecs if available on channel (from DB probe or manifest peek)
  const videoCodec = String(channel.videoCodec || channel.codec || '').trim();
  const audioCodec = String(channel.audioCodec || '').trim();

  // --- Warnings for unsupported combos ---
  if (videoCodec && !isVideoCodecSupported(videoCodec)) {
    if (videoCodec.toLowerCase().includes('h265') || videoCodec.toLowerCase().includes('hevc') || videoCodec.toLowerCase().includes('hvc1')) {
      if (!caps.codecs?.hevc) {
        meta.warnings.push({
          code: 'HEVC_UNSUPPORTED',
          message: 'This channel uses HEVC/H.265 which your browser cannot decode. Try the SD variant or use Safari.',
          codec: videoCodec,
          action: 'pick SD or use Safari',
        });
      }
    }
  }
  if (audioCodec && !isAudioCodecSupported(audioCodec)) {
    meta.warnings.push({ code: 'AUDIO_CODEC_UNSUPPORTED', message: `Audio codec ${audioCodec} not supported`, codec: audioCodec });
  }

  // Mixed content warning
  if (cls.scheme === 'http' && typeof window !== 'undefined' && window.location?.protocol === 'https:') {
    meta.warnings.push({ code: 'MIXED_CONTENT', message: 'HTTP stream on HTTPS site — will be proxied automatically.', scheme: 'http' });
  }

  // --- DRM capability warnings ---
  if (hasDrm) {
    const drmSystem = drm.system || '';
    if (drmSystem === 'widevine' && caps.eme && caps.eme.widevine === false) {
      meta.warnings.push({ code: 'WIDEVINE_UNSUPPORTED', message: 'Widevine DRM not available — use Chrome/Edge/Firefox on desktop/Android.' });
    } else if (drmSystem === 'fairplay' && caps.eme && caps.eme.fairplay === false) {
      meta.warnings.push({ code: 'FAIRPLAY_UNSUPPORTED', message: 'FairPlay requires Safari on Mac or iPhone/iPad.' });
    } else if (drmSystem === 'playready' && caps.eme && caps.eme.playready === false) {
      meta.warnings.push({ code: 'PLAYREADY_UNSUPPORTED', message: 'PlayReady requires Edge or Xbox.' });
    }
  }

  // --- Build plan steps ---

  // Helper to push a plan step
  function push(engine, opts = {}) {
    plan.push({
      engine,
      url: opts.url || url,
      kind: opts.kind || detectKind(opts.url || url),
      mimeType: opts.mimeType || mimeTypeFor(detectKind(opts.url || url)),
      drmConfig: opts.drmConfig || {},
      needsProxy: opts.needsProxy || false,
      reason: opts.reason || '',
      priority: plan.length,
    });
  }

  // If forced, only that engine
  if (forceEngine) {
    if (forceEngine === 'shaka') push('shaka', { dreason: 'forced', drmConfig: hasDrm ? buildLiveDrm(channel) : {} });
    else if (forceEngine === 'mpegts') push('mpegts', { reason: 'forced' });
    else if (forceEngine === 'native-hls') push('native-hls', { reason: 'forced', mimeType: 'application/x-mpegurl' });
    else if (forceEngine === 'native') push('native', { reason: 'forced' });
    return { plan, meta, classified: cls };
  }

  // TRANSPORT: ts / flv → mpegts first, shaka fallback
  if (cls.transport === 'ts' || cls.transport === 'flv') {
    // MPEGTS.js handles raw TS/FLV best via MSE
    push('mpegts', { reason: `raw ${cls.transport} via mpegts.js` });
    // Shaka + mux.js can also handle TS as fallback
    if (caps.hasMSE || caps.hasMMS) {
      push('shaka', { reason: 'TS via Shaka+mux.js fallback', drmConfig: hasDrm ? buildLiveDrm(channel) : {} });
    }
    push('native', { reason: 'native fallback (unlikely for TS)' });
    return { plan, meta, classified: cls };
  }

  // TRANSPORT: progressive → native first, shaka if DRM
  if (cls.transport === 'progressive') {
    if (hasDrm && (caps.hasMSE || caps.hasMMS)) {
      push('shaka', { reason: 'progressive with DRM needs MSE', drmConfig: buildLiveDrm(channel) });
    }
    push('native', { reason: 'progressive MP4/AAC native', mimeType: detectKind(url) ? mimeTypeFor(detectKind(url)) : 'video/mp4' });
    if (caps.hasMSE) push('shaka', { reason: 'progressive via Shaka fallback' });
    return { plan, meta, classified: cls };
  }

  // TRANSPORT: dash / hls / unknown → Shaka primary
  const shakaCanPlay = (caps.hasMSE || caps.hasMMS) && (cls.transport === 'dash' || cls.transport === 'hls' || cls.transport === 'unknown');
  if (shakaCanPlay) {
    const drmConfig = hasDrm ? buildLiveDrm(channel) : {};
    // Check if requested DRM is actually available on this browser — if not, still try but warn
    let canDoDrm = true;
    if (hasDrm) {
      if (drm.system === 'fairplay' && caps.eme?.fairplay === false) canDoDrm = false;
      if (drm.system === 'widevine' && caps.eme?.widevine === false) canDoDrm = false;
    }

    // Primary: Shaka with DRM
    push('shaka', {
      reason: canDoDrm ? `${cls.transport} + ${drm.system !== 'none' ? drm.system : 'clear'} via Shaka` : `${cls.transport} (DRM may fail — ${drm.system} unavailable)`,
      drmConfig,
      needsProxy: headerNeedsProxy,
    });

    // If has DRM, also queue a no-DRM fallback shaka attempt (drop-drm)
    if (hasDrm) {
      push('shaka', {
        reason: 'retry without DRM (drop-keys fallback)',
        drmConfig: {},
        needsProxy: headerNeedsProxy,
      });
    }
  }

  // NATIVE HLS fallback for HLS on capable browsers (Safari/iOS)
  if (cls.transport === 'hls' || cls.transport === 'unknown') {
    if (caps.nativeHls) {
      push('native-hls', {
        reason: caps.isIOS && !caps.hasMMS ? 'iOS native HLS (no MMS)' : 'Safari native HLS fallback',
        mimeType: 'application/vnd.apple.mpegurl',
        needsProxy: headerNeedsProxy, // native <video> can't set headers — will need proxy URL
      });
    }
  }

  // Native fallback for HLS that might be progressive disguised
  if (cls.transport === 'hls' || cls.transport === 'unknown') {
    push('native', { reason: 'native HLS/DASH as progressive fallback' });
  }

  // Always add iframe as last resort if url looks like embed
  if (detectKind(url, { streamType: channel.format || '' }) === 'embed' || /youtube|youtu\.be|vimeo|dailymotion/i.test(url)) {
    plan.unshift({ engine: 'iframe', url, reason: 'embed/YouTube detected', kind: 'embed' });
  }

  // Edge: if no MSE and no native HLS and transport is dash → unsupported
  if (cls.transport === 'dash' && !caps.hasMSE && !caps.hasMMS) {
    meta.unsupported = { code: 'DASH_NO_MSE', message: 'DASH requires MediaSource — not available on this browser.' };
  }

  // Edge: unknown transport with no MSE and no native HLS → try native anyway
  if (plan.length === 0) {
    push('native', { reason: 'unknown transport — try native' });
    push('iframe', { reason: 'last resort iframe' });
  }

  return { plan, meta, classified: cls };
}

/**
 * Get next plan index after failure
 * @param {Array} plan - full plan
 * @param {number} currentIndex - current attempted index
 * @param {object} failInfo - { code, kind, message }
 * @param {object} caps
 * @returns {number|null} next index or null if exhausted
 */
function nextPlanIndex(plan = [], currentIndex = 0, failInfo = {}, caps = {}) {
  const next = currentIndex + 1;
  if (next >= plan.length) return null;

  // Skip DRM steps if failure was codec (not DRM) and vice versa — always walk linearly
  // For now simple linear walk; sophisticated skipping can be added later
  return next;
}

/**
 * Check if a plan step should be skipped based on failure reason
 */
function shouldSkipStep(step, failInfo, caps) {
  // Skip mpegts if error is DRM (mpegts can't do DRM)
  if (step.engine === 'mpegts' && failInfo?.kind === 'drm') return true;
  // Skip native-hls if error is DRM and it's Widevine (native HLS only does FairPlay)
  if (step.engine === 'native-hls' && failInfo?.kind === 'drm' && failInfo?.system === 'widevine') return true;
  return false;
}

export default { buildLivePlan, nextPlanIndex, shouldSkipStep };
