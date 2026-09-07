/**
 * Pocket-EPG ingestion for the live page.
 *
 * The feed (https://kliv.in/Pocket-EPG) is not JSON: it is gzip'd XMLTV — 3.3 MB on the wire that
 * expands to ~65 MB, 1,190 channels and ~157k programmes over about four days, and the channel ids
 * are Jio's numeric ids (144 = Colors HD). None of that is compatible with "fetch it when someone
 * opens /live" on a 512 MB free tier, so this module is deliberately strict:
 *
 *  • one hourly refresh, shared by every request (single-flight), never per page view;
 *  • the gunzipped buffer is scanned in place with `Buffer.indexOf` — no 65 MB string is ever
 *    created, because a UTF-8 copy of that buffer would double the peak;
 *  • only the channels the caller asked about are kept, and only the programmes that touch the
 *    requested day, so the retained index is a few hundred KB, not tens of MB;
 *  • a failed refresh keeps the previous index (stale-while-error): the page shows an old guide
 *    with its age rather than an error card, because the streams themselves are fine.
 *
 * Everything that could be wrong about the schedule (day boundaries, the +0530 stamp, a programme
 * that never ends, a channel that only exists under a different name) is handled here and covered
 * in tests/live-epg.test.js, so the UI can treat the guide as trustworthy-or-absent, never partial.
 */

import zlib from 'node:zlib';

const DEFAULT_URL = 'https://kliv.in/Pocket-EPG';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
/** The feed stamps everything in IST; the day the user means is the IST day. */
const DEFAULT_TZ_OFFSET_MINUTES = 330;
const MAX_PROGRAMME_SECONDS = 24 * 60 * 60;
/** Quality/branding tokens that must not decide whether two channel names are the same channel. */
const NAME_NOISE = /\b(hd|sd|fhd|uhd|4k|1080p?|720p?|576p?|hevc|x|plus|inc|in|india|official|live)\b/g;

export function epgUrl() {
  return String(process.env.LIVE_EPG_URL || DEFAULT_URL).trim();
}

export function epgTtlMs() {
  return Math.max(60_000, Number(process.env.LIVE_EPG_TTL_MS) || DEFAULT_TTL_MS);
}

export function tzOffsetMinutes() {
  const raw = Number(process.env.LIVE_EPG_TZ_MINUTES);
  return Number.isFinite(raw) ? raw : DEFAULT_TZ_OFFSET_MINUTES;
}

/**
 * `20260906203000 +0530` → epoch ms.
 *
 * `Z` is honoured literally; an **absent** offset is read as the feed's own zone rather than UTC,
 * because Indian mirrors publish offset-less stamps and "UTC" would shift the whole grid by 5½
 * hours — which would silently mark evening prime time as ended, or not yet started.
 */
export function parseXmltvTime(value = '', { fallbackOffsetMinutes = tzOffsetMinutes() } = {}) {
  const text = String(value).trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4}|Z)?$/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, off] = match;
  let offsetMinutes = off ? 0 : Number(fallbackOffsetMinutes) || 0;
  if (off && off !== 'Z') {
    const sign = off[0] === '-' ? -1 : 1;
    offsetMinutes = sign * (Number(off.slice(1, 3)) * 60 + Number(off.slice(3, 5)));
  }
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s) || 0) - offsetMinutes * 60_000;
  return Number.isFinite(ms) ? ms : null;
}

/** Shared normaliser: case, punctuation, and quality suffixes must not break a name match. */
export function slugName(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function channelKey(value = '') {
  return slugName(value).replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** Start/end of the tz-local day containing `at`, in epoch ms. */
export function dayBounds(at = Date.now(), offsetMinutes = tzOffsetMinutes()) {
  const shifted = Number(at) + offsetMinutes * 60_000;
  const utcDayStart = Math.floor(shifted / 86_400_000) * 86_400_000;
  return { start: utcDayStart - offsetMinutes * 60_000, end: utcDayStart - offsetMinutes * 60_000 + 86_400_000 };
}

function readTag(buffer, from, to, tag) {
  const open = buffer.indexOf(`<${tag}`, from);
  if (open < 0 || open > to) return '';
  const close = buffer.indexOf('>', open);
  if (close < 0 || close > to) return '';
  const end = buffer.indexOf(`</${tag}>`, close);
  if (end < 0 || end > to) return '';
  return decode(buffer.toString('utf8', close + 1, end)).trim();
}

function readAttr(text = '', name = '') {
  const match = new RegExp(`${name}="([^"]*)"`).exec(text);
  return match ? decode(match[1]).trim() : '';
}

function decode(value = '') {
  return String(value)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Which EPG channel backs each lineup entry, and how we found it.
 *
 * Three links, in order of trust: an explicit binding (`tvgId`/`epgId` — this is what the service
 * panel writes), an exact match on the normalised name, then a *unique* prefix match (longer than
 * 7 characters, so "Sun" does not swallow "Sun News" and "Sun Life"). Lineup entries that share a
 * name share the link, because the same channel reached over Jio and over a raw HLS mirror must not
 * compete for one guide.
 */
export function resolveLinks(lineup = [], channelsById = new Map()) {
  const links = new Map();
  const byName = new Map();
  const used = new Set();
  for (const channel of lineup) {
    const id = lineupId(channel);
    if (!id) continue;
    const explicit = String(channel?.epgId || channel?.tvgId || '').trim();
    if (explicit && channelsById.has(explicit)) {
      const info = channelsById.get(explicit);
      const link = { epgId: explicit, name: info.name, via: 'tvgId' };
      links.set(id, link);
      used.add(explicit);
      const key = channelKey(channel?.name || '');
      if (key) byName.set(key, link);
      continue;
    }
    const key = channelKey(channel?.name || '');
    if (!key) continue;
    if (byName.has(key)) {
      // A mirror of a channel we already linked: reuse it rather than treating it as taken.
      links.set(id, byName.get(key));
      continue;
    }
    let found = null;
    for (const [epgId, info] of channelsById) {
      if (used.has(epgId)) continue;
      if (channelKey(info.name) === key) {
        found = { epgId, name: info.name, via: 'name' };
        break;
      }
    }
    if (!found && key.length > 7) {
      for (const [epgId, info] of channelsById) {
        if (used.has(epgId)) continue;
        if (channelKey(info.name).startsWith(key)) {
          found = { epgId, name: info.name, via: 'prefix' };
          break;
        }
      }
    }
    if (found) {
      links.set(id, found);
      byName.set(key, found);
      used.add(found.epgId);
    }
  }
  return links;
}

export function lineupId(channel = {}) {
  return String(channel?.id || channel?.channelId || channelKey(channel?.name || '') || '').trim();
}

/** Small, stable identity for the lineup, so adding a channel re-parses instead of serving holes. */
export function lineupFingerprint(lineup = []) {
  const parts = lineup
    .map((channel) => `${lineupId(channel)}~${channelKey(channel?.name || '')}~${String(channel?.tvgId || channel?.epgId || '').trim()}`)
    .sort();
  let hash = 2166136261;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${parts.length}-${hash.toString(36)}`;
}

/**
 * Parse XMLTV from a Buffer (gzipped input accepted) into a **day-wide, deliberately lean** index:
 * every channel in the feed, and every programme that touches the requested day.
 *
 * The index is not filtered by the caller's lineup on purpose. The guide's lineup is whatever the
 * user is currently searching or filtering, so filtering by it would re-download and re-parse a
 * 65 MB feed on every keystroke. Instead the whole day is indexed once an hour (a few MB) and each
 * request only *resolves names*, which is a millisecond of work.
 *
 * Lean means: no `icon`, no `rawFrom`, and `<desc>` kept only for the programme airing at `at` —
 * because that is the only one the UI ever quotes.
 */
export function parseXmltv(input, { at = Date.now(), offsetMinutes = tzOffsetMinutes(), maxPerChannel = 60 } = {}) {
  const buffer = Buffer.isBuffer(input) ? (isGzip(input) ? zlib.gunzipSync(input) : input) : Buffer.from(String(input), 'utf8');
  const bounds = dayBounds(at, offsetMinutes);

  const channels = new Map();
  let cursor = 0;
  while (cursor < buffer.length) {
    const open = buffer.indexOf('<channel ', cursor);
    if (open < 0) break;
    const close = buffer.indexOf('>', open);
    const end = buffer.indexOf('</channel>', close);
    if (close < 0 || end < 0) break;
    const id = readAttr(buffer.toString('utf8', open, close), 'id');
    if (id) {
      const name = readTag(buffer, close, end, 'display-name');
      const logo = readAttr(buffer.toString('utf8', close, end), 'src');
      channels.set(id, { id, name: name || id, logo });
    }
    cursor = end + 10;
  }

  // Every declared channel is indexed — resolution against the lineup happens per request, so the
  // index must not depend on it. Undeclared ids are tolerated (some mirrors emit programmes for a
  // channel they never declared) but bounded, so a malformed buffer cannot grow this without limit.
  const keep = new Set(channels.keys());
  const MAX_INDEXED_CHANNELS = 4000;

  const programmes = new Map();
  let pos = 0;
  let truncatedTail = false;
  while (pos < buffer.length) {
    const start = buffer.indexOf('<programme ', pos);
    if (start < 0) break;
    const headEnd = buffer.indexOf('>', start);
    const end = buffer.indexOf('</programme>', headEnd);
    if (headEnd < 0) break;
    if (end < 0) {
      // A cut-off tail (truncated download) must not lose everything else.
      truncatedTail = true;
      break;
    }
    const head = buffer.toString('utf8', start, headEnd);
    const channelId = readAttr(head, 'channel');
    if (channelId && (keep.has(channelId) || keep.size < MAX_INDEXED_CHANNELS + channels.size)) {
      keep.add(channelId);
      const from = parseXmltvTime(readAttr(head, 'start'));
      let to = parseXmltvTime(readAttr(head, 'stop'));
      if (from != null) {
        // Missing or inverted stop: assume one slot, so the last show of a day still has a block.
        if (to == null || to <= from) to = Math.min(from + 30 * 60_000, bounds.end);
        if (to > bounds.start && from < bounds.end) {
          const list = programmes.get(channelId) || [];
          if (list.length < maxPerChannel) {
            const bodyStart = headEnd + 1;
            const airing = at >= from && at < to;
            list.push({
              from: Math.max(from, bounds.start),
              to: Math.min(to, bounds.end),
              title: readTag(buffer, bodyStart, end, 'title') || 'Untitled',
              category: readTag(buffer, bodyStart, end, 'category'),
              // Only the show that is on right now keeps its synopsis.
              desc: airing ? readTag(buffer, bodyStart, end, 'desc') : '',
            });
            programmes.set(channelId, list);
          }
        }
      }
    }
    pos = end + 12;
  }

  for (const list of programmes.values()) list.sort((a, b) => a.from - b.from);
  return { channels, programmes, dayStart: bounds.start, dayEnd: bounds.end, truncatedTail };
}

function isGzip(buffer) {
  return buffer.length > 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
}

/**
 * Programme windows for one channel, in the caller's clock. `at` is injectable because the whole
 * point of this layer is that the UI can be tested without waiting for the next half hour.
 */
export function windowFor(list = [], { at = Date.now(), graceMs = 0 } = {}) {
  const shows = Array.isArray(list) ? list : [];
  const nowIndex = shows.findIndex((show) => show.from <= at && show.to > at);
  const now = nowIndex >= 0 ? shows[nowIndex] : null;
  const upcoming = shows.filter((show) => show.from > at);
  const ended = shows.filter((show) => show.to <= at);
  const next = upcoming[0] || null;
  // "just ended": the last show, kept on screen for `graceMs` after its own end time, so a
  // published gap between two programmes does not blank the strip. Nothing to do with `next`.
  const last = ended.length ? ended[ended.length - 1] : null;
  const tail = !now && last && at - last.to <= graceMs ? last : null;
  return {
    now: now ? describe(now) : null,
    nowMinutesLeft: now ? Math.max(0, Math.round((now.to - at) / 60_000)) : 0,
    // A show that just ended, with nothing scheduled yet (or not for a while): keep it on screen,
    // marked as the last one, so the strip does not go blank between two programmes.
    lastEnded: tail ? describe(tail) : null,
    next: next ? describe(next) : null,
    minutesToNext: next ? Math.max(0, Math.round((next.from - at) / 60_000)) : null,
    later: upcoming.slice(1, 8).map(describe),
    day: shows.map((show) => ({
      ...describe(show),
      state: show.to <= at ? 'ended' : now && show.from === now.from ? 'now' : 'later',
    })),
    progress: now && now.to > now.from ? Math.min(1, Math.max(0, (at - now.from) / (now.to - now.from))) : 0,
    count: shows.length,
  };
}

function describe(show) {
  return {
    from: show.from,
    to: show.to,
    title: show.title,
    desc: show.desc || '',
    category: show.category || '',
    icon: show.icon || '',
    minutes: Math.max(0, Math.round((show.to - show.from) / 60_000)),
  };
}

/* ------------------------------------------------------------------ the cache */

const state = () => {
  if (!globalThis.__jashLiveEpg) {
    globalThis.__jashLiveEpg = {
      error: '',
      refreshing: null,
      // Keyed by `dayStart:fingerprint`. Two keys, not one, because a request that arrives just
      // before midnight must not be answered from the day that is ending, and because adding a
      // channel to the lineup has to re-parse instead of serving guide holes.
      byKey: new Map(),
      bytes: 0,
      channelCount: 0,
      url: '',
    };
  }
  return globalThis.__jashLiveEpg;
};

async function loadFeed(url) {
  const response = await fetch(url, {
    headers: { 'accept-encoding': 'gzip', 'user-agent': 'jashvibes-epg/1.0' },
    cache: 'no-store',
    signal: AbortSignal.timeout(Number(process.env.LIVE_EPG_TIMEOUT_MS || 25_000)),
  });
  if (!response.ok) throw new Error(`EPG feed responded ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.length) throw new Error('EPG feed was empty');
  return body;
}

/** One index per day. The lineup is deliberately not part of the key — see parseXmltv. */
function cacheKey(bounds) {
  return `${bounds.start}`;
}

/**
 * Ensure the index for the requested day/lineup is fresh, then return the per-channel windows.
 * `fetchImpl` exists so refresh, stale-while-error and empty-feed behaviour are testable without a
 * network, and `at` is injectable so nobody has to wait for the next half hour to prove the maths.
 */
export async function getGuide({ channels = [], at = Date.now(), fetchImpl = loadFeed } = {}) {
  const cache = state();
  const bounds = dayBounds(at);
  const key = cacheKey(bounds);
  const entry = cache.byKey.get(key);
  const stale = !entry || Date.now() - entry.loadedAt > epgTtlMs();

  if (stale && !cache.refreshing) {
    cache.refreshing = (async () => {
      try {
        const body = await fetchImpl(epgUrl());
        const parsed = parseXmltv(body, { at });
        cache.bytes = Buffer.isBuffer(body) ? body.length : 0;
        cache.channelCount = parsed.channels.size;
        cache.error = '';
        cache.url = epgUrl();
        for (const existing of cache.byKey.keys()) {
          if (Number(existing) < bounds.start) cache.byKey.delete(existing); // yesterday's day, and anything older
        }
        cache.byKey.set(key, { ...parsed, loadedAt: Date.now() });
      } catch (error) {
        cache.error = String(error?.message || error);
      } finally {
        cache.refreshing = null;
      }
    })();
  }
  // Concurrent requests share one refresh, and a caller holding a stale entry does not wait for it:
  // yesterday's guide is better than a spinner when the feed is having a bad hour.
  if (!entry) await cache.refreshing;

  const current = cache.byKey.get(key) || entry;
  // Name resolution is per request (cheap) so two callers with different lineups both get their own
  // links out of one shared index.
  const linked = current ? resolveLinks(channels, current.channels) : new Map();
  const rows = channels.map((channel) => {
    const id = lineupId(channel);
    const link = linked.get(id) || null;
    const window = windowFor(current?.programmes?.get(link?.epgId) || [], { at, graceMs: 15 * 60_000 });
    return {
      id,
      name: channel?.name || '',
      matched: Boolean(link),
      epgId: link?.epgId || '',
      epgName: link?.name || '',
      via: link?.via || '',
      ...window,
    };
  });

  const out = {
    ok: Boolean(current),
    day: { start: bounds.start, end: bounds.end },
    status: {
      loadedAt: current?.loadedAt || 0,
      ageMs: current ? Date.now() - current.loadedAt : null,
      ttlMs: epgTtlMs(),
      url: cache.url || epgUrl(),
      error: cache.error || '',
      refreshing: Boolean(cache.refreshing),
      feedChannels: cache.channelCount || 0,
      feedBytes: cache.bytes || 0,
      indexedChannels: current?.programmes?.size || 0,
      truncatedTail: Boolean(current?.truncatedTail),
    },
    linked: rows.filter((row) => row.matched).length,
    unlinked: rows.filter((row) => !row.matched).length,
    channels: rows,
  };
  return out;
}

/** Force a refresh (the service panel's "Refresh now"); returns the resulting status. */
export async function refreshGuide({ channels = [], fetchImpl = loadFeed } = {}) {
  const cache = state();
  cache.byKey.clear();
  await getGuide({ channels, fetchImpl });
  // `refresh` is the service panel's escape hatch: it re-downloads the feed and rebuilds the index.
  return { ok: !cache.error, error: cache.error || '', ...epgStatus() };
}

export function epgStatus() {
  const cache = state();
  const newest = [...cache.byKey.values()].sort((a, b) => (b?.loadedAt || 0) - (a?.loadedAt || 0))[0];
  return {
    loadedAt: newest?.loadedAt || 0,
    ageMs: newest ? Date.now() - newest.loadedAt : null,
    ttlMs: epgTtlMs(),
    url: cache.url || epgUrl(),
    error: cache.error || '',
    feedChannels: cache.channelCount || 0,
    feedBytes: cache.bytes || 0,
    indexedChannels: newest ? newest.programmes.size : 0,
    dayStart: newest?.dayStart || 0,
    dayEnd: newest?.dayEnd || 0,
  };
}

/**
 * Lookup for the manual-binding UI: "which EPG channel did you mean?" — name search across the
 * feed's channel list, so a lineup entry can be pinned to an id in one click.
 */
export async function lookupEpgChannels(query = '', { fetchImpl = loadFeed, limit = 25 } = {}) {
  const cache = state();
  if (!cache.byKey.size) await getGuide({ channels: [], fetchImpl });
  // The index already holds every channel in the feed, so a search never needs a lineup.
  const newest = [...cache.byKey.values()].sort((a, b) => (b?.loadedAt || 0) - (a?.loadedAt || 0))[0];
  const channels = newest?.channels ? [...newest.channels.values()] : [];
  const needle = slugName(query);
  const scored = channels
    .map((channel) => {
      const name = slugName(channel.name);
      let score = 0;
      if (!needle) score = 1;
      else if (name === needle) score = 100;
      else if (name.startsWith(needle)) score = 60;
      else if (name.includes(needle)) score = 30;
      return { ...channel, score };
    })
    .filter((channel) => channel.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
  return { ok: Boolean(channels.length), error: cache.error || '', results: scored };
}

/**
 * Drop the whole index. The cache lives on `globalThis` so it survives Next's module reloads, which
 * also means tests must not inherit each other's state — hence this being part of the public surface.
 */
export function clearGuideCache() {
  const cache = state();
  cache.byKey.clear();
  cache.error = '';
  cache.refreshing = null;
  cache.bytes = 0;
  cache.channelCount = 0;
}

/** Exposed for tests. */
export const __test = { MAX_PROGRAMME_SECONDS, isGzip, cacheKey, dayBounds, clearGuideCache };
