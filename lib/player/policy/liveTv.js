import { liveSourceHeaders } from '@/lib/player/liveHeaders';
import { detectKind, mimeTypeFor } from '@/lib/player/kind';
import { RUNGS } from '@/lib/player/recovery';
import { proxyResponseBase } from '@/lib/player/httpProxy';
import { normalizeKeyMaterial } from '@/lib/player/policy/stream';
/**
 * Live-TV playback policy — universal engine edition
 * Handles: Jio, Pocket, generic HLS/DASH + ClearKey/Widevine/PlayReady/FairPlay,
 * header rewriting, license proxy, proxy fallback ladder.
 */

import {
  appendJioCookieToUrl,
  buildJioProxyUrl,
  isHjhWorkerChannel,
  isJioChannel,
  isJioCookieValid,
  normalizeJioCookie,
  restoreJioProxyUrl,
  JIO_COOKIE_OVERRIDE_KEY,
} from '@/lib/jioPlayback';

const FANCODE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function normalizeKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Use only supplied keys, with their supplied IDs. Never expand/remap MPD KIDs. */
export function buildClearKeys(channel = {}) {
  const license = String(channel?.licenseKey || '').trim();
  const clearKeys = {};
  const add = (rawKid, rawKey) => {
    const kid = normalizeKeyMaterial(rawKid);
    const key = normalizeKeyMaterial(rawKey);
    if (kid && key) clearKeys[kid] = key;
  };
  if (license.startsWith('{')) {
    try {
      const parsed = JSON.parse(license);
      if (Array.isArray(parsed.keys)) {
        for (const item of parsed.keys) add(item?.kid, item?.k ?? item?.key);
      } else {
        for (const [kid, key] of Object.entries(parsed.clearKeys || parsed)) add(kid, key);
      }
    } catch {}
  } else if (license && !/^https?:\/\//i.test(license)) {
    // Handle comma-separated multiple kid:key pairs (hjh-545 style)
    // e.g. "ae3d3b12...:4577...,911d...:c1fc..." — each comma item is a pair
    const entries = license.split(',');
    let parsedPairs = 0;
    for (const entry of entries) {
      const pair = String(entry).trim().split(':');
      if (pair.length >= 2) {
        // kid:key may have extra colons if hex contains dashes, take first and last
        const kid = pair[0].trim();
        const key = pair[pair.length - 1].trim().split(/\s+/)[0];
        if (kid && key) {
          const before = Object.keys(clearKeys).length;
          add(kid, key);
          if (Object.keys(clearKeys).length > before) parsedPairs += 1;
        }
      }
    }
    // Fallback: single pair without comma (original behavior)
    if (parsedPairs === 0) {
      const pair = license.split(':');
      if (pair.length === 2) add(pair[0], pair[1]);
    }
  }
  add(channel.keyId, channel.key);
  return clearKeys;
}

export function buildLiveDrm(channel = {}) {
  const clearKeys = buildClearKeys(channel);
  if (Object.keys(clearKeys).length) return { clearKeys };
  const license = String(channel.licenseKey || '').trim();
  if (!/^https?:\/\//i.test(license)) return {};
  const type = String(channel.licenseType || '').toLowerCase();
  const headers = channel.headers || {};
  // Detect license system
  const system = type.includes('clearkey') ? 'org.w3.clearkey'
    : type.includes('playready') ? 'com.microsoft.playready'
    : type.includes('fairplay') ? 'com.apple.fps'
    : type.includes('widevine') || !type ? 'com.widevine.alpha' : '';
  if (!system) return {};
  const servers = { [system]: license };

  // For FairPlay, also expose cert URI if provided via headers or extra field
  const advanced = {};
  const fairplayCert = channel.fairplayCert || channel.licenseCert || headers['fairplay-cert'] || headers['server-certificate-uri'] || '';
  if (system === 'com.apple.fps' && fairplayCert) {
    advanced['com.apple.fps'] = {};
    // If cert is URL, set serverCertificateUri to go via our proxy to avoid CORS
    if (/^https?:\/\//i.test(fairplayCert)) {
      advanced['com.apple.fps'].serverCertificateUri = `/api/live-cert?u=${encodeURIComponent(fairplayCert)}`;
    }
  }

  // Multi-DRM: if channel has extra servers in headers (e.g. widevine + playready), expose all
  const widevineUrl = headers['widevine-url'] || headers['widevine-license-url'] || '';
  const playreadyUrl = headers['playready-url'] || '';
  const fairplayUrl = headers['fairplay-url'] || '';
  if (widevineUrl && /^https?:\/\//i.test(widevineUrl)) servers['com.widevine.alpha'] = widevineUrl;
  if (playreadyUrl && /^https?:\/\//i.test(playreadyUrl)) servers['com.microsoft.playready'] = playreadyUrl;
  if (fairplayUrl && /^https?:\/\//i.test(fairplayUrl)) servers['com.apple.fps'] = fairplayUrl;

  return { servers, ...(Object.keys(advanced).length ? { advanced } : {}) };
}

function clearKeyDeclared(channel = {}) {
  return Boolean(Object.keys(buildClearKeys(channel)).length || /clearkey/i.test(channel.licenseType || ''));
}

/** Source credentials belong to media, never a DRM/timing service. */
function headersForLiveTarget(channel = {}, uri = '') {
  const headers = liveSourceHeaders(channel);
  let sameOrigin = false;
  try { sameOrigin = new URL(uri).origin === new URL(channel.url).origin; } catch {}
  if (!sameOrigin) {
    for (const name of Object.keys(headers)) {
      if (/cookie|authorization|token|api[-_]?key/i.test(name)) delete headers[name];
    }
  }
  return { ...channel, headers, cookie: headers.cookie || '' };
}

/** Shaka already probes the real manifest codecs/key system during load. */
function customLiveError(error, channel = {}) {
  if (clearKeyDeclared(channel) && [6000, 6001].includes(Number(error?.code))) {
    return { code: error.code, kind: 'drm', retriable: false, action: 'none',
      message: 'This channel requires ClearKey DRM, which needs Chromium/Firefox desktop or Android Chrome.' };
  }
  // HTTP 401/403/451 often means token expired or geo-block — trigger policy-recover
  // 451 is used by jiotv CDN for geo-block / legal (seen from non-IN IP)
  if ([1001, 1002].includes(Number(error?.code)) && /401|403|451/i.test(String(error?.message || error?.data || ''))) {
    return { code: error.code, kind: 'network', retriable: true, action: 'refresh-token', message: 'Access token expired — refreshing...' };
  }
  return null;
}

function isPocketChannel(channel = {}) {
  return channel?.sourceId === 'pocket-tamil' || channel?.source === 'Pocket Tamil';
}

function buildPocketProxyUrl(uri = '', channel = {}, fallbackReferer = '') {
  const params = new URLSearchParams({ u: uri });
  if (channel.userAgent) params.set('ua', channel.userAgent);
  if (channel.referer || fallbackReferer) params.set('ref', channel.referer || fallbackReferer);
  if (channel.cookie) params.set('ck', channel.cookie);
  return `/api/live-pocket/proxy?${params.toString()}`;
}

/**
 * Generic live proxy for header-carrying channels that are neither Jio nor Pocket
 */
function needsProxyFallback(channel = {}) {
  // Owner override: manual channels flagged forceProxy always use the relay.
  if (channel.forceProxy) return true;
  return !isJioChannel(channel) && !isPocketChannel(channel)
    && Boolean(Object.keys(liveSourceHeaders(channel)).length || /^http:\/\//i.test(channel.url || ''));
}

function buildLiveProxyUrl(uri = '', channel = {}) {
  const headers = liveSourceHeaders(channel);
  const params = new URLSearchParams({ u: uri });
  if (headers['user-agent']) params.set('ua', headers['user-agent']);
  if (headers.referer) params.set('ref', headers.referer);
  if (headers.cookie) params.set('ck', headers.cookie);
  const extra = { ...headers };
  delete extra['user-agent']; delete extra.referer; delete extra.cookie;
  if (Object.keys(extra).length) params.set('hd', JSON.stringify(extra));
  return `/api/live-proxy?${params.toString()}`;
}

function restoreLiveProxyUri(uri = '', origin = '') {
  try {
    const parsed = new URL(uri, origin || 'http://localhost');
    if (parsed.pathname === '/api/live-proxy') return parsed.searchParams.get('u') || uri;
  } catch {}
  return uri;
}

/** Optional owner-configured relay. */
function buildStreamProxyUrl(uri = '', channel = {}) {
  const base = String(channel.streamProxy || '').trim().replace(/\/?$/, '');
  if (!base || !/^https?:\/\//i.test(uri)) return uri;
  const params = new URLSearchParams({ url: uri });
  if (channel.userAgent) params.set('ua', channel.userAgent);
  if (channel.referer) params.set('ref', channel.referer);
  if (channel.cookie) params.set('cookie', channel.cookie);
  return `${base}/?${params.toString()}`;
}

function onStreamProxy(uri = '', channel = {}) {
  const base = String(channel.streamProxy || '').trim().replace(/\/?$/, '');
  return Boolean(base) && String(uri || '').startsWith(`${base}/`);
}

function restorePocketProxyUri(uri = '', origin = '') {
  try {
    const parsed = new URL(uri, origin || 'http://localhost');
    if (origin && parsed.origin === origin && parsed.pathname === '/api/live-pocket/proxy') {
      return parsed.searchParams.get('u') || uri;
    }
    if (parsed.pathname === '/api/live-pocket/proxy') return parsed.searchParams.get('u') || uri;
  } catch {}
  return uri;
}

function getLocalJioCookie() {
  if (typeof window === 'undefined') return '';
  try {
    const cookie = normalizeJioCookie(window.localStorage.getItem(JIO_COOKIE_OVERRIDE_KEY) || '');
    return isJioCookieValid(cookie) ? cookie : '';
  } catch {
    return '';
  }
}

/**
 * Resolve Jio access token
 */
async function resolveJioAccess(channel = {}, { force = false, fetchImpl } = {}) {
  const fallbackUrl = String(channel.url || '');
  const localCookie = getLocalJioCookie();
  if (localCookie) return { cookie: localCookie, playbackUrl: fallbackUrl, scoped: false, source: 'local-override' };

  // HJH worker channels carry their own freshly-minted __hdnea__ (captured
  // server-side by /api/live/resolve from the worker 302). Never call the
  // Render-hosted /api/live-jio sweep for them: the sweep is geo-irrelevant to
  // a worker token and can be empty even when the stream is perfectly playable.
  // If the token is missing/expired, re-follow the worker redirect in the
  // browser — the viewer's own IP does the geo hop, not the server.
  if (isHjhWorkerChannel(channel) || /hjh-545\.pages\.dev/i.test(String(channel.workerUrl || ''))) {
    const existing = normalizeJioCookie(channel.cookie || '');
    const scopedExisting = existing.includes('acl=') && !existing.includes('acl=/*');
    if (!force && isJioCookieValid(existing)) {
      return { cookie: existing, playbackUrl: fallbackUrl, scoped: scopedExisting, source: 'hjh-worker' };
    }
    const workerUrl = String(channel.workerUrl || '');
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (workerUrl && doFetch) {
      try {
        const response = await doFetch(workerUrl, { redirect: 'follow', cache: 'no-store' });
        const signedUrl = String(response.url || '');
        const token = normalizeJioCookie(signedUrl);
        if (token && isJioCookieValid(token)) {
          return {
            cookie: token,
            playbackUrl: signedUrl || fallbackUrl,
            scoped: token.includes('acl=') && !token.includes('acl=/*'),
            source: 'hjh-worker-refresh',
          };
        }
      } catch { /* fall through to stale/empty */ }
    }
    if (isJioCookieValid(existing)) {
      return { cookie: existing, playbackUrl: fallbackUrl, scoped: scopedExisting, source: 'hjh-stale' };
    }
  }

  const channelCookie = normalizeJioCookie(channel.cookie || '');
  const scoped = channelCookie.includes('/bpk-tv/') || (channelCookie.includes('acl=') && !channelCookie.includes('acl=/*'));
  if (!force && scoped && isJioCookieValid(channelCookie)) {
    return { cookie: channelCookie, playbackUrl: fallbackUrl, scoped: true, source: 'channel' };
  }

  try {
    const params = new URLSearchParams();
    if (force) params.set('force', '1');
    if (channel.tvgId) params.set('channelId', channel.tvgId);
    if (channel.name) params.set('name', channel.name);
    if (fallbackUrl) params.set('channelUrl', fallbackUrl);
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (doFetch) {
      const response = await doFetch(`/api/live-jio?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      const cookie = normalizeJioCookie(data.cookie || '');
      const playbackUrl = String(data.playbackUrl || fallbackUrl);
      if (response.ok && isJioCookieValid(cookie) && isJioChannel({ url: playbackUrl })) {
        return { cookie, playbackUrl, scoped: Boolean(data.scoped), source: 'api' };
      }
    }
  } catch {}

  return {
    cookie: isJioCookieValid(channelCookie) ? channelCookie : '',
    playbackUrl: fallbackUrl,
    scoped,
    source: 'stale-channel',
  };
}

function classifyUri(uri = '', channel = {}) {
  const text = String(uri || '').toLowerCase();
  // hjh-545 worker redirects to jiotv — treat presence of __hdnea__ as Jio hint
  const hasHdnea = /__hdnea__|hdntl|acl=/.test(text) || /__hdnea__|hdntl/.test(String(channel.cookie||''));
  const category = normalizeKey(channel.category || '');
  const name = normalizeKey(channel.name || '');
  return {
    jio: isJioChannel(channel, uri),
    hotstar: text.includes('hotstar.com'),
    fancode: text.includes('fancode.com') || text.includes('fblive.fancode.com') || category === 'fancode' || name.includes('fancode'),
  };
}

/**
 * @returns {{ name, live, resolve(recover), recover, configure, hasRecovery }}
 */
export function createLiveTvPolicy(channel = {}, options = {}) {
  const {
    fetchImpl,
    origin = typeof window !== 'undefined' ? window.location.origin : '',
    pocketProxyEnabled: initialPocketProxy = false,
    allowNativeHls = true,
  } = options;

  const state = {
    pocketProxyEnabled: Boolean(initialPocketProxy),
    jioProxyEnabled: false,
    liveProxyEnabled: (needsProxyFallback(channel) && !isJioChannel(channel)) || (Boolean(String(channel.url||'').includes('|')) && !isJioChannel(channel, String(channel.url||''))),
    streamProxyEnabled: false,
    jioCookie: '',
    jioScoped: false,
    attemptedForce: false,
    accessSource: '',
    hjhRefreshed: false,
  };

  // HJH worker URLs resolve (in /api/live/resolve) to a signed Jio CDN
  // manifest plus its own __hdnea__ token, so they ride the normal Jio path
  // below WITHOUT the /api/live-jio sweep (see resolveJioAccess). hjhWorker
  // only changes recovery: the Render Jio proxy would 451, so a refresh means
  // re-following the worker redirect in the browser instead.
  const hjhWorker = isHjhWorkerChannel(channel) || /hjh-545\.pages\.dev/i.test(String(channel.workerUrl || ''));
  const usesJio = isJioChannel(channel);
  const pocket = isPocketChannel(channel);
  const liveProxy = needsProxyFallback(channel);
  const streamProxy = Boolean(String(channel.streamProxy || '').trim());

  async function resolve({ force = false, prior = null } = {}) {
    const drm = buildLiveDrm(channel);
    let jioCookie = '';
    let playbackUrl = String(channel.url || '');

    if (usesJio) {
      const access = await resolveJioAccess(channel, { force: force || state.attemptedForce, fetchImpl });
      jioCookie = access.cookie;
      playbackUrl = access.playbackUrl || playbackUrl;
      state.jioScoped = Boolean(access.scoped);
      state.accessSource = access.source;
      state.attemptedForce = state.attemptedForce || Boolean(force);
      if (!jioCookie) {
        const error = new Error('No valid Jio token available. Paste fresh __hdnea__ token in Live Service → Tools.');
        error.kind = 'drm';
        error.action = 'refresh-token';
        throw error;
      }
    }
    state.jioCookie = jioCookie;

    const requestFilter = (requestType, request, ctx = {}) => {
      const shaka = ctx.shaka;
      const uri = request.uris?.[0] || '';
      const originalUri = restoreJioProxyUrl(uri, origin);
      const kinds = classifyUri(originalUri, channel);
      const proxySegments = !state.jioScoped || !jioCookie;

      // License requests get special handling: always forward auth
      const types = shaka?.net?.NetworkingEngine?.RequestType || { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 };
      const isLicense = requestType === types.LICENSE;

      if (isLicense) {
        // License: inject Authorization/customData from channel.headers if present
        const h = channel.headers || {};
        const auth = h.Authorization || h.authorization || channel.licenseToken || '';
        if (auth) request.headers['Authorization'] = String(auth);
        if (h.customData) request.headers['customData'] = String(h.customData);
        if (h['x-api-key']) request.headers['X-Api-Key'] = String(h['x-api-key']);
        // If license URL itself needs auth and CORS blocks, proxy it
        const licenseProxy = /^https?:\/\//i.test(request.uris[0]) && (auth || Object.keys(h).length > 2);
        if (licenseProxy) {
          const params = new URLSearchParams({ u: request.uris[0] });
          if (auth) params.set('auth', auth);
          if (h.customData) params.set('customData', h.customData);
          request.uris[0] = `/api/live-license?${params.toString()}`;
        }
        return;
      }

      if (!usesJio && !pocket) {
        request.headers ||= {};
        const sourceHeaders = liveSourceHeaders(channel);
        for (const name of Object.keys(request.headers)) {
          if (name.toLowerCase() in sourceHeaders || /^(user-agent|referer|referrer|cookie|origin)$/i.test(name)) delete request.headers[name];
        }
        const media = requestType === types.MANIFEST || requestType === types.SEGMENT;
        request.uris = (request.uris || []).map((candidate) => {
          let isLocalRelay = false;
          try { const parsed = new URL(candidate, origin || 'http://localhost'); isLocalRelay = parsed.pathname === '/api/live-proxy' && (!origin || parsed.origin === origin); } catch {}
          if (isLocalRelay || onStreamProxy(candidate, channel)) return candidate;
          if (!/^https?:\/\//i.test(candidate)) return candidate;
          const relayChannel = media ? headersForLiveTarget(channel, candidate) : {};
          if (state.streamProxyEnabled && media) return buildStreamProxyUrl(candidate, relayChannel);
          if (state.liveProxyEnabled) return buildLiveProxyUrl(candidate, relayChannel);
          if (media) Object.assign(request.headers, liveSourceHeaders(relayChannel));
          return candidate;
        });
        for (const name of Object.keys(request.headers)) {
          if (/^(user-agent|referer|referrer|cookie|origin)$/i.test(name)) delete request.headers[name];
        }
        return;
      }

      if (channel.headers && typeof channel.headers === 'object') {
        for (const [key, value] of Object.entries(channel.headers)) {
          if (!key || value == null || value === '' || /^cookie$/i.test(key)) continue;
          if (kinds.jio && /^(?:user-agent|referer|referrer)$/i.test(key)) continue;
          request.headers[key] = String(value);
        }
      }

      if (!kinds.jio) {
        if (channel.referer) request.headers.Referer = channel.referer;
        else if (kinds.hotstar) request.headers.Referer = 'https://www.hotstar.com/';
        else if (kinds.fancode) request.headers.Referer = 'https://www.fancode.com/';

        const userAgent = channel.userAgent || (kinds.fancode ? FANCODE_UA : '');
        if (userAgent) request.headers['User-Agent'] = userAgent;
      }

      const alreadyProxied = onStreamProxy(originalUri, channel) || /\/api\/live-proxy(\?|$)/.test(originalUri);
      let nextUri = originalUri;
      // Jio DASH manifests reference segments by RELATIVE url, so RFC 3986
      // resolution drops the manifest's ?__hdnea__ query — those unsigned
      // segment requests return 403. Re-attach the token to every Jio URI
      // missing one, whether the cookie is scoped or not (the old
      // proxySegments gate skipped scoped cookies and caused exactly this).
      if (kinds.jio && jioCookie && /^https?:\/\//i.test(originalUri) && !alreadyProxied) {
        const hasToken = /(?:__hdnea__|hdnea)=/i.test(originalUri);
        if (!hasToken || proxySegments) {
          nextUri = appendJioCookieToUrl(originalUri, jioCookie);
          request.uris[0] = state.jioProxyEnabled ? buildJioProxyUrl(nextUri, jioCookie) : nextUri;
        }
      }

      if (alreadyProxied) {
        // keep
      } else if (state.streamProxyEnabled && /^https?:\/\//i.test(nextUri)) {
        request.uris[0] = buildStreamProxyUrl(nextUri, channel);
        delete request.headers['User-Agent'];
        delete request.headers.Referer;
        delete request.headers.Cookie;
      } else if (state.liveProxyEnabled && /^https?:\/\//i.test(nextUri)) {
        request.uris[0] = buildLiveProxyUrl(nextUri, channel);
        delete request.headers['User-Agent'];
        delete request.headers.Referer;
        delete request.headers.Cookie;
      } else if (state.pocketProxyEnabled && /^https?:\/\//i.test(nextUri)) {
        const fallbackReferer = channel.referer || (kinds.hotstar ? 'https://www.hotstar.com/' : '') || (kinds.fancode ? 'https://www.fancode.com/' : '');
        request.uris[0] = buildPocketProxyUrl(nextUri, channel, fallbackReferer);
        delete request.headers['User-Agent'];
        delete request.headers.Referer;
        delete request.headers.Cookie;
      }
      void shaka;
      void requestType;
    };

    const responseFilter = (requestType, response) => {
      proxyResponseBase(requestType, response);
      if (!response?.uri) return;
      if (state.jioProxyEnabled) response.uri = restoreJioProxyUrl(response.uri, origin);
      if (state.liveProxyEnabled) response.uri = restoreLiveProxyUri(response.uri, origin);
      if (state.pocketProxyEnabled) response.uri = restorePocketProxyUri(response.uri, origin);
      void requestType;
    };

    const uriKinds = classifyUri(playbackUrl, channel);
    const needsHeaderRewrite =
      usesJio ||
      state.pocketProxyEnabled ||
      state.liveProxyEnabled ||
      state.streamProxyEnabled ||
      Object.keys(channel.headers || {}).length > 0 ||
      Boolean(channel.referer) ||
      Boolean(channel.userAgent) ||
      uriKinds.hotstar ||
      uriKinds.fancode;

    let resolvedUrl = playbackUrl;
    if (state.streamProxyEnabled && !usesJio && !pocket && /^https?:\/\//i.test(playbackUrl)) {
      resolvedUrl = buildStreamProxyUrl(playbackUrl, channel);
    } else if (state.liveProxyEnabled && /^https?:\/\//i.test(playbackUrl)) {
      resolvedUrl = buildLiveProxyUrl(playbackUrl, channel);
    } else if (state.streamProxyEnabled && /^https?:\/\//i.test(playbackUrl)) {
      resolvedUrl = buildStreamProxyUrl(playbackUrl, channel);
    }
    if (usesJio && jioCookie) {
      const withToken = appendJioCookieToUrl(playbackUrl, jioCookie);
      resolvedUrl = state.jioProxyEnabled ? buildJioProxyUrl(withToken, jioCookie) : withToken;
    }

    // Build full multi-DRM config (Widevine+PlayReady+FairPlay) when license servers exist
    // buildLiveDrm already returns { servers, advanced } — use it directly
    const hasDrmServers = Boolean(drm.servers && Object.keys(drm.servers).length);
    const hasClearKeys = Boolean(drm.clearKeys && Object.keys(drm.clearKeys).length);

    return {
      url: resolvedUrl,
      kind: !usesJio && !pocket ? detectKind(playbackUrl, { streamType: channel.format }) : 'auto',
      mimeType: !usesJio && !pocket ? mimeTypeFor(detectKind(playbackUrl, { streamType: channel.format })) : undefined,
      live: true,
      allowNativeHls: allowNativeHls && !needsHeaderRewrite,
      drm,
      hasDrm: hasDrmServers || hasClearKeys,
      hasDrmServers,
      hasClearKeys,
      http: { requestFilter, responseFilter },
      meta: { jio: usesJio, pocket, channel: channel.name || channel.channelId, accessSource: state.accessSource },
      prior,
    };
  }

  async function recover({ error = null } = {}) {
    // HJH: never enable the Render Jio proxy (non-Indian egress → 451). A
    // reload re-runs resolve(), which re-follows the worker redirect in the
    // viewer's browser and obtains a fresh signed token.
    if (hjhWorker && !state.hjhRefreshed) {
      state.hjhRefreshed = true;
      state.attemptedForce = true;
      return { message: `HJH token rejected${error?.code ? ` (Shaka ${error.code})` : ''} — refreshing from worker…`, retry: 'reload' };
    }
    if (hjhWorker) return null;
    if (pocket && !state.pocketProxyEnabled && /^https?:\/\//i.test(String(channel.url || ''))) {
      state.pocketProxyEnabled = true;
      return { message: 'Direct Pocket playback failed — retrying through proxy…', retry: 'reload' };
    }
    if (streamProxy && !state.streamProxyEnabled) {
      state.streamProxyEnabled = true;
      return { message: 'Retrying through configured stream relay…', retry: 'reload' };
    }
    if (liveProxy && !state.liveProxyEnabled && !usesJio) {
      state.liveProxyEnabled = true;
      return { message: 'Direct playback failed — retrying via server proxy with stream headers…', retry: 'reload' };
    }
    if (liveProxy && !state.liveProxyEnabled && usesJio) {
      // Jio streams are geo-sensitive — proxying via non-IN server will 451. Do not proxy, surface token/geo hint.
      return { message: `Stream rejected${error?.code ? ` (Shaka ${error.code})` : ''} — token may be expired or geo-blocked. Re-sync source (runs every 30m) or try Auto IPTV source. Same WiFi should work directly.`, retry: null };
    }
    if (usesJio && !state.jioProxyEnabled) {
      state.jioProxyEnabled = true;
      state.attemptedForce = true;
      const isExpired = /401|403|451|expired|token/i.test(String(error?.message||''));
      return { message: isExpired ? `Token expired${error?.code ? ` (Shaka ${error.code})` : ''} — refreshing via proxy…` : `Jio direct failed${error?.code ? ` (Shaka ${error.code})` : ''} — refreshing token…`, retry: 'reload' };
    }
    if (usesJio && state.jioProxyEnabled) return null;
    return null;
  }

  return {
    name: 'live-tv',
    live: true,
    needsMuxjs: true,
    // The /live page keeps the channel grid visible beside the player, so the
    // full-viewport ambient dimming/blur portal (on by default in prefs) would
    // blur the whole page once playback starts. Live TV never uses it.
    ambient: false,
    ...(!usesJio && !pocket ? {
      mapError: (error) => customLiveError(error, channel),
      startupAware: true,
      maxLadderMs: 60_000,
      ladder: [RUNGS.RETRY_STREAMING, RUNGS.REANCHOR, RUNGS.POLICY_RECOVER, RUNGS.RELOAD, RUNGS.ROTATE_SOURCE],
    } : {}),
    // Tuned for live: lowLatencyMode true, live sync, shorter buffering
    playerConfig: !usesJio && !pocket ? {
      manifest: { defaultPresentationDelay: 6 },
      streaming: { safeSeekOffset: 2, bufferingGoal: 12, rebufferingGoal: 2, bufferBehind: 10, lowLatencyMode: true, inaccurateManifestTolerance: 0, useNativeHlsForFairPlay: false, retryParameters: { maxAttempts: 3, baseDelay: 300, backoffFactor: 1.5, timeout: 8000 } },
      abr: { enabled: true, defaultBandwidthEstimate: 1_200_000, switchInterval: 4, bandwidthUpgradeTarget: 0.85, bandwidthDowngradeTarget: 0.95 },
      manifest_retry: { maxAttempts: 2, baseDelay: 300, timeout: 5000 },
    } : {
      manifest: { defaultPresentationDelay: 4 },
      streaming: { safeSeekOffset: 2, bufferingGoal: 10, rebufferingGoal: 2, lowLatencyMode: true, inaccurateManifestTolerance: 0, useNativeHlsForFairPlay: false },
      abr: { enabled: true, defaultBandwidthEstimate: 1_000_000, switchInterval: 2 },
    },
    loadTimeoutMs: usesJio ? 30_000 : 22_000,
    resolve,
    recover,
    hasRecovery: () => Boolean(
      (pocket && !state.pocketProxyEnabled)
      || (usesJio && !state.jioProxyEnabled && !(hjhWorker && state.hjhRefreshed))
      || (streamProxy && !state.streamProxyEnabled)
      || (liveProxy && !state.liveProxyEnabled),
    ),
    describe: () => ({ ...state }),
  };
}
