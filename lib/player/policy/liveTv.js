/**
 * Live-TV playback policy.
 *
 * This is the single home for everything that used to be copy-pasted twice in
 * app/live/page.js (the main player engine and the service-panel preview fork).
 * The unified player only knows about a declarative source + two request
 * filters; the Jio token dance, ClearKey parsing and Pocket proxy rewriting
 * live here so both surfaces behave identically.
 *
 * Recovery order preserved from the old page:
 *   1. direct URL with the current cookie
 *   2. Pocket channels that failed direct → retry through /api/live-pocket/proxy
 *   3. Jio channels that failed → force-refresh the token, then the server
 *      proxy route (/api/live-jio) which can set forbidden headers
 */

import {
  appendJioCookieToUrl,
  buildJioProxyUrl,
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

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function buildClearKeys(channel = {}) {
  const license = String(channel?.licenseKey || '').trim();
  if (license && license.includes(':') && !/^https?:\/\//i.test(license)) {
    const [keyId, key] = license.split(':');
    const kid = cleanHex(keyId);
    const clearKey = cleanHex(key);
    if (kid && clearKey) return { [kid]: clearKey };
  }

  const kid = cleanHex(channel?.keyId || '');
  const clearKey = cleanHex(channel?.key || '');
  if (kid && clearKey && kid !== 'null' && clearKey !== 'null') return { [kid]: clearKey };
  return {};
}

export function isPocketChannel(channel = {}) {
  return channel?.sourceId === 'pocket-tamil' || channel?.source === 'Pocket Tamil';
}

export function buildPocketProxyUrl(uri = '', channel = {}, fallbackReferer = '') {
  const params = new URLSearchParams({ u: uri });
  if (channel.userAgent) params.set('ua', channel.userAgent);
  if (channel.referer || fallbackReferer) params.set('ref', channel.referer || fallbackReferer);
  if (channel.cookie) params.set('ck', channel.cookie);
  return `/api/live-pocket/proxy?${params.toString()}`;
}

export function restorePocketProxyUri(uri = '', origin = '') {
  try {
    const parsed = new URL(uri, origin || 'http://localhost');
    if (origin && parsed.origin === origin && parsed.pathname === '/api/live-pocket/proxy') {
      return parsed.searchParams.get('u') || uri;
    }
    if (parsed.pathname === '/api/live-pocket/proxy') return parsed.searchParams.get('u') || uri;
  } catch {}
  return uri;
}

export function getLocalJioCookie() {
  if (typeof window === 'undefined') return '';
  try {
    const cookie = normalizeJioCookie(window.localStorage.getItem(JIO_COOKIE_OVERRIDE_KEY) || '');
    return isJioCookieValid(cookie) ? cookie : '';
  } catch {
    return '';
  }
}

/**
 * Resolve the best available Jio access token for a channel.
 * Kept exported because the service panel still previews token health.
 */
export async function resolveJioAccess(channel = {}, { force = false, fetchImpl } = {}) {
  const fallbackUrl = String(channel.url || '');
  const localCookie = getLocalJioCookie();
  if (localCookie) return { cookie: localCookie, playbackUrl: fallbackUrl, scoped: false, source: 'local-override' };

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
  const category = normalizeKey(channel.category || '');
  const name = normalizeKey(channel.name || '');
  return {
    jio: isJioChannel(channel, uri),
    hotstar: text.includes('hotstar.com'),
    fancode: text.includes('fancode.com') || text.includes('fblive.fancode.com') || category === 'fancode' || name.includes('fancode'),
  };
}

/**
 * @returns {{
 *   name: string,
 *   live: boolean,
 *   resolve(arg:{force?:boolean, prior?:object}): Promise<object>,
 *   recover?(arg:{error:object, attempt:number, source:object}): Promise<object|null>,
 *   configure?(player, ctx): void,
 *   watch?: { timeoutMs: number }
 * }}
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
    jioCookie: '',
    jioScoped: false,
    attemptedForce: false,
    accessSource: '',
  };

  const usesJio = isJioChannel(channel);
  const pocket = isPocketChannel(channel);

  async function resolve({ force = false, prior = null } = {}) {
    const clearKeys = buildClearKeys(channel);
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
        const error = new Error('No valid Jio token is available. Paste a fresh __hdnea__ token in Live Service → Tools.');
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

      if (channel.headers && typeof channel.headers === 'object') {
        for (const [key, value] of Object.entries(channel.headers)) {
          // Cookie is centralised in channel.cookie so stale EXTHTTP cookies
          // never override a freshly issued Jio token.
          if (!key || value == null || value === '' || /^cookie$/i.test(key)) continue;
          // Browsers refuse to set these; the server proxy does it for us.
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

      let nextUri = originalUri;
      if (kinds.jio && jioCookie && proxySegments) {
        // Stream4Liv technique: the Akamai token must ride on the manifest AND
        // every segment request, unencoded (acl=/* must stay literal).
        nextUri = appendJioCookieToUrl(originalUri, jioCookie);
        request.uris[0] = state.jioProxyEnabled ? buildJioProxyUrl(nextUri, jioCookie) : nextUri;
      }

      if (state.pocketProxyEnabled && /^https?:\/\//i.test(nextUri)) {
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
      if (!response?.uri) return;
      if (state.jioProxyEnabled) response.uri = restoreJioProxyUrl(response.uri, origin);
      if (state.pocketProxyEnabled) response.uri = restorePocketProxyUri(response.uri, origin);
      void requestType;
    };

    // Native HLS playback (Safari/iOS) cannot attach request headers or rewrite
    // segment URLs, so any channel that needs the Jio token, a Referer, a
    // custom UA or the Pocket proxy must go through Shaka even on Safari.
    const uriKinds = classifyUri(playbackUrl, channel);
    const needsHeaderRewrite =
      usesJio ||
      state.pocketProxyEnabled ||
      Boolean(channel.headers) ||
      Boolean(channel.referer) ||
      Boolean(channel.userAgent) ||
      uriKinds.hotstar ||
      uriKinds.fancode;

    let resolvedUrl = playbackUrl;
    if (usesJio && jioCookie) {
      // Stream4Liv technique: the token rides on the URL for direct playback;
      // once the secure route is on, the manifest itself goes through the proxy
      // (a native <video> source has no request filter to rewrite it).
      const withToken = appendJioCookieToUrl(playbackUrl, jioCookie);
      resolvedUrl = state.jioProxyEnabled ? buildJioProxyUrl(withToken, jioCookie) : withToken;
    }

    return {
      url: resolvedUrl,
      kind: 'auto',
      live: true,
      allowNativeHls: allowNativeHls && !needsHeaderRewrite,
      drm: Object.keys(clearKeys).length ? { clearKeys } : {},
      hasDrm: Object.keys(clearKeys).length > 0,
      http: { requestFilter, responseFilter },
      meta: { jio: usesJio, pocket, channel: channel.name || channel.channelId, accessSource: state.accessSource },
      prior,
    };
  }

  /** One recovery step at a time; null = nothing left to try. */
  async function recover({ error = null } = {}) {
    if (pocket && !state.pocketProxyEnabled && /^https?:\/\//i.test(String(channel.url || ''))) {
      state.pocketProxyEnabled = true;
      return { message: 'Direct Pocket playback failed — retrying through the Pocket proxy…', retry: 'reload' };
    }

    if (usesJio && !state.jioProxyEnabled) {
      state.jioProxyEnabled = true;
      state.attemptedForce = true;
      return { message: `Jio direct failed${error?.code ? ` (Shaka ${error.code})` : ''} — refreshing the token and using the secure route…`, retry: 'reload' };
    }

    if (usesJio && state.jioProxyEnabled) {
      return null;
    }
    return null;
  }

  return {
    name: 'live-tv',
    live: true,
    /** Several Jio feeds are raw MPEG-TS; Shaka's TS demuxer needs global muxjs. */
    needsMuxjs: true,
    /** Live edge behaviour, matching the values that worked in production. */
    playerConfig: {
      manifest: { defaultPresentationDelay: 5 },
      streaming: { safeSeekOffset: 5, bufferingGoal: 10, rebufferingGoal: 2, lowLatencyMode: true },
      abr: { enabled: true, defaultBandwidthEstimate: 1_000_000, restrictToElementSize: false, switchInterval: 1 },
    },
    loadTimeoutMs: usesJio ? 30_000 : 20_000,
    resolve,
    recover,
    /** True when the policy has a further trick up its sleeve. */
    hasRecovery: () => Boolean((pocket && !state.pocketProxyEnabled) || (usesJio && !state.jioProxyEnabled)),
    describe: () => ({ ...state }),
  };
}
