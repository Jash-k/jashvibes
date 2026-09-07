/**
 * VOD / direct-file playback policies.
 *
 * `createStreamPolicy` absorbs app/classics/[id]/page.js's Shaka block
 * (ClearKey + Widevine license server + per-stream header injection + the MPD
 * default_KID expansion). `createDirectPolicy` absorbs the /watch and
 * /stremio-watch paths, which need no DRM at all.
 */

import { detectKind, mimeTypeFor } from '@/lib/player/kind';

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function base64UrlToHex(value = '') {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return Array.from(binary).map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('').toLowerCase();
  } catch {
    return '';
  }
}

/**
 * ClearKey ids and keys are 16 bytes. License payloads arrive as 32 hex chars,
 * as dashed UUIDs, or as base64url — and a naive hex-strip turns a base64url
 * value like "ERITRqxzDIM" into whatever hex letters it happens to contain.
 * So: accept hex only when the length is exactly right, otherwise decode base64,
 * and only then fall back to the stripped value for legacy short records.
 */
function normalizeKeyMaterial(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  const hex = text.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (hex.length === 32) return hex;
  const decoded = base64UrlToHex(text);
  if (decoded.length === 32) return decoded;
  // Not 16 bytes by any reading → no browser will accept it as a ClearKey.
  // Dropping it lets the recovery ladder retry without DRM instead of failing
  // inside the CDM with a confusing 6008.
  return '';
}

/** Read `cenc:default_KID` values out of a manifest so ClearKeys map to them. */
export async function getDashDefaultKeyIds(url = '', { fetchImpl, headers = {} } = {}) {
  if (!url || !String(url).toLowerCase().includes('.mpd')) return [];
  try {
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!doFetch) return [];
    const response = await doFetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/dash+xml,text/xml,*/*', ...headers },
    });
    if (!response.ok) return [];
    const text = await response.text();
    const ids = [...text.matchAll(/(?:cenc:)?default_KID="([^"]+)"/gi)]
      .map((match) => cleanHex(match[1]))
      .filter(Boolean);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/**
 * Build a Shaka `drm` config from a stream record.
 * Accepts: JSON license blobs, `kid:key` ClearKey pairs, plain keyId/key
 * columns, and an https license-server URL (Widevine).
 */
export async function buildDrmConfig(stream = {}, { fetchImpl, expandDashKids = true } = {}) {
  const license = String(stream?.licenseKey || '').trim();
  const clearKeys = {};
  let keyValue = '';

  if (license.startsWith('{')) {
    try {
      const parsed = JSON.parse(license);
      for (const item of parsed?.keys || []) {
        const kid = normalizeKeyMaterial(item?.kid);
        const key = normalizeKeyMaterial(item?.k ?? item?.key);
        if (kid && key) {
          clearKeys[kid] = key;
          keyValue ||= key;
        }
      }
    } catch {}
  }

  if (license && license.includes(':') && !/^https?:\/\//i.test(license)) {
    const [rawKid, rawKey] = String(license).split(':');
    const kid = normalizeKeyMaterial(rawKid);
    const value = normalizeKeyMaterial(rawKey);
    if (kid && value) {
      clearKeys[kid] = value;
      keyValue ||= value;
    }
  }

  const kid = normalizeKeyMaterial(stream?.keyId || '');
  const key = normalizeKeyMaterial(stream?.key || '');
  if (kid && key && kid !== 'null' && key !== 'null') {
    clearKeys[kid] = key;
    keyValue ||= key;
  }

  if (keyValue && expandDashKids) {
    const headers = stream?.referer ? { Referer: stream.referer } : {};
    const manifestKids = await getDashDefaultKeyIds(stream?.url || '', { fetchImpl, headers });
    for (const manifestKid of manifestKids) {
      if (!clearKeys[manifestKid]) clearKeys[manifestKid] = keyValue;
    }
  }

  if (Object.keys(clearKeys).length) return { clearKeys };
  if (/^https?:\/\//i.test(license)) return { servers: { 'com.widevine.alpha': license } };
  return {};
}

/** Exported so `<JashPlayer http={{ referer, headers }}>` reuses the exact
 * same injection rules as the resolver-driven paths (Cookie never wins, UA is
 * browser-forbidden and therefore only honoured from a dedicated field).
 */
export function buildHeaderFilter(stream = {}) {
  const headers = stream?.headers && typeof stream.headers === 'object' ? stream.headers : {};
  const referer = stream?.referer || '';
  const userAgent = stream?.userAgent || '';
  if (!Object.keys(headers).length && !referer && !userAgent) return null;

  return function requestFilter(requestType, request) {
    void requestType;
    for (const [key, value] of Object.entries(headers)) {
      if (!key || value == null || value === '' || /^cookie$/i.test(key)) continue;
      if (/^(?:user-agent|referer|referrer)$/i.test(key)) continue; // set below / forbidden in browsers
      request.headers[key] = String(value);
    }
    if (referer) request.headers.Referer = referer;
    if (userAgent) request.headers['User-Agent'] = userAgent;
  };
}

const VOD_PLAYER_CONFIG = {
  streaming: { bufferingGoal: 20, rebufferingGoal: 3 },
  abr: { enabled: true, defaultBandwidthEstimate: 1_200_000 },
};

/**
 * Encrypted/ClearKey-capable policy used by /classics (ReTro) and any future
 * licensed VOD source. `stream` is a VodItem stream record.
 */
export function createStreamPolicy(stream = {}, options = {}) {
  const { fetchImpl, expandDashKids = true, playerConfig = VOD_PLAYER_CONFIG } = options;

  async function resolve({ prior = null } = {}) {
    const url = String(stream.url || '');
    const kind = detectKind(url, { streamType: stream.format === 'hls' ? 'hls' : stream.format === 'dash' ? 'dash' : '' });
    const drm = await buildDrmConfig(stream, { fetchImpl, expandDashKids });
    const requestFilter = buildHeaderFilter(stream);
    return {
      url,
      kind,
      mimeType: mimeTypeFor(kind),
      live: false,
      drm,
      hasDrm: Boolean(drm?.clearKeys && Object.keys(drm.clearKeys).length),
      http: requestFilter ? { requestFilter } : {},
      meta: { label: stream.label || stream.source || 'Stream', source: stream.source || '' },
      prior,
    };
  }

  return {
    name: 'vod-stream',
    playerConfig,
    loadTimeoutMs: Number(options.loadTimeoutMs || 25_000),
    resolve,
    hasRecovery: () => false,
  };
}

/**
 * Plain-file / manifest policy for Stremio + Mirchi direct sources and the
 * sports one-shot player. No DRM, no header injection, nothing to recover
 * except rotating to the next fallback URL (which the engine owns).
 */
export function createDirectPolicy(url = '', options = {}) {
  const { streamType = '', mimeType, requestFilter, responseFilter, live = false, playerConfig = VOD_PLAYER_CONFIG } = options;
  const kind = options.kind || detectKind(url, { streamType });

  async function resolve({ prior = null } = {}) {
    if (!url) {
      const error = new Error('No playable URL was resolved for this title.');
      error.kind = 'unknown';
      error.retriable = false;
      throw error;
    }
    return {
      url: String(url),
      kind,
      mimeType: mimeType || mimeTypeFor(kind),
      live,
      drm: {},
      hasDrm: false,
      http: requestFilter || responseFilter ? { requestFilter, responseFilter } : {},
      meta: { label: options.label || '', source: options.source || '' },
      prior,
    };
  }

  return {
    name: 'direct',
    playerConfig,
    loadTimeoutMs: Number(options.loadTimeoutMs || 25_000),
    resolve,
    hasRecovery: () => false,
  };
}
