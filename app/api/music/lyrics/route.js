import { NextResponse } from 'next/server';
import {
  chooseLyricMatch, lyricAlbum, lyricRequestMetadata, lyricSearchVariants,
  LYRICS_MATCH_VERSION, DURATION_TOLERANCE_SECONDS,
} from '@/lib/lyricsMatch';
import { SOURCE_GROUPS, WIRED_SOURCE_KIND, groupedSources, isPickable, sourceById } from '@/lib/musicSources';
import { readLyricsOverride, readLyricsCache, writeLyricsCache } from '@/lib/lyricsStore';

/*
 * GET /api/music/lyrics — one source, several ways of asking.
 *
 * The redesign keeps LRCLIB as the only provider and moves all the robustness
 * into three places the old cascade got wrong:
 *
 *   1. RETRIEVAL. LRCLIB answers two different questions: `track_name=` is
 *      fielded and near-exact, `q=` is free text. The same record can be
 *      invisible to one and obvious to the other ("Vandikkaran Sontha": 0 hits
 *      fielded, 6 free-text, and the record is real — see the lifecycle docs).
 *      So the route asks both, with title variants (vocal-version base, stripped
 *      parentheticals, film name) that catalogue metadata makes necessary.
 *
 *   2. BUDGETS. The old pipeline shared one 7-second deadline across three
 *      stages, so the stage most likely to find the song was the one that got
 *      cut — and a spent budget surfaced as HTTP 503 "provider error" instead of
 *      an honest "not found". Every stage now owns its budget, and the total is
 *      bounded separately, so a slow first stage can never starve the last.
 *
 *   3. MEMORY. A hit is cached in MongoDB for 90 days and a miss for 12 hours,
 *      shared by every instance and surviving deploys, with the owner's own
 *      lyrics checked first — so a song fetched or filled in once is instant
 *      forever, whether or not LRCLIB is reachable that day.
 *
 * Acceptance is still the single gate: `lyricIdentity` decides what may be
 * shown, and a rejection is reported with its reason code rather than a blank
 * stage. Nothing is ever substituted from a different song.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_BUDGET_MS = 2500;
const TOTAL_BUDGET_MS = 9000;

function getLyricsApiBase() {
  return (process.env.LYRICS_API || process.env.LRCLIB || 'https://lrclib.net').replace(/\/+$/, '');
}

function normalize(value = '') {
  return String(value || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

/* ── provider plumbing: one origin, respectful spacing, honest failures ───── */

class ProviderFailure extends Error {
  constructor(message, retryAfter = 1, retryable = true) {
    super(message); this.retryAfter = retryAfter; this.retryable = retryable;
  }
}
const cooldowns = new Map();
let lyricQueue = Promise.resolve(), queued = 0;

function cooldownError(origin) {
  const remaining = (cooldowns.get(origin) || 0) - Date.now();
  return remaining > 0 ? new ProviderFailure('Lyrics provider is busy.', Math.ceil(remaining / 1000)) : null;
}

async function fetchJson(url, options = {}) {
  const origin = new URL(url).origin;
  const blocked = cooldownError(origin);
  if (blocked) throw blocked;
  if (queued >= 8) throw new ProviderFailure('Lyrics queue is busy.', 3);
  const deadline = options.deadline || Date.now() + STAGE_BUDGET_MS;
  let expired = false, timer;
  queued++;
  const work = lyricQueue.catch(() => {}).then(async () => {
    // Expired entries do not consume a throttle slot or make a late provider request.
    if (expired || Date.now() >= deadline) throw new ProviderFailure('Lyrics queue timed out.', 2);
    const blockedNow = cooldownError(origin); if (blockedNow) throw blockedNow;
    await new Promise(resolve => setTimeout(resolve, 220));
    if (expired || Date.now() >= deadline) throw new ProviderFailure('Lyrics queue timed out.', 2);
    return fetchJsonNow(url, { ...options, deadline });
  }).finally(() => { queued--; });
  lyricQueue = work.catch(() => {});
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new ProviderFailure('Lyrics lookup timed out.', 2)); }, Math.max(1, deadline - Date.now()));
    })]);
  } finally { clearTimeout(timer); }
}

async function fetchJsonNow(url, options = {}) {
  const { timeout = STAGE_BUDGET_MS, deadline, ...rest } = options;
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, deadline ? deadline - Date.now() : timeout))),
      ...rest,
      headers: { Accept: 'application/json', 'User-Agent': 'JaSH-ViBeS/11.0 (https://github.com/Jash-k/jashvibes)', ...(rest.headers || {}) },
    });
  } catch { throw new ProviderFailure('Could not reach the lyrics provider.', 2); }
  if (response.status === 404) return null;
  if (response.status === 429 || response.status === 503) {
    const retry = response.headers.get('retry-after');
    const until = /^\d+$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '');
    cooldowns.set(new URL(url).origin, Number.isFinite(until) ? until : Date.now() + (response.status === 429 ? 30000 : 2000));
    throw new ProviderFailure('Lyrics provider is busy.', Math.max(1, Math.ceil(((cooldowns.get(new URL(url).origin)) - Date.now()) / 1000)));
  }
  if (!response.ok) throw new ProviderFailure(`Lyrics provider returned HTTP ${response.status}.`, 2, response.status >= 500);
  try { return await response.json(); } catch { throw new ProviderFailure('Lyrics provider returned an invalid response.', 2); }
}

/* ── retrieval: both LRCLIB questions, stage by stage ────────────────────── */

function lrclibScore(item = {}, wanted = {}) {
  const title = item.trackName || item.name || '';
  const wantedTitle = wanted.title || '';
  const artist = item.artistName || '';
  let score = 0;
  if (title.toLowerCase() === wantedTitle.toLowerCase()) score += 120;
  else if (title.toLowerCase().includes(wantedTitle.toLowerCase())) score += 70;
  const artistTokens = String(wanted.artist || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  const hits = artistTokens.filter((token) => artist.toLowerCase().includes(token)).length;
  score += artistTokens.length ? Math.round((hits / artistTokens.length) * 70) : 0;
  if (item.albumName && wanted.album && String(item.albumName).toLowerCase().includes(String(wanted.album).toLowerCase())) score += 25;
  const delta = Math.abs((Number(item.duration) || 0) - (Number(wanted.duration) || 0));
  if (Number(wanted.duration) > 0 && Number(item.duration) > 0) {
    if (delta <= 2) score += 30; else if (delta <= DURATION_TOLERANCE_SECONDS) score += 20; else score += Math.max(-30, 15 - delta);
  }
  if (item.syncedLyrics) score += 12;
  if (item.plainLyrics) score += 8;
  return score;
}

function stripTags(value = '') {
  return String(value || '').split(/\r?\n/).map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim()).filter(Boolean).join('\n');
}

function mapResult(item, sourceUrl, wanted) {
  const plainLyrics = item.plainLyrics || stripTags(item.syncedLyrics || '');
  return {
    lyrics: plainLyrics || item.syncedLyrics || '',
    plainLyrics,
    syncedLyrics: item.syncedLyrics || '',
    instrumental: Boolean(item.instrumental),
    source: 'lrclib',
    sourceUrl,
    matched: {
      id: item.id, trackName: item.trackName || item.name || '', artistName: item.artistName || '',
      albumName: item.albumName || '', duration: item.duration || 0,
      score: lrclibScore(item, wanted), tier: item.matchTier || null,
    },
    matchVersion: LYRICS_MATCH_VERSION,
  };
}

/**
 * Ask LRCLIB for one song. Returns the strongest accepted record, the stages
 * that were tried, and — when nothing matched — why, so the UI can be specific.
 */
async function findLyrics({ title, artist, album, duration, exclude = '', force = false, base = getLyricsApiBase() }) {
  const metadata = lyricRequestMetadata({ title, artists: artist, album, duration });
  const wanted = { title: metadata.title, artist: normalize(metadata.artist), album: metadata.album, duration: metadata.duration };
  const blocked = new Set(String(exclude).split(',').filter(Boolean));
  const attempts = [];
  const started = Date.now();
  let failure = null;
  if (!wanted.title || !wanted.artist) {
    return { result: null, attempts, reason: 'missing-metadata', failure: null };
  }
  const variants = lyricSearchVariants({ title: wanted.title, album: wanted.album });
  const best = { item: null, rank: -1 };
  const TIER = { strong: 3, 'album-duration': 2, 'artist-duration': 2, 'vocal-alias': 1 };

  const ask = async (path, params, label) => {
    if (Date.now() - started >= TOTAL_BUDGET_MS) { attempts.push({ stage: label, outcome: 'skipped-budget' }); return null; }
    const url = new URL(path, base + '/');
    for (const [key, value] of Object.entries(params)) if (value !== '' && value != null) url.searchParams.set(key, String(value));
    let payload;
    try {
      payload = await fetchJson(url.toString(), { deadline: Date.now() + STAGE_BUDGET_MS });
    } catch (error) {
      failure = error;
      attempts.push({ stage: label, outcome: 'error', message: error.message });
      return null;
    }
    if (payload === null) { attempts.push({ stage: label, outcome: 'not-found' }); return null; }
    const rows = (Array.isArray(payload) ? payload : [payload]).filter((row) => row && typeof row === 'object');
    if (!rows.length) { attempts.push({ stage: label, outcome: 'empty' }); return null; }
    const items = rows.filter((row) => !blocked.has(String(row.id)));
    const match = chooseLyricMatch(items, wanted);
    attempts.push({ stage: label, outcome: match ? 'matched' : 'rejected', candidates: rows.length });
    if (!match) return null;
    const rank = TIER[match.matchTier] || 0;
    if (rank > best.rank) { best.item = match; best.rank = rank; best.url = url.toString(); }
    return match;
  };

  // 1. The exact signature. Duration is optional upstream; omitting it is better
  //    than sending a duration that would 404 a record we then never try again.
  await ask('/api/get', {
    track_name: variants[0], artist_name: wanted.artist, album_name: wanted.album,
    duration: wanted.duration > 0 && wanted.duration <= 3600 ? Math.round(wanted.duration) : '',
  }, 'get');
  // 2. Fielded search across title variants.
  for (const variant of variants.slice(0, 3)) {
    if (best.rank >= 3) break;
    await ask('/api/search', { track_name: variant }, `search-track_name:${variant.slice(0, 40)}`);
  }
  // 3. Free-text search — the query that finds records the fielded one misses.
  for (const variant of variants.slice(0, 2)) {
    if (best.rank >= 3) break;
    await ask('/api/search', { q: wanted.album ? `${variant} ${wanted.album}` : variant }, `search-q:${variant.slice(0, 40)}`);
  }
  // 3b. Last resort: artist + title as free text, which survives album suffixes.
  if (!best.item && wanted.artist && Date.now() - started < TOTAL_BUDGET_MS) {
    await ask('/api/search', { q: `${wanted.title} ${wanted.artist}` }, 'search-q:title+artist');
  }
  if (!best.item) {
    const reason = attempts.some((a) => a.outcome === 'rejected') ? 'identity-rejected'
      : attempts.some((a) => a.outcome === 'error') ? 'provider-error' : 'not-in-catalogue';
    return { result: null, attempts, reason, failure };
  }
  return { result: mapResult(best.item, best.url, wanted), attempts, reason: null, failure };
}

/* ── picker helpers ──────────────────────────────────────────────────────── */

const MAX_LRCLIB_SCORE = 265;
const scorePercent = (score = 0) => Math.max(0, Math.min(99, Math.round((Number(score) || 0) / MAX_LRCLIB_SCORE * 100)));
const previewLines = (text = '', limit = 3) => String(text || '').split(/\r?\n/)
  .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim()).filter(Boolean).slice(0, limit);
const lineCount = (text = '') => String(text || '').split(/\r?\n/)
  .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim()).filter(Boolean).length;

const NO_STORE = { 'Cache-Control': 'no-store' };
const json = (data, status = 200) => NextResponse.json(data, { status, headers: NO_STORE });

const MESSAGES = {
  'missing-metadata': 'This song arrived without a title or artist, so there was nothing safe to look up.',
  'not-in-catalogue': 'LRCLIB does not have this song. Nothing else is substituted — you can paste the lyrics for it.',
  'identity-rejected': 'LRCLIB returned records for this song but none matched its title, artist and duration closely enough to show.',
  'provider-error': 'The lyrics provider could not be reached.',
  'user-saved': '',
};

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get('id') || '').trim();
  const title = String(searchParams.get('title') || '').trim();
  const artist = String(searchParams.get('artist') || searchParams.get('artists') || '').trim();
  const album = String(searchParams.get('album') || '').trim();
  const duration = Number(searchParams.get('duration') || 0);
  const exclude = String(searchParams.get('exclude') || '').replace(/[^0-9,]/g, '').slice(0, 500);
  const force = searchParams.get('force') === '1';
  const wantsList = searchParams.get('list') === '1';
  const forced = String(searchParams.get('source') || '').trim().toLowerCase();
  const song = { title, artist, album, duration, id };

  /* catalogue only: the list of sources, no provider is touched */
  if (wantsList && searchParams.get('catalogue') === '1' && !title && !id) {
    return json({ catalogue: groupedSources(), groups: SOURCE_GROUPS });
  }

  /* the owner's own lyrics win before anything is asked of a provider */
  const override = (!force && (title || id)) ? await readLyricsOverride(song) : null;
  const overrideRow = override ? {
    id: 'user', ok: true, kind: override.syncedLyrics ? 'synced' : 'plain',
    plainLyrics: override.plainLyrics || '', syncedLyrics: override.syncedLyrics || '', matched: null, ms: 0,
    lines: lineCount(override.syncedLyrics || override.plainLyrics || ''),
    preview: previewLines(override.syncedLyrics || override.plainLyrics || ''), reason: null,
  } : null;

  /* the picker: one provider, previewed, plus whatever the owner saved */
  if (wantsList) {
    const started = Date.now();
    const found = overrideRow ? { result: { lyrics: overrideRow.plainLyrics || overrideRow.syncedLyrics, ...overrideRow }, attempts: [], reason: null } : await findLyrics({ title, artist, album, duration, exclude, force });
    const lrclib = found.result
      ? {
        id: 'lrclib', ok: true, kind: found.result.syncedLyrics ? 'synced' : 'plain',
        plainLyrics: found.result.plainLyrics || '', syncedLyrics: found.result.syncedLyrics || '',
        matched: found.result.matched || null, ms: Date.now() - started,
        lines: lineCount(found.result.syncedLyrics || found.result.plainLyrics || ''),
        preview: previewLines(found.result.syncedLyrics || found.result.plainLyrics || ''),
        match: found.result.matched?.score != null ? scorePercent(found.result.matched.score) : null,
        winner: overrideRow ? 'user' : 'lrclib', reason: null,
      }
      : {
        id: 'lrclib', ok: false, kind: 'none', plainLyrics: '', syncedLyrics: '', matched: null,
        ms: Date.now() - started, lines: 0, preview: [], match: null, winner: null,
        reason: MESSAGES[found.reason] || 'No match for this song.', retryable: found.reason === 'provider-error',
      };
    const auto = {
      id: 'auto', ok: lrclib.ok, kind: lrclib.kind, plainLyrics: lrclib.plainLyrics, syncedLyrics: lrclib.syncedLyrics,
      matched: lrclib.matched, ms: lrclib.ms, lines: lrclib.lines, preview: lrclib.preview, match: lrclib.match,
      winner: lrclib.ok ? (overrideRow ? 'user' : 'lrclib') : null,
      reason: lrclib.ok ? null : lrclib.reason, retryable: Boolean(lrclib.retryable), retryAfter: 0,
    };
    const catalogue = Object.fromEntries(groupedSources().flatMap((group) => group.items.map((item) => [item.id, item])));
    const rows = [...(overrideRow ? [overrideRow] : []), auto, lrclib];
    const sources = rows.map((result) => {
      const meta = catalogue[result.id] || { id: result.id, name: result.id, mark: '?', kind: 'none' };
      return {
        ...result,
        name: meta.name, mark: meta.mark, pickable: true,
        applies: result.id === 'auto' ? (WIRED_SOURCE_KIND[lrclib.winner] || 'synced') : (WIRED_SOURCE_KIND[result.id] || (result.id === 'user' ? result.kind : 'none')),
        evidence: meta.evidence, note: meta.note, wired: true,
      };
    });
    return json({
      sources, groups: SOURCE_GROUPS.map((g) => ({ id: g.id, label: g.label, badge: g.badge, tone: g.tone })),
      catalogue: groupedSources(), wanted: { id, title, artist, album, duration },
    });
  }

  /* pinned source: what the picker's choice applies */
  if (forced && forced !== 'auto') {
    if (forced === 'inst') {
      return json({ lyrics: '', plainLyrics: '', syncedLyrics: '', instrumental: true, source: 'inst', applied: 'none' });
    }
    if (forced === 'user') {
      if (!overrideRow) return json({ lyrics: '', plainLyrics: '', syncedLyrics: '', source: 'user', applied: 'none', message: 'No saved lyrics for this song yet.' });
      return json({
        lyrics: overrideRow.plainLyrics || overrideRow.syncedLyrics, plainLyrics: overrideRow.plainLyrics,
        syncedLyrics: overrideRow.syncedLyrics, instrumental: false, source: 'user',
        applied: overrideRow.kind, matched: null, matchVersion: LYRICS_MATCH_VERSION,
      });
    }
    if (!isPickable(forced) || !sourceById(forced)?.group) {
      return json({ lyrics: '', plainLyrics: '', syncedLyrics: '', source: forced, applied: 'none', message: 'That source is not wired in this app.' });
    }
  }

  /* default: owner's lyrics, then the persistent cache, then LRCLIB */
  try {
    if (overrideRow) {
      return json({
        lyrics: overrideRow.plainLyrics || overrideRow.syncedLyrics, plainLyrics: overrideRow.plainLyrics,
        syncedLyrics: overrideRow.syncedLyrics, instrumental: false, source: 'user',
        sourceUrl: '', matched: { note: override.note || '', origin: override.origin, tier: 'user' },
        matchVersion: LYRICS_MATCH_VERSION, cached: false,
      });
    }
    if (!force) {
      const cached = await readLyricsCache(song);
      if (cached?.status === 'ok' && cached.payload) {
        return json({ ...cached.payload, matchVersion: LYRICS_MATCH_VERSION, cached: true });
      }
      if (cached?.status === 'none' && (title || id)) {
        const reason = cached.reason || 'not-in-catalogue';
        return json({
          lyrics: '', plainLyrics: '', syncedLyrics: '', source: 'none', reason,
          message: MESSAGES[reason] || 'No lyrics for this song.', retryable: reason === 'provider-error', cached: true,
        });
      }
    }
    const found = await findLyrics({ title, artist, album, duration, exclude, force });
    if (found.result) {
      writeLyricsCache(song, { status: 'ok', payload: found.result });   // fire and forget
      return json(found.result);
    }
    writeLyricsCache(song, { status: 'none', reason: found.reason });
    if (found.reason === 'provider-error' && found.failure?.retryable !== false) throw found.failure;
    return json({
      lyrics: '', plainLyrics: '', syncedLyrics: '', source: 'none', reason: found.reason,
      message: MESSAGES[found.reason] || 'No lyrics for this song.', tried: found.attempts,
      retryable: found.reason === 'provider-error',
    });
  } catch (error) {
    // A provider outage is a retryable outcome, never a "this song has no lyrics" verdict.
    return NextResponse.json(
      { lyrics: '', plainLyrics: '', syncedLyrics: '', source: 'error',
        message: error.message || 'Lyrics lookup failed', retryable: error.retryable !== false,
        retryAfter: error.retryAfter || 2 },
      { status: error.retryable === false ? 502 : 503, headers: { ...NO_STORE, 'Retry-After': String(error.retryAfter || 2) } },
    );
  }
}
