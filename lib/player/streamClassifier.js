/**
 * lib/player/streamClassifier.js
 *
 * Turns a Live catalog row ("channel") into the facts the engine router needs:
 * transport, DRM system, header requirements, scheme, token expiry.
 *
 * Deliberately pure and dependency-free so it can run in Node (tests, the
 * playlist builder's dry-runs) and in the browser alike.
 *
 * The inputs are the fields jashvibes already stores on LiveChannel and sends
 * to the client (see lib/liveService.js → toClientChannel).
 */

const RAW_TS_RE = /\.(ts|m2ts|mts)(\?|$)/i;
const XTREAM_TS_RE = /[?&]extension=ts\b|\/live\/[^/]+\/[^/]+\/\d+(\.ts)?(\?|$)/i;
const FLV_RE = /\.flv(\?|$)|extension=flv/i;
const PROGRESSIVE_RE = /\.(mp4|m4v|mov|webm|mkv|avi|ogv|mp3|m4a)(\?|$)/i;
const HLS_HINT_RE = /\.m3u8|\.m3u(\?|$)|\/m3u\/|\/m3u\?|playlist\.m3u8|index\.m3u8/i;
const DASH_HINT_RE = /\.mpd|\/mpd\/|\/mpd\?|mpd\.php|manifest\.mpd/i;

/** Token expiry baked into the URL or the cookie by the CDN (Akamai/Jio style). */
export function readTokenExpiry(...values) {
  const haystack = values.filter(Boolean).join(' ');
  const re = /(?<![0-9])(?:exp|expires|hdnts_exp|st)=(%3D)?=?(\d{9,12})(?![0-9])/gi;
  let latest = 0;
  let match;
  while ((match = re.exec(haystack))) {
    const ts = Number(match[2]);
    if (ts > 1_600_000_000 && ts < 4_000_000_000) latest = Math.max(latest, ts * 1000);
  }
  return latest || null;
}

/** Which DRM, if any, this row carries. ClearKey pairs are stored as keyId/key. */
export function readDrm(channel = {}) {
  const keyId = String(channel.keyId || '').trim();
  const key = String(channel.key || '').trim();
  const license = String(channel.licenseKey || '').trim();
  const type = String(channel.licenseType || '').trim().toLowerCase();

  if (keyId && key) {
    return {
      system: 'clearkey',
      keyId,
      key,
      clearKeys: { [keyId.toLowerCase()]: key.toLowerCase() },
      licenseServer: '',
      licenseType: type || 'clearkey',
    };
  }
  if (license) {
    // A licence URL means a licence server speaks for the keys.
    if (type.includes('widevine')) return { system: 'widevine', licenseServer: license, licenseType: 'widevine' };
    if (type.includes('playready')) return { system: 'playready', licenseServer: license, licenseType: 'playready' };
    if (type.includes('fairplay')) return { system: 'fairplay', licenseServer: license, licenseType: 'fairplay' };
    // Kid:key inline is also seen in licenseKey.
    const pair = license.match(/^([0-9a-f]{16,64})\s*:\s*([0-9a-f]{16,64})$/i);
    if (pair) return { system: 'clearkey', keyId: pair[1], key: pair[2], clearKeys: { [pair[1].toLowerCase()]: pair[2].toLowerCase() }, licenseType: 'clearkey' };
    return { system: 'unknown', licenseServer: license, licenseType: type };
  }
  return { system: 'none', licenseType: '' };
}

export function classifyStream(channel = {}) {
  // Defensive: a raw `url|User-Agent=…&Referer=…` row (as it appears in the
  // donor playlists) is understood even if the importer did not normalise it.
  let rawUrl = String(channel.url || '');
  let pipedUserAgent = '';
  let pipedReferer = '';
  if (rawUrl.includes('|')) {
    const [head, tail = ''] = rawUrl.split('|');
    rawUrl = head.trim();
    for (const pair of tail.split('&')) {
      const [k, ...rest] = pair.split('=');
      const v = rest.join('=').trim();
      if (!k || !v) continue;
      if (/user-agent/i.test(k)) pipedUserAgent = v;
      else if (/referer|referrer/i.test(k)) pipedReferer = v;
    }
  }
  const url = rawUrl;
  const format = String(channel.format || '').toLowerCase();
  const drm = readDrm(channel);

  let transport = 'unknown';
  if (HLS_HINT_RE.test(url)) transport = 'hls';
  else if (DASH_HINT_RE.test(url)) transport = 'dash';
  else if (FLV_RE.test(url)) transport = 'flv';
  else if (RAW_TS_RE.test(url) || XTREAM_TS_RE.test(url)) transport = 'ts';
  else if (PROGRESSIVE_RE.test(url)) transport = 'progressive';
  else if (format === 'hls') transport = 'hls';
  else if (format === 'dash') transport = 'dash';
  else if (format === 'video') transport = 'progressive';
  else transport = 'unknown';

  const headerKeys = Object.keys(channel.headers || {}).filter((k) => !/^cookie$/i.test(k) && channel.headers[k]);
  const needsHeaders = Boolean(
    String(channel.userAgent || pipedUserAgent || '').trim()
    || String(channel.referer || pipedReferer || '').trim()
    || String(channel.cookie || '').trim()
    || headerKeys.length,
  );

  const scheme = /^http:\/\//i.test(url) ? 'http' : /^https:\/\//i.test(url) ? 'https' : 'other';
  const isJio = /jiotv|jiotvmblive|jiotvpllive|nw18live/i.test(url) || /jio/i.test(channel.sourceId || '');

  return {
    url,
    transport,
    format,
    drm,
    jio: isJio,
    needsHeaders,
    headerKeys,
    scheme,
    live: true,
    expiresAt: readTokenExpiry(url, channel.cookie, channel.userAgent, channel.referer),
    // Unknown transports are worth handing to the manifest-aware engine anyway.
    probeable: transport === 'unknown' || transport === 'hls' || transport === 'dash',
  };
}

/* ------------------------------------------------------- manifest peeking */

/** Pull video/audio codecs out of an HLS master playlist. */
export function codecsFromHlsMaster(text = '') {
  const out = { video: '', audio: '' };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^#EXT-X-STREAM-INF:.*CODECS="([^"]+)"/i);
    if (m) {
      for (const codec of m[1].split(',')) {
        const c = codec.trim();
        if (!c) continue;
        if (/^(mp4a|ac-3|ec-3|opus|flac)/i.test(c)) { if (!out.audio) out.audio = c; }
        else if (!out.video) out.video = c;
      }
    }
    const a = line.match(/^#EXT-X-MEDIA:.*CODECS="([^"]+)"/i);
    if (a && !out.audio) out.audio = a[1].split(',')[0].trim();
    if (out.video && out.audio) break;
  }
  return out;
}

/** Pull video/audio codecs out of a DASH MPD. */
export function codecsFromMpd(text = '') {
  const out = { video: '', audio: '' };
  const re = /<AdaptationSet[^>]*>|<Representation[^>]*>/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[0];
    const codec = (tag.match(/codecs="([^"]+)"/i) || [])[1] || '';
    if (!codec) continue;
    const isAudio = /mimeType="audio/i.test(tag) || /<AdaptationSet[^>]*audio/i.test(tag);
    if (isAudio) { if (!out.audio) out.audio = codec; }
    else if (!out.video) out.video = codec;
    if (out.video && out.audio) break;
  }
  if (!out.video) {
    const any = (String(text).match(/codecs="([^"]+)"/i) || [])[1];
    if (any) out.video = any;
  }
  return out;
}

/**
 * Fetch just enough of a manifest to learn its codecs (and, for HLS, whether
 * the segments are TS or fMP4). Bounded, cached by the caller if needed.
 */
export async function peekManifest(stream, { fetchImpl = globalThis.fetch, headers = {}, timeoutMs = 8000 } = {}) {
  if (!stream?.probeable || !/^https?:/i.test(stream.url)) return { ok: false, reason: 'not probeable' };
  try {
    const res = await fetchImpl(stream.url, {
      headers: { ...headers, Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = (await res.text()).slice(0, 200_000);
    if (/^#EXTM3U/i.test(text.trim())) {
      const master = /#EXT-X-STREAM-INF/i.test(text);
      return {
        ok: true,
        kind: master ? 'hls-master' : 'hls-media',
        codecs: master ? codecsFromHlsMaster(text) : { video: '', audio: '' },
        segmentContainer: /\.m4s|\.mp4|\.cmfv|\.cmfa/i.test(text) ? 'fmp4' : 'ts',
      };
    }
    if (/<MPD[\s>]/i.test(text)) {
      return { ok: true, kind: 'dash', codecs: codecsFromMpd(text), segmentContainer: 'fmp4' };
    }
    return { ok: true, kind: 'opaque', codecs: { video: '', audio: '' }, segmentContainer: '' };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error).slice(0, 120) };
  }
}
