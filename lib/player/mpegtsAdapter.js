/**
 * lib/player/mpegtsAdapter.js
 * MPEG-TS / FLV → MSE bridge via mpegts.js
 * Provides a Shaka-like attach/destroy API so usePlaybackEngine can treat it as an engine.
 *
 * Requires: npm i mpegts.js (xgplayer fork recommended: npm i mpegts.js)
 * Fallback: if not installed, gracefully reports unsupported.
 */

let mpegtsPromise = null;

async function loadMpegts() {
  if (typeof window === 'undefined') throw new Error('MPEGTS only in browser');
  if (window.mpegts) return window.mpegts;
  if (!mpegtsPromise) {
    // Try to dynamically import mpegts.js — caller should have installed it
    // If not installed, this will throw and caller handles gracefully
    mpegtsPromise = import('mpegts.js').then((mod) => mod.default || mod).catch(() => {
      throw new Error('mpegts.js not installed. Run: npm i mpegts.js');
    });
  }
  const lib = await mpegtsPromise;
  if (!window.mpegts) window.mpegts = lib;
  return lib;
}

/**
 * Check if mpegts.js is supported in this browser
 */
export function isMpegtsSupported() {
  if (typeof window === 'undefined') return false;
  try {
    // mpegts.js checks MediaSource + WebSocket + etc
    const lib = window.mpegts;
    if (lib?.isSupported) return lib.isSupported();
    // If not yet loaded, check MSE baseline
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E"');
  } catch {
    return false;
  }
}

/**
 * Create a live TS/FLV player attached to a video element
 * @param {HTMLVideoElement} videoEl
 * @param {string} url - stream URL (may be proxied)
 * @param {object} opts
 * @param {object} opts.headers - headers (for logging only — mpegts.js xhr can set them via config)
 * @returns {{ load: Function, destroy: Function, onError: Function, engine: object }}
 */
export async function createMpegtsPlayer(videoEl, url, opts = {}) {
  const mpegts = await loadMpegts();

  if (!mpegts.isSupported()) {
    throw new Error('MPEG-TS not supported in this browser (no MSE).');
  }

  const isLive = opts.live !== false;
  const config = {
    type: url.includes('.flv') || /extension=flv/i.test(url) ? 'flv' : 'mse', // 'mse' for TS (auto-detects)
    url,
    isLive,
    cors: true,
    // Low-latency tuning for live
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: 3,
    liveBufferLatencyMinRemain: 0.5,
    // Don't auto-stash — live wants low latency
    stashInitialSize: isLive ? 128 : 384,
    enableWorker: true,
    enableStashBuffer: true,
    autoCleanupSourceBuffer: true,
    // Seek: live has no seek window; VOD TS may
    seekType: 'range',
    lazyLoad: false,
    lazyLoadMaxDuration: 30,
    deferLoadAfterSourceOpen: false,
    // Headers: mpegts.js supports xhrSetup to inject Referer etc
    xhrSetup: (xhr, reqUrl) => {
      // Browser forbids User-Agent/Cookie set via xhr; rely on proxy for those
      // But we can set custom headers that ARE allowed
      const headers = opts.headers || {};
      for (const [k, v] of Object.entries(headers)) {
        if (!k || !v) continue;
        if (/^(user-agent|cookie|referer|referrer)$/i.test(k)) continue;
        try { xhr.setRequestHeader(k, String(v)); } catch {}
      }
      if (opts.referer) {
        try { xhr.setRequestHeader('Referer', opts.referer); } catch {}
      }
    },
  };

  const player = mpegts.createPlayer(config, {
    enableWorker: true,
    lazyLoad: false,
    seekType: 'range',
  });

  player.attachMediaElement(videoEl);
  player.load();

  // Wire error forwarding
  let errorHandler = null;
  player.on(mpegts.Events.ERROR, (type, detail, data) => {
    const err = {
      code: 3000 + (type === 'NetworkError' ? 1 : type === 'MediaError' ? 2 : 0),
      message: `MPEG-TS ${type}: ${detail || ''} ${data ? JSON.stringify(data).slice(0, 200) : ''}`.trim(),
      kind: type === 'NetworkError' ? 'network' : 'decode',
      retriable: type === 'NetworkError',
      mpegtsType: type,
      mpegtsDetail: detail,
    };
    if (errorHandler) errorHandler(err);
  });

  return {
    engine: player,
    type: 'mpegts',
    onError(handler) { errorHandler = handler; },
    async destroy() {
      try {
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } catch {}
    },
    load() {
      try { player.load(); } catch {}
    },
    pause() { try { player.pause(); } catch {} },
    play() { try { return player.play(); } catch {} },
  };
}

export default { loadMpegts, isMpegtsSupported, createMpegtsPlayer };
