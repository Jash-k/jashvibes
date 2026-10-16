import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  chooseLyricMatch, lyricAlbum, lyricIdentity, lyricRequestMetadata, lyricSameTitle, lyricSearchVariants,
  LYRICS_MATCH_VERSION, DURATION_TOLERANCE_SECONDS,
} from '@/lib/lyricsMatch';
import { SOURCE_GROUPS, WIRED_SOURCE_KIND, groupedSources, isPickable, sourceById } from '@/lib/musicSources';
import { readLyricsOverride, readLyricsCache, writeLyricsCache, saveLyricsOverride, deleteLyricsOverride, lyricsSongKey } from '@/lib/lyricsStore';
import { recordAction } from '@/lib/adminAudit';
import LyricsOverride from '@/models/LyricsOverride';
import { verifyRequestToken } from '@/lib/serverAuth';

/*
 * GET /api/music/lyrics — one source, several ways of asking. POST — choose a record by hand.
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
async function findLyrics({ title, artist, album, duration, exclude = '', force = false, base = getLyricsApiBase(), collect = null }) {
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
    // The picker needs the records the matcher *did not* choose as well: "wrong lyrics" is usually a
    // right song on the wrong record (a live cut, a different album, a karaoke version), and those
    // are exactly the ones a single winner throws away.
    if (collect) for (const row of items) collect(row, label, wanted);
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

/**
 * Every record LRCLIB has for this song, as a list a person can choose from.
 *
 * The matcher is deliberately strict — it will not show a record from a different song — but
 * "wrong lyrics" is almost always the *right* song on the wrong record: a live cut, a different
 * album, a karaoke track, a version with the film's name attached. Those records are real and the
 * owner can see which is which, so the job here is to show them plainly (title, artist, timings or
 * not, length) and let a human decide. Nothing is substituted automatically: this only lists.
 */
async function collectCandidates({ title, artist, album, duration, base = getLyricsApiBase() }) {
  const metadata = lyricRequestMetadata({ title, artists: artist, album, duration });
  const wanted = { title: metadata.title, artist: normalize(metadata.artist), album: metadata.album, duration: metadata.duration };
  const seen = new Map();
  const attempts = [];

  if (!wanted.title || !wanted.artist) {
    return { rows: [], autoId: '', attempts, message: 'This song arrived without a title or artist, so there was nothing safe to search for.' };
  }

  const found = await findLyrics({
    title, artist, album, duration, base,
    collect: (row, stage) => {
      const id = row?.id != null ? String(row.id) : '';
      if (!id) return;
      // The free-text stages answer with loosely related songs. The list is for *this* song's other
      // versions, so anything that is not the same title is dropped here — and the strict identity
      // rules are not applied, because a live cut or a differently credited version is exactly what
      // the owner came to find.
      if (!lyricSameTitle(row.trackName || row.name || '', wanted.title)) return;
      const previous = seen.get(id);
      const candidate = {
        id,
        title: normalize(row.trackName || row.name || ''),
        artist: normalize(row.artistName || ''),
        album: normalize(row.albumName || ''),
        duration: Number(row.duration) || 0,
        // What the option says: whether this record carries timings, and how long it runs.
        synced: Boolean(row.syncedLyrics),
        lines: lineCount(row.syncedLyrics || row.plainLyrics || ''),
        preview: previewLines(row.syncedLyrics || row.plainLyrics || '', 2),
        score: scorePercent(lrclibScore(row, wanted)),
        stage,
      };
      // The same record can arrive from several stages; keep whichever copy carries the timings.
      if (!previous || (!previous.synced && candidate.synced)) seen.set(id, candidate);
    },
  });

  const autoId = found.result?.matched?.id != null ? String(found.result.matched.id) : '';
  const rows = [...seen.values()].sort((a, b) => {
    if (a.id === autoId) return -1;
    if (b.id === autoId) return 1;
    // Timed records first, then the ones closest to the length of the track actually playing.
    if (a.synced !== b.synced) return a.synced ? -1 : 1;
    const da = wanted.duration ? Math.abs(a.duration - wanted.duration) : 0;
    const db = wanted.duration ? Math.abs(b.duration - wanted.duration) : 0;
    return da - db || a.title.localeCompare(b.title);
  });
  return { rows, autoId, attempts: found.attempts || [], message: rows.length ? '' : (MESSAGES[found.reason] || 'No records for this song.') };
}

const accessToken = (password = '') => crypto.createHash('sha256').update(`jash-theatre:${password}`).digest('hex');

/**
 * Only the owner may rewrite the saved lyrics: the panel runs inside their session, and the same
 * rule already guards the playlist API. A local install with no password configured is its own
 * owner, so it stays open — the picker would be useless behind a login nobody set up.
 */
function isAuthorized(request) {
  const configuredPassword = process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
  const adminToken = process.env.MUSIC_ADMIN_TOKEN || process.env.SYNC || '';
  if (!configuredPassword && !adminToken) return true;
  if (verifyRequestToken(request)) return true;
  const token = request.headers.get('x-jash-token') || request.headers.get('x-music-admin-token') || new URL(request.url).searchParams.get('token') || '';
  if (adminToken && token === adminToken) return true;
  if (configuredPassword && token === accessToken(configuredPassword)) return true;
  return false;
}

/**
 * POST /api/music/lyrics — { action: 'choose' | 'clear', …song, candidateId }
 *
 * `choose` pins one LRCLIB record to this song by saving its text through the same store the admin
 * panel uses, so it wins on every device, survives a provider outage, and shows up in the Lyrics
 * tab as saved lyrics. It is recorded in the audit trail like any other write.
 *
 * `clear` removes that pin, which is the way back to the automatic match.
 */
export async function POST(request) {
  if (!isAuthorized(request)) {
    return json({ ok: false, message: 'Sign in to change the saved lyrics.' }, 401);
  }
  try {
    const body = await request.json().catch(() => ({}));
    const song = {
      title: String(body.title || ''), artist: String(body.artist || ''), album: String(body.album || ''),
      duration: Number(body.duration) || 0, id: String(body.id || ''),
    };
    const key = lyricsSongKey(song);
    if (!key) return json({ ok: false, message: 'This song has no identity to save lyrics against.' }, 400);

    if (body.action === 'clear') {
      const before = await LyricsOverride.findOne({ key }).lean().catch(() => null);
      const removed = await deleteLyricsOverride(key);
      if (removed) {
        await recordAction({
          area: 'lyrics', action: 'lyrics.clear', targetModel: 'LyricsOverride',
          summary: `Cleared the saved lyrics for “${before?.title || song.title}” — back to the automatic match`,
          target: { kind: 'lyrics-override', key, label: before?.title || song.title },
          before: before ? lyricsSnapshot(before) : null, after: null,
        });
      }
      return json({ ok: true, cleared: Boolean(removed) });
    }

    if (body.action !== 'choose') return json({ ok: false, message: 'Unknown lyrics action.' }, 400);

    const candidateId = String(body.candidateId || '').replace(/[^0-9]/g, '').slice(0, 20);
    if (!candidateId) return json({ ok: false, message: 'No lyric record was chosen.' }, 400);

    // Fetch the record from the provider — never trust a copy sent by the browser.
    const record = await fetchRecordById(candidateId);
    if (!record) return json({ ok: false, message: 'That record is no longer available at the provider.' }, 404);
    const plainLyrics = String(record.plainLyrics || '');
    const syncedLyrics = String(record.syncedLyrics || '');
    if (!plainLyrics.trim() && !syncedLyrics.trim()) {
      return json({ ok: false, message: 'That record has no lyrics text in it.' }, 409);
    }

    const before = await LyricsOverride.findOne({ key }).lean().catch(() => null);
    // What the automatic matcher would have said about this record. It is recorded, not enforced:
    // the owner can see the title, artist, album and length in the dropdown, so their pick wins —
    // but the reason travels with it, because "you chose a record the matcher would reject" is
    // exactly the sort of thing worth being able to read back later.
    const identity = lyricIdentity(record, { title: song.title, artist: song.artist, album: song.album, duration: song.duration });
    const verdict = identity?.ok ? `matched: ${identity.tier || 'ok'}` : `matcher would reject: ${identity?.reason || 'unknown'}`;
    const note = `Chosen from LRCLIB record ${candidateId} — ${normalize(record.trackName || '')}${record.artistName ? ` · ${normalize(record.artistName)}` : ''}${record.albumName ? ` · ${normalize(record.albumName)}` : ''} (${verdict})`;
    await saveLyricsOverride(song, { plainLyrics, syncedLyrics, note: note.slice(0, 400), origin: 'user' });
    const after = await LyricsOverride.findOne({ key }).lean().catch(() => null);
    await recordAction({
      area: 'lyrics', action: 'lyrics.choose', targetModel: 'LyricsOverride',
      summary: `Picked a different lyrics record for “${song.title}” — ${syncedLyrics ? 'synced' : 'plain'} version, ${normalize(record.trackName || '')}`,
      target: { kind: 'lyrics-override', key, label: song.title },
      before: before ? lyricsSnapshot(before) : null,
      after: after ? lyricsSnapshot(after) : null,
    });
    return json({
      ok: true, key, synced: Boolean(syncedLyrics), plainLyrics, syncedLyrics,
      title: normalize(record.trackName || ''), artist: normalize(record.artistName || ''),
      identity: identity ? { ok: Boolean(identity.ok), tier: identity.tier || '', reason: identity.reason || '' } : null,
    });
  } catch (error) {
    return json({ ok: false, message: error.message || 'Could not save that choice.' }, error.status || 503);
  }
}

/** One LRCLIB record by id, through the same queue and cooldowns as every other lookup. */
async function fetchRecordById(id, base = getLyricsApiBase()) {
  for (const path of [`/api/get/${id}`, `/api/get?id=${id}`]) {
    try {
      const payload = await fetchJson(new URL(path, base + '/').toString(), { deadline: Date.now() + STAGE_BUDGET_MS });
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
    } catch { /* try the next shape */ }
  }
  return null;
}

function lyricsSnapshot(doc = {}) {
  return {
    key: doc.key || '', title: doc.title || '', artist: doc.artist || '', album: doc.album || '',
    plainLyrics: String(doc.plainLyrics || '').slice(0, 40000),
    syncedLyrics: String(doc.syncedLyrics || '').slice(0, 40000),
    note: doc.note || '', origin: doc.origin === 'admin' ? 'admin' : 'user',
  };
}

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
  // `reload=1` is the picker's signal: re-read the saved lyrics and skip the cached provider answer.
  // `force=1` stays what the rejection path needs — bypass everything, saved lyrics included.
  const reload = searchParams.get('reload') === '1';
  const wantsCandidates = searchParams.get('candidates') === '1';
  const wantsList = searchParams.get('list') === '1';
  const forced = String(searchParams.get('source') || '').trim().toLowerCase();
  const song = { title, artist, album, duration, id };

  /* the picker's list: every record LRCLIB offers for this song, not just the winner */
  if (wantsCandidates) {
    if (!title && !id) return json({ ok: false, candidates: [], message: 'This song arrived without a title, so there is nothing to search for.', reason: 'missing-metadata' }, 400);
    try {
      const [list, override] = await Promise.all([
        collectCandidates({ title, artist, album, duration }),
        readLyricsOverride(song).catch(() => null),
      ]);
      const autoId = list.autoId;
      const rows = list.rows.map((row) => ({ ...row, auto: row.id === autoId }));
      // The note written by POST /choose carries the record id, so the saved choice can be shown as
      // selected in the list rather than as a stranger among the options.
      const savedId = /record (\d+)/.exec(override?.note || '')?.[1] || '';
      return json({
        ok: true, wanted: { id, title, artist, album, duration },
        autoId, savedId, current: override ? 'saved' : 'auto', savedAt: override?.updatedAt || null,
        candidates: rows, attempts: list.attempts, message: list.message || '',
      });
    } catch (error) {
      return json({ ok: false, candidates: [], message: error.message || 'Could not list the available lyrics.', reason: 'provider-error' }, 503);
    }
  }

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
    if (!force && !reload) {
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
