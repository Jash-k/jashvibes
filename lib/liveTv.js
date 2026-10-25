import { normalizeLiveHeaders, parseLiveHeaderOptions } from '@/lib/player/liveHeaders';
import {
  JIO_REFERER,
  JIO_USER_AGENT,
  appendJioCookieToUrl,
  getJioCookieExpiry,
  isJioChannel as isJioPlaybackChannel,
  isJioCookieValid,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

// --- phase-1 domain split: implementations now live under lib/live/* --------
import {
  cleanChannelName,
  detectFormat,
  detectSourceType,
  normalizeHttpUrl,
  normalizeWhitespace,
  parseAttrs,
  slugify,
} from '@/lib/live/ingest/text.js';
import {
  DEFAULT_SOURCES,
  POCKET_SOURCE,
  REMOVED_SOURCE_PATTERNS,
  getDefaultLiveSources,
  getSources,
  isPocketSource,
  isRemovedSource,
  parseSourceListFromEnv,
} from '@/lib/live/ingest/registry.js';
import {
  POPULAR_TAMIL_RULES,
  hasBlockedLiveCategory,
  hasBlockedRegionalLanguage,
  isEnglishOnlyChannel,
  isPocketRemovedChannel,
  isPocketWantedChannel,
  isPreferredCricketChannel,
  isSportsChannelText,
  isTamilChannel,
  isTamilMusicChannelText,
  parsePocketNameList,
  pocketCompactKey,
  pocketKey,
  popularityRank,
} from '@/lib/live/ingest/classify.js';
import { buildPlaybackHeaders } from '@/lib/live/playback/headers.js';

// Back-compat barrel: existing consumers keep importing these names from liveTv.
export { DEFAULT_SOURCES, getDefaultLiveSources } from '@/lib/live/ingest/registry.js';
export {
  isPocketWantedChannel,
  isPreferredCricketChannel,
  pocketKey,
} from '@/lib/live/ingest/classify.js';
export { buildPlaybackHeaders } from '@/lib/live/playback/headers.js';

// Recommended extra source (not auto-seeded — add via Admin -> TV Service -> Sources):
// { id:'hjh-jio', label:'HJH Jio (Auto IPTV mirror)', type:'m3u', url:'https:


const CACHE_TTL_MS = 60 * 60 * 1000;
const JIO_COOKIE_TTL_MS = 20 * 60 * 1000;
// How long a *failed* token sweep is remembered. Every provider being stale is the
// normal case during a Jio outage, and that used to be the one path with no cache at
// all: the sweep found nothing, cached nothing, and so re-ran on every request.
const JIO_COOKIE_MISS_TTL_MS = Number(process.env.LIVE_COOKIE_MISS_TTL_MS || 60_000);
// Per-URL budget while probing the mirrors. A dead host should cost a slice of one
// background sweep, not a slice of a viewer's request.
const JIO_COOKIE_PROBE_TIMEOUT_MS = Number(process.env.LIVE_COOKIE_TIMEOUT_MS || 2_000);
const WORKING_CHECK_TTL_MS = Number(process.env.LIVE_WORKING_CACHE_TTL_MS || 5 * 60 * 1000);
const WORKING_CHECK_TIMEOUT_MS = Number(process.env.LIVE_WORKING_TIMEOUT_MS || 2500);
// Segment verification chains up to four fetches (manifest hops + segment);
// it gets its own budget so a slow-but-real chain is not flagged dead.
const DEEP_CHECK_TIMEOUT_MS = Number(process.env.LIVE_DEEP_TIMEOUT_MS || 10_000);
const WORKING_CHECK_CONCURRENCY = Number(process.env.LIVE_WORKING_CONCURRENCY || 64);
const cache = globalThis.__jashLiveTvCache || { key: '', loadedAt: 0, channels: null };
const jioCookieCache = globalThis.__jashJioCookieCache || { value: '', loadedAt: 0, missAt: 0 };
const jioStarAccessCache = globalThis.__jashJioStarAccessCache || { records: [], loadedAt: 0 };
const workingCache = globalThis.__jashLiveWorkingCache || new Map();
globalThis.__jashLiveTvCache = cache;
globalThis.__jashJioCookieCache = jioCookieCache;
globalThis.__jashJioStarAccessCache = jioStarAccessCache;
globalThis.__jashLiveWorkingCache = workingCache;


function parsePipedStreamUrl(value = '') {
  const raw = String(value || '').trim();
  const [urlPart, ...optionParts] = raw.split('|');
  const optionsText = optionParts.join('|');
  const options = parseLiveHeaderOptions(optionsText);

  let decodedRaw = raw;
  try {
    decodedRaw = decodeURIComponent(raw);
  } catch {}

  return {
    url: urlPart.trim(),
    userAgent: options['user-agent'] || options.useragent || options.ua || '',
    cookie: options.cookie || options.cookies || extractJioCookieFromText(decodedRaw) || extractJioCookieFromText(raw) || '',
    referer: options.referer || '',
    headers: options,
  };
}

function appendCookieTokenToUrl(uri = '', cookie = '') {
  return appendJioCookieToUrl(uri, cookie);
}


function isJioChannel(channel = {}) {
  return isJioPlaybackChannel(channel);
}

function isStarSportsChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.url || ''}`.toLowerCase();
  return text.includes('star sports') || text.includes('star_sports') || text.includes('starsports');
}

function mapChannel(raw, source, index = 0) {
  // stream_url is the field name used by the Sony/Stream4Liv JSON feeds
  // (sportlive18/Sportlink-wtf/sony.json and the bundle behind
  // stream4liv.netlify.app). Without it every channel in those feeds parses to
  // nothing: measured 0 channels before, 31 after adding it here.
  const rawUrl = raw.url || raw.streamUrl || raw.stream_url || raw.link || raw.href || '';
  const piped = parsePipedStreamUrl(rawUrl);
  const url = normalizeHttpUrl(piped.url);
  if (!url) return null;

  const name = cleanChannelName(raw.name || raw.title || raw.channel || `Channel ${index + 1}`);
  const detectedFormat = detectFormat(url);
  const hint = String(raw.format || raw.manifestType || raw.manifest_type || '').toLowerCase();
  const format = ['hls', 'dash', 'video'].includes(detectedFormat) ? detectedFormat : ['hls', 'dash', 'video'].includes(hint) ? hint : detectedFormat;
  let category = normalizeWhitespace(raw.category || raw.group || raw.groupTitle || raw['group-title'] || 'Tamil');
  const language = normalizeWhitespace(raw.language || raw['tvg-language'] || (source.trustTamil ? 'Tamil' : ''));
  const region = normalizeWhitespace(raw.region || raw['tvg-region'] || '');
  const categoryText = `${name} ${category} ${language} ${region}`;
  if (isTamilMusicChannelText(categoryText)) category = 'Music';
  else if (isSportsChannelText(categoryText)) category = 'Sports';

  return {
    id: `${source.id}-${raw.id || raw.tvgId || slugify(name)}-${index}`,
    tvgId: String(raw.id || raw.tvgId || raw['tvg-id'] || ''),
    name,
    url,
    logo: normalizeHttpUrl(raw.logo || raw.tvgLogo || raw['tvg-logo'] || ''),
    category,
    language,
    region,
    sourceId: source.id,
    source: source.label,
    format,
    keyId: raw.keyId || raw.key_id || raw.kid || raw.keyid || '',
    key: raw.key || raw.key_val || raw.keyValue || raw.key_value || '',
    licenseKey: raw.licenseKey || raw.license_key || raw.license || raw.licenseUrl || raw.license_url || '',
    licenseType: raw.licenseType || raw.license_type || '',
    cookie: raw.cookie || raw.cookies || piped.cookie || normalizeLiveHeaders(raw.headers).cookie || extractJioCookieFromText(rawUrl) || '',
    userAgent: raw.userAgent || raw.user_agent || raw.ua || piped.userAgent || normalizeLiveHeaders(raw.headers)['user-agent'] || '',
    referer: raw.referer || raw.referrer || piped.referer || normalizeLiveHeaders(raw.headers).referer || '',
    headers: normalizeLiveHeaders({ ...piped.headers, ...normalizeLiveHeaders(raw.headers) }),
    playable: (format === 'hls' || format === 'dash' || format === 'video') && String(raw.licenseKey||'').toLowerCase() !== 'null:null',
    priority: source.priority ?? 99,
  };
}

function applyM3UProperty(target, line) {
  if (!target) return;
  if (line.startsWith('#EXTHTTP:')) {
    const rawJson = line.slice(line.indexOf(':') + 1).trim();
    try {
      const parsed = JSON.parse(rawJson);
      const headers = normalizeLiveHeaders(parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : parsed);
      const cookie = parsed.cookie || parsed.Cookie || headers.cookie || headers.Cookie || '';
      const userAgent = parsed['user-agent'] || parsed['User-Agent'] || parsed.userAgent || headers['user-agent'] || headers['User-Agent'] || headers.userAgent || '';
      const referer = parsed.referer || parsed.referrer || parsed.Referer || headers.referer || headers.referrer || headers.Referer || '';
      if (cookie) target.cookie = cookie;
      if (userAgent) target.userAgent = userAgent;
      if (referer) target.referer = referer;
      target.headers = { ...(target.headers || {}), ...headers };
    } catch {}
    return;
  }

  const at = line.indexOf('=');
  if (at < 0) return;
  const property = line.slice(0, at).toLowerCase();
  const value = line.slice(at + 1).trim().replace(/^"|"$/g, '');
  if (!value) return;

  if (property.endsWith('license_key')) {
    const pair = value.match(/^([0-9a-f-]{32,36})\s*:\s*([0-9a-f]{32})$/i);
    if (pair) { target.keyId = pair[1]; target.key = pair[2]; }
    else target.licenseKey = value; // JSON multi-key or an actual licence URL.
  } else if (property.endsWith('license_type')) {
    target.licenseType = value;
  } else if (property.endsWith('manifest_type')) {
    target.manifestType = value.toLowerCase() === 'mpd' ? 'dash' : value.toLowerCase();
  } else if (/manifest_headers|stream_headers|http-header$/.test(property)) {
    const headers = parseLiveHeaderOptions(value);
    target.headers = { ...target.headers, ...headers };
    if (headers['user-agent']) target.userAgent = headers['user-agent'];
    if (headers.referer) target.referer = headers.referer;
    if (headers.cookie) target.cookie = headers.cookie;
  } else if (/http-user-agent|user_agent|user-agent$/.test(property)) {
    target.userAgent = value;
  } else if (/http-referrer|http-referer|referer$|referrer$/.test(property)) {
    target.referer = value;
  }

}

/**
 * Some playlists (pocket.m3u as of 2026-09) prepend an HTML redirect stub
 * before the real #EXTM3U body. Drop everything before the first playlist
 * marker so parsers never see markup — the m3u lines after it are intact.
 */
function sanitizeM3UText(text = '') {
  const value = String(text || '');
  const markerIndex = value.search(/^#(?:EXTM3U|EXTINF)/m);
  if (markerIndex <= 0) return value;
  if (!/<\s*(html|body|script)/i.test(value.slice(0, markerIndex))) return value;
  return value.slice(markerIndex);
}

function parseM3U(text, source, { includeAll = false } = {}) {
  const lines = sanitizeM3UText(text).split(/\r?\n/);
  const channels = [];
  let pending = null;
  let carryProperties = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const commaIndex = line.indexOf(',');
      const attrPart = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const namePart = commaIndex >= 0 ? line.slice(commaIndex + 1) : '';
      const attrs = parseAttrs(attrPart);
      pending = {
        name: namePart || attrs['tvg-name'] || attrs['tvg-id'],
        id: attrs['tvg-id'] || attrs['channel-id'] || '',
        logo: attrs['tvg-logo'] || '',
        category: attrs['group-title'] || '',
        language: attrs['tvg-language'] || '',
        region: attrs['tvg-region'] || '',
      };
      carryProperties.forEach((propertyLine) => applyM3UProperty(pending, propertyLine));
      carryProperties = [];
      continue;
    }

    if (line.startsWith('#KODIPROP:') || line.startsWith('#EXTVLCOPT:') || line.startsWith('#EXTHTTP:')) {
      if (pending) applyM3UProperty(pending, line);
      else carryProperties = [...carryProperties.slice(-8), line];
      continue;
    }

    if (line.startsWith('#')) continue;
    if (pending) {
      const mapped = mapChannel({ ...pending, url: line }, source, channels.length);
      if (mapped && (includeAll || isTamilChannel(mapped, source))) channels.push(mapped);
      pending = null;
    }
  }

  return channels;
}

function parseLooseJson(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  try {
    return JSON.parse(`[${trimmed.replace(/^,|,$/g, '')}]`);
  } catch {
    return null;
  }
}

function parseJsonPayload(text, source, { includeAll = false } = {}) {
  const payload = parseLooseJson(text);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.channels)
      ? payload.channels
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.results)
          ? payload.results
          : payload && payload.url
            ? [payload]
            : [];

  return list
    .map((item, index) => mapChannel(item, source, index))
    .filter((item) => item && (includeAll || isTamilChannel(item, source)));
}

async function fetchText(url, extraHeaders = {}, timeoutMs = 15000) {
  // HJH worker M3U is 500KB+ and can be slow on serverless cold start — allow 25s for these hosts
  const host = (() => { try { return new URL(String(url||'')).hostname.toLowerCase(); } catch { return ''; } })();
  const effectiveTimeout = /hjh-545\.pages\.dev|jiotv|raw\.githubusercontent|iptv-org\.github\.io/i.test(host) ? Math.max(timeoutMs, 25000) : timeoutMs;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(effectiveTimeout),
        headers: {
          Accept: 'application/json,text/plain,application/x-mpegURL,*/*',
          'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)',
          ...extraHeaders,
        },
      });
      if (!response.ok) throw new Error(`Live TV source returned HTTP ${response.status}: ${url}`);
      return await response.text();
    } catch (e) {
      lastErr = e;
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout/i.test(e?.message||'');
      if (isTimeout && attempt === 0) continue;
      throw e;
    }
  }
  throw lastErr;
}

/**
 * Also used by `scripts/live-doctor.mjs`, which is why it is exported: the tool imports
 * it to print the exact headers a channel needs. It was private, so the tool died with
 * "does not provide an export named 'buildPlaybackHeaders'" before it could diagnose
 * anything (caught by the named-export check in scripts/check-source.cjs).
 */
function setWorkingCache(key, val) {
  if (workingCache.size > 1500) {
    const firstKey = workingCache.keys().next().value;
    if (firstKey) workingCache.delete(firstKey);
  }
  workingCache.set(key, val);
}

/**
 * v10.2.1 — segment-level verification.
 *
 * A 200-OK manifest is NOT proof a channel plays: the v10.2.0 sports packs
 * shipped live-looking manifests over 404/403 segments, which the browser
 * reports as SRC_NOT_SUPPORTED. This helper follows manifests up to 3 hops
 * (many real feeds chain master -> variant -> media), fetches ONE media
 * segment, and requires real media bytes (MPEG-TS sync or fMP4 boxes). While
 * it has the bytes, it also reads the TS PMT stream types — an HEVC-only feed
 * is unplayable in every target browser, so it counts as dead here.
 */
function resolveAgainst(base, ref) {
  try { return new URL(ref, base).href; } catch { return ''; }
}

function detectSegmentMedia(buf) {
  if (buf.length > 376 && buf[0] === 0x47 && buf[188] === 0x47 && buf[376] === 0x47) return { media: true, ts: true };
  const head = buf.subarray(0, 64).toString('latin1');
  if (head.includes('styp') || head.includes('ftyp')) return { media: true, ts: false };
  return { media: buf.length > 50_000, ts: false };
}

function sniffTsVideoCodec(buf) {
  const types = new Set();
  let pmtPid = 0;
  const scan = Math.min(buf.length - 188, 120_000);
  for (let i = 0; i < scan; i += 188) {
    if (buf[i] !== 0x47) continue;
    const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
    const afc = (buf[i + 3] >> 4) & 0x3;
    let off = i + 4;
    if (afc & 0x2) off += 1 + buf[i + 4];
    if (!(afc & 0x1) || off >= i + 188) continue;
    const payload = buf.subarray(off, i + 188);
    if (!payload.length) continue;
    if (pid === 0 && !pmtPid) {
      const table = payload.subarray(1 + payload[0]);
      if (table.length > 12 && table[0] === 0x00) {
        for (let j = 8; j + 4 <= table.length - 4; j += 4) {
          const program = (table[j] << 8) | table[j + 1];
          if (program !== 0) { pmtPid = ((table[j + 2] & 0x1f) << 8) | table[j + 3]; break; }
        }
      }
    } else if (pmtPid && pid === pmtPid) {
      const t = payload.subarray(1 + payload[0]);
      if (t.length > 12 && t[0] === 0x02) {
        const programInfoLength = ((t[10] & 0x0f) << 8) | t[11];
        let j = 12 + programInfoLength;
        while (j + 5 <= t.length - 4) {
          types.add(t[j]);
          const esLength = ((t[j + 3] & 0x0f) << 8) | t[j + 4];
          if (esLength < 0 || j + 5 + esLength > t.length) break;
          j += 5 + esLength;
        }
        if (types.size) break;
      }
    }
  }
  if (!types.size) return 'unknown';
  if (types.has(0x1b) || types.has(0x02) || types.has(0x10)) return 'h264'; // H.264/MPEG-2 — decodable
  if (types.has(0x24) || types.has(0x26)) return 'hevc'; // HEVC — not in target browsers
  return 'unknown';
}

async function verifyStreamDeliversVideo(url, { signal, channel = {} } = {}) {
  let current = { url, text: '' };
  for (let hop = 0; hop < 3; hop += 1) {
    if (!current.text) {
      const res = await fetch(current.url, {
        headers: buildPlaybackHeaders(channel, current.url),
        redirect: 'follow',
        cache: 'no-store',
        signal,
      });
      if (!res.ok) return { ok: false, reason: `manifest HTTP ${res.status}` };
      current.text = (await res.text()).slice(0, 60_000);
    }
    const lines = current.text.split(/\r?\n/).map((line) => line.trim());
    if (lines.some((line) => line.startsWith('#EXTINF'))) {
      const segmentLine = lines.find((line) => line && !line.startsWith('#'));
      if (!segmentLine) return { ok: false, reason: 'media playlist has no segments' };
      const segmentUrl = resolveAgainst(current.url, segmentLine);
      if (!segmentUrl) return { ok: false, reason: 'bad segment URL' };
      const segmentRes = await fetch(segmentUrl, {
        headers: { ...buildPlaybackHeaders(channel, segmentUrl), Range: 'bytes=0-262143' },
        redirect: 'follow',
        cache: 'no-store',
        signal,
      });
      if (!segmentRes.ok) return { ok: false, reason: `segment HTTP ${segmentRes.status}` };
      const buf = Buffer.from(await segmentRes.arrayBuffer());
      const verdict = detectSegmentMedia(buf);
      if (!verdict.media) return { ok: false, reason: `segment carries no media (${buf.length}B)` };
      return { ok: true, codec: verdict.ts ? sniffTsVideoCodec(buf) : 'h264', reason: '' };
    }
    const variant = lines.find((line) => line && !line.startsWith('#'));
    if (!variant) return { ok: false, reason: 'master manifest lists no variants' };
    const nextUrl = resolveAgainst(current.url, variant);
    if (!nextUrl) return { ok: false, reason: 'bad variant URL' };
    current = { url: nextUrl, text: '' };
  }
  return { ok: false, reason: 'nested manifests too deep' };
}

async function checkChannelWorking(channel = {}) {
  if (!channel?.playable || !channel.url) return false;
  // Server-side checks for Jio often fail because the CDN blocks data-center
  // locations, while the same URL works on the user's phone/browser after we
  // inject the fresh cookie token. Keep them visible and let the client hide a
  // channel only if Shaka actually fails.
  if (isJioChannel(channel)) return true;

  const cacheKey = `${channel.url}|${channel.cookie || ''}|${channel.userAgent || ''}|${channel.referer || ''}|${channel.keyId || ''}|${channel.key || ''}`;
  const cached = workingCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < WORKING_CHECK_TTL_MS) return cached.ok;

  const deepCheck = channel.format === 'hls' && !isJioChannel(channel);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deepCheck ? DEEP_CHECK_TIMEOUT_MS : WORKING_CHECK_TIMEOUT_MS);

  try {
    const jioLike = isJioChannel(channel);
    const uri = jioLike && channel.cookie ? appendCookieTokenToUrl(channel.url, channel.cookie) : channel.url;
    const response = await fetch(uri, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: buildPlaybackHeaders(channel, uri),
    });

    if (!response.ok) {
      // Jio/CDN manifests often reject cloud servers with 401/403/451 while
      // still playing from the user's device/location. Don't hide those as
      // broken based only on the Render/server-side check.
      if ([401, 403, 451].includes(response.status) && (isJioChannel(channel) || uri.toLowerCase().includes('jiotv'))) {
        setWorkingCache(cacheKey, { ok: true, checkedAt: Date.now() });
        return true;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    let ok = true;
    if (channel.format === 'dash' || channel.format === 'hls') {
      const text = await response.text();
      const trimmed = text.slice(0, 4096).trim();
      ok = channel.format === 'dash'
        ? /<MPD[\s>]/i.test(trimmed) || trimmed.includes('<MPD')
        : trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXT-X-STREAM-INF') || trimmed.includes('#EXT-X-TARGETDURATION');

      // v10.2.1: for HLS, a well-formed manifest alone is not "working" —
      // follow it to a real segment and require media bytes; HEVC-only video
      // is equally unplayable in the target browsers. Jio channels are
      // exempt (CDNs block datacenter probes; the player injects fresh
      // tokens client-side).
      if (ok && channel.format === 'hls' && !isJioChannel(channel)) {
        try {
          const proof = await verifyStreamDeliversVideo(uri, { signal: controller.signal, channel });
          if (!proof.ok || proof.codec === 'hevc') ok = false;
        } catch {
          ok = false;
        }
      }
    }

    setWorkingCache(cacheKey, { ok, checkedAt: Date.now() });
    return ok;
  } catch {
    setWorkingCache(cacheKey, { ok: false, checkedAt: Date.now() });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function filterWorkingChannels(channels = []) {
  if (!channels.length) return channels;

  const limit = Math.max(1, Math.min(WORKING_CHECK_CONCURRENCY, 40));
  const checks = new Array(channels.length);
  let cursor = 0;

  async function worker() {
    while (cursor < channels.length) {
      const index = cursor;
      cursor += 1;
      checks[index] = await checkChannelWorking(channels[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, channels.length) }, () => worker()));
  return channels.filter((_, index) => checks[index]);
}


function qualityScore(channel) {
  let score = 0;
  const rank = popularityRank(channel);
  if (rank !== 9999) score += 5000 - rank * 100;
  if (channel.playable) score += 1000;
  if (channel.format === 'dash') score += 120;
  if (channel.format === 'hls') score += 80;
  if (/hd/i.test(channel.name)) score += 25;
  if (/\b(news|music|kids|movies|devotional|sports|entertainment)\b/i.test(channel.category)) score += 5;
  score -= channel.priority * 20;
  return score;
}

export function extractJioCookieFromText(text = '') {
  const raw = String(text || '');
  const direct = raw.match(/((?:__hdnea__|hdnea)=st=[^&"'`\s;]+)/i);
  const directCookie = normalizeJioCookie(direct?.[1] || '');
  if (directCookie) return directCookie;

  try {
    const parsed = parseLooseJson(raw);
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      if (Array.isArray(item)) {
        queue.push(...item);
        continue;
      }
      if (typeof item !== 'object') continue;
      const value = item.cookie || item.cookies || item.value || item.jio_cookie || item.data || item.token || '';
      const cookie = normalizeJioCookie(value);
      if (cookie) return cookie;
      queue.push(...Object.values(item).filter((entry) => entry && typeof entry === 'object'));
    }
  } catch {}

  return '';
}

const JIO_COOKIE_URLS = [
  // Fresh GitHub-Actions-updated sources first (auto-refreshed every few hours
  // — the provider began 404ing/expiring the old allinonereborn endpoints).
  // Same repo that publishes sony.json, so the Sony sports rows and the token
  // come from one place. The entry that used to lead this list
  // (jio-tv-auto-update-playlist) now returns 404 and is demoted below.
  'https://raw.githubusercontent.com/sportlive18/Sportlink-wtf/refs/heads/main/cookie.json',
  'https://raw.githubusercontent.com/sportlive18/Sportlink-wtf/main/cookie.json',
  'https://raw.githubusercontent.com/sportlive18/jio-tv-auto-update-playlist/refs/heads/main/cookie.json',
  'https://raw.githubusercontent.com/sportlive18/jio-tv-auto-update-playlist/main/cookie.json',
  'https://allinonereborn2.online/jstrweb2/cookies.json',
  'https://allinonereborn2.online/jtv-fetch/cookies.json',
  'https://allinonereborn2.online/jstr4web/cookies.json',
  'https://allinonereborn2.online/jstr4web2/cookies.json',
  'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamcookie',
  'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/main/jstrweb2/cookies.json',
  'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/master/jstrweb2/cookies.json',
];

export async function getFreshJioCookie({ force = false, minValidityMs = 90_000 } = {}) {
  const configured = normalizeJioCookie(process.env.JIO_LIVE_COOKIE || process.env.JIO_COOKIE || '');
  if (configured && isJioCookieValid(configured, minValidityMs)) return configured;

  if (!force && jioCookieCache.value &&
    Date.now() - jioCookieCache.loadedAt < JIO_COOKIE_TTL_MS &&
    isJioCookieValid(jioCookieCache.value, minValidityMs)) {
    return jioCookieCache.value;
  }

  // Every provider being stale is the normal case during a Jio outage, and that was
  // the one path with no cache at all: the sweep found nothing, cached nothing, and
  // so re-ran on every single request. Remember the miss briefly instead. `force`
  // (the playback proxy and the Admin Check button) always probes live.
  if (!force && jioCookieCache.missAt
    && Date.now() - jioCookieCache.missAt < JIO_COOKIE_MISS_TTL_MS
    && !isJioCookieValid(jioCookieCache.value, minValidityMs)) {
    return '';
  }

  const [primaryUrl, ...mirrorUrls] = JIO_COOKIE_URLS;

  // Fast path: the primary Stream4Liv-compatible endpoint is normally current, so
  // one short request settles it for the next twenty minutes.
  const primary = await probeJioCookieUrl(primaryUrl, minValidityMs);
  if (primary && primary.expiry > Date.now() + 10 * 60 * 1000) {
    jioCookieCache.value = primary.cookie;
    jioCookieCache.loadedAt = Date.now();
    jioCookieCache.missAt = 0;
    return primary.cookie;
  }

  // Otherwise sweep every mirror at once: serially this was ~2.7s of wall clock per
  // attempt, in parallel it is bounded by the slowest single mirror.
  const found = await Promise.all(mirrorUrls.map((url) => probeJioCookieUrl(url, minValidityMs)));

  let bestCookie = primary?.cookie || '';
  let bestExpiry = primary?.expiry || 0;
  for (const hit of found) {
    if (!hit) continue;
    if (!bestCookie || hit.expiry > bestExpiry) {
      bestCookie = hit.cookie;
      bestExpiry = hit.expiry;
    }
  }

  if (bestCookie) {
    jioCookieCache.value = bestCookie;
    jioCookieCache.loadedAt = Date.now();
    jioCookieCache.missAt = 0;
    return bestCookie;
  }

  jioCookieCache.missAt = Date.now();
  return isJioCookieValid(jioCookieCache.value, minValidityMs) ? jioCookieCache.value : '';
}

async function probeJioCookieUrl(url, minValidityMs) {
  try {
    const text = await fetchText(url, {}, JIO_COOKIE_PROBE_TIMEOUT_MS);
    const cookie = extractJioCookieFromText(text);
    if (!isJioCookieValid(cookie, minValidityMs)) return null;
    return { cookie, expiry: getJioCookieExpiry(cookie) || Number.MAX_SAFE_INTEGER };
  } catch {
    return null;
  }
}

function stripJioCookieFromUrl(value = '') {
  const input = String(value || '').trim();
  const hashAt = input.indexOf('#');
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
  const questionAt = withoutHash.indexOf('?');
  if (questionAt < 0) return withoutHash;
  const path = withoutHash.slice(0, questionAt);
  const query = withoutHash.slice(questionAt + 1)
    .split('&')
    .filter(Boolean)
    .filter((part) => !/^(?:__hdnea__|hdnea)=/i.test(part));
  return query.length ? `${path}?${query.join('&')}` : path;
}

async function getJioStarAccessRecords({ force = false } = {}) {
  if (!force && jioStarAccessCache.records.length && Date.now() - jioStarAccessCache.loadedAt < 5 * 60 * 1000) {
    return jioStarAccessCache.records.filter((item) => isJioCookieValid(item.cookie));
  }

  const urls = [
    'https://raw.githubusercontent.com/sportlive18/jio-tv-auto-update-playlist/refs/heads/main/star2.json',
    'https://allinonereborn2.online/jtv-fetch/jstarcookie/cookie.json',
    'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/main/jstarcookie/cookie.json',
  ];
  for (const url of urls) {
    try {
      const parsed = parseLooseJson(await fetchText(url));
      const payload = parsed?.data || parsed || {};
      let rows = [];
      if (Array.isArray(payload)) {
        // sportlive18 shape: [{ name, stream_url, cookie, key_id, key, logo }]
        rows = payload.map((item) => ({
          channel_id: '',
          channel_name: String(item?.name || '').replace(/\s*\((?:pllive|mbl|bpk)\).*/i, '').replace(/\s*@[A-Za-z0-9_]+\s*$/g, ''),
          final_url: item?.stream_url || '',
          directCookie: item?.cookie || '',
        }));
      } else {
        rows = [
          ...(Array.isArray(payload.successful_results) ? payload.successful_results : []),
          ...(Array.isArray(payload.failed_results) ? payload.failed_results : []),
        ];
      }
      const records = rows.map((item) => {
        const finalUrl = item?.final_url || item?.error_details?.final_url || '';
        return {
          channelId: String(item?.channel_id || '').trim(),
          name: normalizeLiveName(item?.channel_name || ''),
          playbackUrl: stripJioCookieFromUrl(finalUrl),
          cookie: normalizeJioCookie(item?.directCookie || '') || extractJioCookieFromText(finalUrl),
        };
      }).filter((item) => item.playbackUrl && isJioPlaybackChannel({ url: item.playbackUrl }) && isJioCookieValid(item.cookie));
      if (records.length) {
        jioStarAccessCache.records = records;
        jioStarAccessCache.loadedAt = Date.now();
        return records;
      }
    } catch {}
  }
  return jioStarAccessCache.records.filter((item) => isJioCookieValid(item.cookie));
}

function normalizeLiveName(value = '') {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function getJioChannelAccess(channel = {}, { force = false } = {}) {
  const originalUrl = String(channel.url || '').trim();
  if (isStarSportsChannel(channel)) {
    const records = await getJioStarAccessRecords({ force });
    const channelId = String(channel.tvgId || channel.channelId || channel.id || '').trim();
    const channelName = normalizeLiveName(channel.name || channel.originalName || '');
    const sourcePath = originalUrl.split('/bpk-tv/')[1]?.split('/')[0]?.toLowerCase() || '';
    const match = records.find((item) => channelId && item.channelId === channelId)
      || records.find((item) => channelName && item.name === channelName)
      || records.find((item) => sourcePath && item.playbackUrl.toLowerCase().includes(`/bpk-tv/${sourcePath}/`));
    if (match) return { cookie: match.cookie, playbackUrl: match.playbackUrl, scoped: true };
  }

  return {
    cookie: await getFreshJioCookie({ force }),
    playbackUrl: originalUrl,
    scoped: false,
  };
}

export function injectJioCookie(channels, cookie = '') {
  const freshCookie = normalizeJioCookie(cookie);
  if (!freshCookie) return channels;

  return channels.map((channel) => {
    if (!isJioChannel(channel) || isStarSportsChannel(channel)) return channel;

    const existing = normalizeJioCookie(channel.cookie || '');
    const existingLooksScoped = existing.includes('/bpk-tv/') || (existing.includes('acl=') && !existing.includes('acl=/*'));
    const selectedCookie = existingLooksScoped && isJioCookieValid(existing) ? existing : freshCookie;

    return {
      ...channel,
      cookie: selectedCookie,
      userAgent: channel.userAgent || JIO_USER_AGENT,
      referer: channel.referer || JIO_REFERER,
      jioTokenExpiresAt: getJioCookieExpiry(selectedCookie),
    };
  });
}

function dedupeChannels(channels) {
  const byName = new Map();
  for (const channel of channels) {
    const dedupeName = channel.sourceId === 'pocket-tamil'
      ? channel.name
      : channel.name.replace(/\s+HD$/i, '').replace(/\s+SD$/i, '');
    const key = slugify(dedupeName);
    const existing = byName.get(key);
    if (!existing || qualityScore(channel) > qualityScore(existing)) {
      byName.set(key, channel);
    }
  }

  return [...byName.values()].sort((a, b) => {
    const rankDiff = popularityRank(a) - popularityRank(b);
    if (rankDiff) return rankDiff;
    const playableDiff = Number(b.playable) - Number(a.playable);
    if (playableDiff) return playableDiff;
    const sourceDiff = a.priority - b.priority;
    if (sourceDiff) return sourceDiff;
    return a.name.localeCompare(b.name);
  });
}

async function getLiveTVChannels({ source = 'all', playableOnly = false, workingOnly = false, sourceOverride = null } = {}) {
  const sources = getSources(sourceOverride);
  const selectedSources = source && source !== 'all'
    ? sources.filter((item) => item.id === source)
    : sources;
  const key = `${selectedSources.map((item) => item.url).join(',')}|${playableOnly}|${workingOnly}`;

  if (cache.channels && cache.key === key && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.channels;
  }

  const results = await Promise.allSettled(
    selectedSources.map(async (item) => {
      const text = await fetchText(item.url);
      return item.type === 'm3u' ? parseM3U(text, item) : parseJsonPayload(text, item);
    }),
  );

  const rawChannels = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .filter((channel) => !playableOnly || channel.playable);

  const jioCookie = await getFreshJioCookie();
  const injectedChannels = injectJioCookie(rawChannels, jioCookie);
  const dedupedChannels = dedupeChannels(injectedChannels);
  const channels = workingOnly ? await filterWorkingChannels(dedupedChannels) : dedupedChannels;

  const payload = {
    updatedAt: new Date().toISOString(),
    source,
    workingOnly,
    sources: selectedSources.map(({ id, label, url, type }) => ({ id, label, url, type })),
    count: channels.length,
    channels,
    errors: results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Unknown source error'),
  };

  cache.key = key;
  cache.loadedAt = Date.now();
  cache.channels = payload;

  return payload;
}

export async function getPocketLiveTVChannels({ playableOnly = false, workingOnly = false } = {}) {
  return getLiveTVChannels({
    source: 'all',
    playableOnly,
    workingOnly,
    sourceOverride: [POCKET_SOURCE],
  });
}


/**
 * Is this source URL one of the hosts we know is gone? Cheap and offline —
 * used to self-heal a database seeded by an older release (the source document
 * still points at a host that no longer resolves, so syncing it is pointless).
 */
export function isDeadSourceUrl(value = '') {
  const text = String(value || '').toLowerCase();
  return REMOVED_SOURCE_PATTERNS.some((pattern) => text.includes(pattern));
}

/**
 * Reachability probe for one source URL, used by the Admin source list so a
 * dead feed shows up without running a full sync. Deliberately cheap: a single
 * request with a short timeout, and it reports instead of throwing — a source
 * list must render even when half the internet is down.
 *
 * Only the response status is wanted, so the body is cancelled rather than
 * downloaded; some of these playlists are several hundred KB.
 */
export async function probeLiveSourceUrl(url = '', { timeoutMs = 12000 } = {}) {
  const target = normalizeHttpUrl(url);
  if (!target) return { ok: false, status: 0, ms: 0, error: 'Not a usable http(s) URL' };

  const startedAt = Date.now();
  try {
    const response = await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json,text/plain,application/x-mpegURL,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)',
      },
    });
    try { await response.body?.cancel(); } catch { /* nothing to drain */ }
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      error: response.ok ? '' : `HTTP ${response.status}`,
    };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: timedOut ? `No answer in ${timeoutMs} ms` : (error?.message || 'Unreachable'),
    };
  }
}

/** Import file content, not GitHub's HTML file viewer. */
function normalizeLivePlaylistUrl(value = '') {
  try {
    const url = new URL(value);
    if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)) {
      return `https://raw.githubusercontent.com${url.pathname.replace('/blob/', '/')}`;
    }
  } catch {}
  return value;
}

/**
 * Resolve an HJH "Auto IPTV" worker URL to its final signed Jio CDN manifest.
 *
 * The worker (hjh-545.pages.dev/stream?id=…) answers with a 302 whose Location
 * is the real MPD carrying a fresh __hdnea__ token. That Cloudflare hop is
 * reachable from every country — only the final Jio CDN host is geo-fenced,
 * and this function deliberately never fetches it: redirects are followed with
 * redirect:'manual' so only Location headers are read. Safe to call from a
 * non-Indian server (Render); the signed URL is then played directly from the
 * viewer's browser, whose IP Jio evaluates.
 *
 * Returns the final signed URL (or the last worker URL if the chain stalls).
 */
export async function resolveHjhWorkerUrl(workerUrl, { timeoutMs = 10000, maxRedirects = 3 } = {}) {
  let current = normalizeHttpUrl(workerUrl);
  if (!current) throw new Error('Invalid HJH worker URL');
  for (let attempt = 0; attempt <= maxRedirects; attempt += 1) {
    const response = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/dash+xml,application/vnd.apple.mpegurl,*/*',
        'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)',
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return current;
    const location = response.headers.get('location');
    if (!location) return current;
    current = new URL(location, current).href;
    // A non-worker target is the signed CDN URL we want; stop before fetching it.
    if (!/hjh-545\.pages\.dev/i.test(current)) return current;
  }
  return current;
}

export async function parseLiveSourceChannels(source = {}, { includeAll = true } = {}) {
  if (!source?.url) throw new Error('Source URL is required');
  const normalizedSource = {
    id: source.id || source.sourceId || `source-${Date.now()}`,
    label: source.label || source.name || source.id || 'Live Source',
    type: source.type || detectSourceType(source.url),
    url: normalizeLivePlaylistUrl(source.url),
    trustTamil: Boolean(source.trustTamil),
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 99,
    titleFilter: String(source.titleFilter || '').trim(),
  };
  const text = await fetchText(normalizedSource.url, source.headers || {});
  let channels = normalizedSource.type === 'm3u'
    ? parseM3U(text, normalizedSource, { includeAll })
    : parseJsonPayload(text, normalizedSource, { includeAll });
  // Optional per-source allow-list (case-insensitive regex over name, group
  // and language). An invalid regex is ignored rather than failing the sync.
  if (normalizedSource.titleFilter) {
    try {
      const filter = new RegExp(normalizedSource.titleFilter, 'i');
      channels = channels.filter((channel) =>
        filter.test(`${channel.name || ''} ${channel.category || ''} ${channel.language || ''}`));
    } catch {}
  }
  return channels;
}

export async function checkLiveChannelUrl(channel = {}) {
  return checkChannelWorking({ ...channel, playable: channel.playable !== false });
}
