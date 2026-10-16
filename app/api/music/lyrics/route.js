import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  chooseLyricMatch, lyricIdentity, lyricRequestMetadata, lyricSameTitle, lyricSearchVariants,
  LYRICS_MATCH_VERSION, DURATION_TOLERANCE_SECONDS,
} from '@/lib/lyricsMatch';
import { isPickable, sourceById } from '@/lib/musicSources';
import { readLyricsOverride, readLyricsCache, writeLyricsCache, saveLyricsOverride, deleteLyricsOverride, lyricsSongKey } from '@/lib/lyricsStore';
import { recordAction } from '@/lib/adminAudit';
import LyricsOverride from '@/models/LyricsOverride';
import { verifyRequestToken } from '@/lib/serverAuth';

/*
 * GET /api/music/lyrics — one song, one request. POST — choose a record by hand.
 *
 * The redesign keeps LRCLIB as the only provider, and this round makes a song cost exactly one
 * call:
 *
 *   1. ONE CALL, IN THE RIGHT ORDER. `track_name` alone answers with the whole page — the match
 *      and the list — and is narrowed by `artist_name` only when that page carried nothing the
 *      matcher would accept (our artist string is a credit list, and the field is an AND filter:
 *      measured on 116 catalogue songs, asking with it first lost songs that the title question
 *      finds and returned an empty record list for 27 of them). The free-text `q=` question is
 *      asked only when those two came back with no rows at all — never as a retry after a
 *      refusal: a provider that is refusing this request is refusing the next one too, and the
 *      owner's own retry is worth more than one spent here. The complaint this fixes was a
 *      lookup that made a dozen requests for one song and spent the origin's goodwill on itself.
 *
 *   2. ONE ANSWER FOR BOTH JOBS. The same response carries the best record the strict matcher
 *      accepts *and* every record the search returned, so the panel's record list is not a second
 *      look-up. This song's records come first; everything else the search returned — the covers,
 *      the karaoke cuts, the other languages the gate rightly refuses — follows, dimmed, as
 *      context to choose from by hand, and is never an automatic match.
 *
 *   3. MEMORY FIRST, ALWAYS. A song's answer is kept in this process for fifteen minutes and in
 *      MongoDB for 90 days (a miss for 12 hours), and two callers asking for the same song at the
 *      same time share the one call already in flight. A song fetched once is free the next time
 *      the stage or the panel wants it, and a provider outage serves that remembered answer with
 *      a retry symbol instead of an empty column. A failure is stored nowhere.
 *
 * Acceptance is still the single gate: `lyricIdentity` decides what may be shown, and a rejection
 * is reported with its reason code rather than a blank stage. Nothing is ever substituted from a
 * different song — but a title the *catalogue* decorated (it appends "(Trending Version)",
 * "(Title Theme)", "(LoFi Mix)") is the same recording, so the newest tier accepts it when the
 * artist or the album also agrees and the length matches. That verdict travels as the tier name
 * `catalogue-suffix`, so a wrong pick is traceable.
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

/* ── retrieval: one call per song, one memory of the answer ─────────────── */

/**
 * The one place a lyrics lookup happens: memory → database → provider, and what comes back is
 * remembered as a whole — the matched record *and* the list — under one song key.
 *
 * Two reasons, both about the provider's patience. One song's answer is wanted by two parts of the
 * screen (the stage's lines and the panel's list), and a second request for one song is one more
 * than LRCLIB needs to answer. And the retry a person presses after a 503 has to be the *next*
 * call, so a failure is stored nowhere: it is reported, and the last good answer for that song, if
 * there is one, is served with `stale` set.
 */
const bundles = new Map();
const pending = new Map();
const BUNDLE_TTL_MS = 15 * 60 * 1000;
const BUNDLE_LIMIT = 80;

function readBundle(key) {
  const entry = key ? bundles.get(key) : null;
  if (!entry) return null;
  if (Date.now() - entry.at > BUNDLE_TTL_MS) { bundles.delete(key); return null; }
  return entry;
}

function writeBundle(key, entry) {
  if (!key) return;
  if (bundles.size >= BUNDLE_LIMIT) bundles.delete(bundles.keys().next().value);
  bundles.set(key, { at: Date.now(), ...entry });
}

function mergeRows(first = [], second = []) {
  const seen = new Map();
  for (const row of [...first, ...second]) {
    const id = row?.id != null ? String(row.id) : '';
    if (!id) continue;
    const previous = seen.get(id);
    if (!previous || (!previous.syncedLyrics && row.syncedLyrics)) seen.set(id, row);
  }
  return [...seen.values()];
}

/**
 * ONE call, asked in the order a person would ask it — measured, not assumed.
 *
 *   1. `track_name` ALONE. LRCLIB treats the search fields as an AND filter, and our artist
 *      string is a credit list (lyricist, composer, singers joined) that rarely equals LRCLIB's
 *      own `artistName`, so `track_name` + `artist_name` answers 200 with an EMPTY array far more
 *      often than it helps: measured on 116 real catalogue songs, title-alone found songs the
 *      artist form lost, and returned a full 20-row list where the artist form returned none. The
 *      title question also answers with the whole page, which is what the panel's list needs.
 *   2. `track_name` + `artist_name` ONLY when step 1 returned rows but no record passed the
 *      matcher — the narrowing that pulls the exact record out of a crowded common title's page.
 *   3. `q=` free text ONLY when steps 1–2 returned no rows at all (the question LRCLIB's own site
 *      asks). An empty answer is worth one different question; a refusal or a rejection is not.
 *
 * Rows from the stages that ran are merged (one copy per record, preferring the timed one) and
 * returned even when no record passes the strict matcher. The matcher decides what is *shown*;
 * the list is how a person reaches the live cut, the cover or the other album it refused, so
 * "no match" must not mean "nothing to show".
 */
async function searchRecords({ title, artist, album, duration, exclude = [], base = getLyricsApiBase() }) {
  const metadata = lyricRequestMetadata({ title, artists: artist, album, duration });
  const wanted = { title: metadata.title, artist: normalize(metadata.artist), album: metadata.album, duration: metadata.duration };
  const attempts = [];
  if (!wanted.title || !wanted.artist) {
    return { wanted, rows: [], match: null, attempts, reason: 'missing-metadata', failure: null };
  }
  const variants = lyricSearchVariants({ title: wanted.title, album: wanted.album });
  const blocked = new Set(exclude);
  let failure = null;

  const ask = async (params, stage) => {
    const url = new URL('/api/search', base + '/');
    for (const [field, value] of Object.entries(params)) if (value !== '' && value != null) url.searchParams.set(field, String(value));
    let payload;
    try {
      payload = await fetchJson(url.toString(), { deadline: Date.now() + STAGE_BUDGET_MS });
    } catch (error) {
      failure = error;
      attempts.push({ stage, outcome: 'error', message: error.message });
      return null;
    }
    if (payload === null) { attempts.push({ stage, outcome: 'not-found' }); return null; }
    const rows = (Array.isArray(payload) ? payload : [payload])
      .filter((row) => row && typeof row === 'object' && row.id != null && !blocked.has(String(row.id)));
    attempts.push({ stage, outcome: rows.length ? 'rows' : 'empty', candidates: rows.length });
    return rows;
  };

  // The strict rules only ever see this song's own records; the rest of the search is shown after
  // them, dimmed, and can be picked by hand but never chosen for the song automatically.
  const judge = (list) => chooseLyricMatch(
    list.filter((row) => lyricSameTitle(row.trackName || row.name || '', wanted.title)), wanted,
  );

  // 1. the title alone — the answer that fills the page, and usually the match
  let rows = await ask({ track_name: variants[0] }, `search-track_name:${variants[0].slice(0, 40)}`);
  let match = rows && rows.length ? judge(rows) : null;

  // 2. the artist narrows — only when that page carried no record the matcher would accept
  if (rows && rows.length && !match) {
    const narrowed = await ask({ track_name: variants[0], artist_name: wanted.artist }, 'search-title+artist');
    if (narrowed && narrowed.length) { rows = mergeRows(rows, narrowed); match = judge(rows); }
  }

  // 3. and only a wholly empty answer earns the free-text question
  if (rows && !rows.length) {
    const loose = await ask({ q: `${variants[0]} ${wanted.artist}`.trim() }, 'search-q:title+artist');
    if (loose && loose.length) { rows = loose; match = judge(rows); }
  }

  if (!rows) return { wanted, rows: [], match: null, attempts, reason: 'provider-error', failure };
  return { wanted, rows, match, attempts, reason: match ? null : (rows.length ? 'identity-rejected' : 'not-in-catalogue'), failure };
}

/** The search's rows as the panel's list: this song's records first, then the rest, dimmed. */
function listRows({ rows = [], wanted = {}, autoId = '' }) {
  const gap = (row) => (Number(wanted.duration) > 0 && Number(row.duration) > 0 ? Math.abs(Number(row.duration) - Number(wanted.duration)) : Number.MAX_SAFE_INTEGER);
  return rows.map((row) => {
    const id = String(row.id);
    return {
      id,
      title: normalize(row.trackName || row.name || ''),
      artist: normalize(row.artistName || ''),
      album: normalize(row.albumName || ''),
      duration: Number(row.duration) || 0,
      synced: Boolean(row.syncedLyrics),
      lines: lineCount(row.syncedLyrics || row.plainLyrics || ''),
      preview: previewLines(row.syncedLyrics || row.plainLyrics || '', 2),
      score: scorePercent(lrclibScore(row, wanted)),
      // Whether this record carries the song's own name. `false` is not an error: it is the rest
      // of the search, kept for the person to look through.
      same: lyricSameTitle(row.trackName || row.name || '', wanted.title),
      auto: id === autoId,
    };
  }).sort((a, b) => {
    if (a.auto !== b.auto) return a.auto ? -1 : 1;
    if (a.same !== b.same) return a.same ? -1 : 1;
    if (a.synced !== b.synced) return a.synced ? -1 : 1;
    return gap(a) - gap(b) || b.score - a.score || a.title.localeCompare(b.title);
  });
}

/**
 * The lookup the two routes share. `needsList` is the panel asking for the records as well; a
 * record cached before this round (a payload with no list) still answers the stage, but the panel
 * asks once more and the answer it gets is written with a list — so the cache heals itself instead
 * of keeping a song listless for 90 days.
 */
async function lookupBundle({ song = {}, title, artist, album, duration, exclude = '', base = getLyricsApiBase(), needsList = false, skipCache = false, skipMemory = false }) {
  const key = lyricsSongKey(song);
  if (!skipMemory) {
    const memory = readBundle(key);
    if (memory && (!needsList || memory.list?.length || memory.result === null)) return { ...memory, cached: true, stale: false, busy: false };
  }
  if (!skipCache && key) {
    const stored = await readLyricsCache(song).catch(() => null);
    // A miss recorded during an outage is not a fact about the song: it is ignored and asked again.
    const poisoned = stored?.status === 'none' && stored.reason === 'provider-error';
    if (stored && !poisoned && (!needsList || Array.isArray(stored.list))) {
      const entry = {
        result: stored.status === 'ok' ? (stored.payload || null) : null,
        list: Array.isArray(stored.list) ? stored.list : [],
        autoId: String(stored.autoId || ''),
        reason: stored.status === 'ok' ? null : (stored.reason || 'not-in-catalogue'),
        attempts: [],
      };
      if (entry.result || entry.list.length) writeBundle(key, entry);
      return { ...entry, cached: true, stale: false, busy: false };
    }
  }
  // Two callers, one song, one call: whoever asks second joins the lookup already in flight — but
  // "ask again" never joins anything, because that request would be answered by the very call it
  // was asking to replace.
  if (key && !skipCache && !skipMemory && pending.has(key)) return pending.get(key);
  const work = (async () => {
    const searched = await searchRecords({ title, artist, album, duration, exclude: String(exclude).split(',').filter(Boolean), base });
    const autoId = searched.match?.id != null ? String(searched.match.id) : '';
    const entry = {
      result: searched.match ? mapResult(searched.match, new URL(`/api/get/${searched.match.id}`, base + '/').toString(), searched.wanted) : null,
      list: listRows({ rows: searched.rows, wanted: searched.wanted, autoId }),
      autoId,
      reason: searched.reason,
      attempts: searched.attempts,
      failure: searched.failure || null,
    };
    // A refusal is remembered nowhere. What was found — a match, or the other records, or both —
    // is remembered in both memories, so the next look costs nothing.
    if (entry.result || entry.list.length) {
      writeBundle(key, entry);
      writeLyricsCache(song, { status: entry.result ? 'ok' : 'none', payload: entry.result, reason: entry.reason || '', list: entry.list, autoId: entry.autoId });
    }
    return { ...entry, cached: false, stale: false, busy: false };
  })().finally(() => { if (key) pending.delete(key); });
  if (key) pending.set(key, work);
  return work;
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
  const forced = String(searchParams.get('source') || '').trim().toLowerCase();
  const song = { title, artist, album, duration, id };

  /*
   * The panel's one request: the record this song is using and every record the same search
   * returned. `reload=1` is the picker's signal (re-read the saved lyrics, skip the remembered
   * provider answer) and `force=1` skips everything — both mean "look again", so neither joins a
   * memory.
   */
  if (wantsCandidates) {
    if (!title && !id) return json({ ok: false, candidates: [], message: 'This song arrived without a title, so there is nothing to search for.', reason: 'missing-metadata' }, 400);
    const fresh = reload || force;
    const [bundle, override] = await Promise.all([
      lookupBundle({ song, title, artist, album, duration, exclude, needsList: true, skipCache: fresh, skipMemory: force }),
      readLyricsOverride(song).catch(() => null),
    ]);
    // The note written by POST /choose carries the record id, so the saved choice can be shown as
    // selected in the list rather than as a stranger among the options.
    const savedId = /record (\d+)/.exec(override?.note || '')?.[1] || '';
    const rows = (bundle.list || []).map((row) => ({ ...row, auto: row.id === bundle.autoId, saved: row.id === savedId }));
    const busy = bundle.reason === 'provider-error';
    return json({
      ok: true, wanted: { id, title, artist, album, duration },
      autoId: bundle.autoId || '', savedId, current: override ? 'saved' : 'auto', savedAt: override?.updatedAt || null,
      // A busy provider with records from before is still an answer: the list is served, the retry
      // symbol is shown beside it, and an outage never empties the panel.
      busy, stale: busy, cached: Boolean(bundle.cached), retryable: busy, retryAfter: bundle.failure?.retryAfter || 2,
      candidates: rows, attempts: bundle.attempts || [],
      message: busy ? 'Lyrics provider is busy.' : (bundle.reason ? (MESSAGES[bundle.reason] || '') : ''),
    });
  }

  /* the owner's own lyrics win before anything is asked of a provider */
  const override = (!force && (title || id)) ? await readLyricsOverride(song) : null;
  const overrideRow = override ? {
    id: 'user', ok: true, kind: override.syncedLyrics ? 'synced' : 'plain',
    plainLyrics: override.plainLyrics || '', syncedLyrics: override.syncedLyrics || '', matched: null, ms: 0,
    lines: lineCount(override.syncedLyrics || override.plainLyrics || ''),
    preview: previewLines(override.syncedLyrics || override.plainLyrics || ''), reason: null,
  } : null;

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
    // One lookup answers it all: memory, then the database, then the provider — with the matched
    // record and the song's other records coming back together.
    const bundle = await lookupBundle({ song, title, artist, album, duration, exclude, skipCache: force || reload, skipMemory: force });
    if (bundle.result) return json({ ...bundle.result, cached: Boolean(bundle.cached) });
    if (bundle.reason === 'provider-error') throw (bundle.failure || new ProviderFailure('Lyrics provider is busy.', 2));
    return json({
      lyrics: '', plainLyrics: '', syncedLyrics: '', source: 'none', reason: bundle.reason,
      message: MESSAGES[bundle.reason] || 'No lyrics for this song.', tried: bundle.attempts,
      retryable: false, cached: Boolean(bundle.cached),
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
