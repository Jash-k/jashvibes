import { chooseLyricMatch, lyricTitle, lyricAlbum, lyricRequestMetadata, LYRICS_MATCH_VERSION } from '@/lib/lyricsMatch';
import { NextResponse } from 'next/server';
import { SOURCE_GROUPS, WIRED_SOURCE_KIND, groupedSources, isPickable, sourceById } from '@/lib/musicSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSaavnApiBase() {
  return (process.env.SAAVN || process.env.SAAVN_API || '').replace(/\/+$/, '');
}

function getLyricsApiBase() {
  return (process.env.LYRICS_API || process.env.LRCLIB || 'https://lrclib.net').replace(/\/+$/, '');
}

function normalize(value = '') {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\([^)]*(?:from|feat|remix|version|sped|slowed)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function comparable(value = '') {
  return normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripSyncedLyrics(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

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
  if (origin !== new URL(getLyricsApiBase()).origin) return fetchJsonNow(url, options);
  if (queued >= 8) throw new ProviderFailure('Lyrics queue is busy.', 3);
  const deadline = options.deadline || Date.now() + 7000;
  let expired = false, timer;
  queued++;
  const work = lyricQueue.catch(() => {}).then(async () => {
    // Expired entries do not consume a throttle slot or make a late provider request.
    if (expired || Date.now() >= deadline) throw new ProviderFailure('Lyrics queue timed out.', 2);
    const blocked = cooldownError(origin); if (blocked) throw blocked;
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
  const { timeout = 10000, deadline, ...rest } = options;
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, deadline ? deadline - Date.now() : timeout))),
      ...rest,
      headers: { Accept: 'application/json',
        'User-Agent': 'JaSH-ViBeS/11.0 (https://github.com/Jash-k/jashvibes)', ...(rest.headers || {}) },
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

function extractSaavnLyrics(payload) {
  const data = payload?.data || payload;
  return data?.lyrics || data?.text || '';
}

async function lookupSaavnLyrics(id = '', { timeout = 10000 } = {}) {
  if (!id) return null;
  const base = getSaavnApiBase();
  if (!base) return null;
  const candidates = [
    `${base}/api/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/api/lyrics?id=${encodeURIComponent(id)}`,
  ];

  let failure;
  for (const url of candidates) {
    let payload;
    try { payload = await fetchJson(url, { timeout: Math.max(1, Math.floor(timeout / candidates.length)) }); }
    catch (error) { failure = error; continue; }
    const plainLyrics = extractSaavnLyrics(payload);
    if (plainLyrics) {
      return {
        lyrics: plainLyrics,
        plainLyrics,
        syncedLyrics: '',
        source: 'saavn',
        sourceUrl: url,
        matched: null,
      };
    }
  }
  if (failure) throw failure;
  return null;
}

function scoreLrclibResult(item = {}, wanted = {}) {
  const title = comparable(item.trackName || item.name || '');
  const artist = comparable(item.artistName || '');
  const album = comparable(item.albumName || '');
  const wantedTitle = comparable(wanted.title || '');
  const wantedArtist = comparable(wanted.artist || '');
  const wantedAlbum = comparable(wanted.album || '');
  let score = 0;

  if (title && wantedTitle) {
    if (title === wantedTitle) score += 120;
    else if (title.includes(wantedTitle) || wantedTitle.includes(title)) score += 70;
    else {
      const tokens = wantedTitle.split(' ').filter((token) => token.length > 1);
      const hits = tokens.filter((token) => title.includes(token)).length;
      score += Math.round((hits / Math.max(tokens.length, 1)) * 50);
    }
  }

  if (artist && wantedArtist) {
    const artistTokens = wantedArtist.split(' ').filter((token) => token.length > 1);
    const hits = artistTokens.filter((token) => artist.includes(token)).length;
    if (artist === wantedArtist) score += 70;
    else score += Math.round((hits / Math.max(artistTokens.length, 1)) * 55);
  }

  if (album && wantedAlbum) {
    if (album === wantedAlbum) score += 25;
    else if (album.includes(wantedAlbum) || wantedAlbum.includes(album)) score += 12;
  }

  const wantedDuration = Number(wanted.duration || 0);
  const itemDuration = Number(item.duration || 0);
  if (wantedDuration > 0 && itemDuration > 0) {
    const diff = Math.abs(wantedDuration - itemDuration);
    if (diff <= 2) score += 30;
    else if (diff <= 6) score += 18;
    else if (diff <= 12) score += 6;
    else score -= Math.min(30, diff);
  }

  if (item.syncedLyrics) score += 12;
  if (item.plainLyrics) score += 8;
  if (item.instrumental) score -= 80;
  return score;
}

function mapLrclibItem(item = {}, sourceUrl = '', wanted = {}) {
  const plainLyrics = item.plainLyrics || stripSyncedLyrics(item.syncedLyrics || '');
  const syncedLyrics = item.syncedLyrics || '';
  return {
    lyrics: plainLyrics || syncedLyrics || '',
    plainLyrics,
    syncedLyrics,
    instrumental: Boolean(item.instrumental),
    source: 'lrclib',
    sourceUrl,
    matched: {
      id: item.id,
      trackName: item.trackName || item.name || '',
      artistName: item.artistName || '',
      albumName: item.albumName || '',
      duration: item.duration || 0,
      score: scoreLrclibResult(item, wanted),
    },
  };
}

const lyricCache = new Map(), lyricPending = new Map();
async function lookupLrclibLyrics(ctx = {}) {
  const metadata = lyricRequestMetadata({ title: ctx.title, artists: ctx.artist, album: ctx.album, duration: ctx.duration });
  const key = JSON.stringify([LYRICS_MATCH_VERSION, lyricTitle(metadata.title), metadata.artist, metadata.album, metadata.duration, ctx.exclude]);
  if (!ctx.force && lyricCache.get(key)?.expires > Date.now()) return lyricCache.get(key).value;
  if (lyricPending.has(key)) return lyricPending.get(key);
  const job = lookupLrclibUncached(ctx).then((value) => {
    if (lyricCache.size >= 300) lyricCache.delete(lyricCache.keys().next().value);
    lyricCache.set(key, { value, expires: Date.now() + (value ? 3600000 : 60000) });
    return value;
  }).finally(() => lyricPending.delete(key));
  lyricPending.set(key, job); return job;
}
async function lookupLrclibUncached({ title = '', artist = '', album = '', duration = 0, timeout = 7000, exclude = '', force = false } = {}) {
  const metadata = lyricRequestMetadata({ title, artists: artist, album, duration });
  const wanted = { title: lyricTitle(metadata.title), artist: normalize(metadata.artist), album: metadata.album, duration: metadata.duration };
  if (!wanted.title || !wanted.artist) return null;
  const blocked = new Set(String(exclude).split(',').filter(Boolean));
  const deadline = Date.now() + Math.min(timeout, 7000);
  const base = getLyricsApiBase();
  let failure;
  const lookup = async (path, params) => {
    if (Date.now() >= deadline) { failure = new ProviderFailure('Lyrics lookup timed out.', 2); return null; }
    const url = new URL(path, base + '/');
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
    let payload;
    try {
      payload = await fetchJson(url.toString(), { timeout: 3000, deadline });
      if (payload !== null && (path === '/api/search' ? !Array.isArray(payload) : typeof payload !== 'object' || !payload.id))
        throw new ProviderFailure('Lyrics provider returned an invalid result.', 2);
    } catch (error) { failure = error; return null; }
    const items = (Array.isArray(payload) ? payload : payload ? [payload] : []).filter((item) => !blocked.has(String(item.id)));
    const match = chooseLyricMatch(items, wanted);
    return match ? { ...mapLrclibItem(match, url.toString(), wanted), matchVersion: LYRICS_MATCH_VERSION } : null;
  };
  const signature = { track_name: wanted.title, artist_name: wanted.artist, album_name: wanted.album, duration: wanted.duration > 0 && wanted.duration <= 3600 ? Math.round(wanted.duration) : '' };
  const exact = await lookup('/api/get', signature);
  if (exact) return exact;
  // A title search broadens retrieval, never acceptance: album/artist/duration guards remain mandatory.
  const specific = await lookup('/api/search', { track_name: wanted.title, album_name: wanted.album });
  if (specific) return specific;
  // Album punctuation/catalogue variants can prevent retrieval even when identity matches.
  // Broaden retrieval only; chooseLyricMatch still enforces title, album, artist and duration guards.
  if (wanted.album) {
    const broad = await lookup('/api/search', { track_name: wanted.title });
    if (broad) return broad;
  }
  // Never negative-cache an incomplete lookup, even if another stage returned 404.
  if (failure) throw failure;
  return null;
}

/* LRCLIB's score is unbounded-ish (title 120 + artist 70 + album 25 + duration 30 +
   synced 12 + plain 8). Normalise it to a display percentage so the picker can show
   one honest number instead of a raw score nobody can read. */
const MAX_LRCLIB_SCORE = 265;

function scorePercent(score = 0) {
  return Math.max(0, Math.min(99, Math.round((Number(score) || 0) / MAX_LRCLIB_SCORE * 100)));
}

/**
 * The first few real lines of a result, so "choose your source" can show what the
 * user is about to apply instead of a name and a promise. Timestamps are stripped:
 * this is for reading, not for playing.
 */
function previewLines(text = '', limit = 3) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function lineCount(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim())
    .filter(Boolean).length;
}

/** Run one wired source and normalise it into a comparable shape. Never throws. */
async function runSource(sourceId, ctx) {
  const started = Date.now();
  try {
    if (sourceId === 'saavn') {
      const result = await lookupSaavnLyrics(ctx.id, { timeout: ctx.timeout });
      const text = result?.plainLyrics || result?.lyrics || '';
      return {
        id: 'saavn', ok: Boolean(text), kind: text ? 'plain' : 'none',
        plainLyrics: text, syncedLyrics: '', matched: null, ms: Date.now() - started,
        lines: lineCount(text), preview: previewLines(text),
        reason: text ? null : 'No lyrics returned for this song id.',
      };
    }
    if (sourceId === 'lrclib') {
      const result = await lookupLrclibLyrics({ ...ctx, timeout: ctx.timeout });
      const text = result?.syncedLyrics || result?.plainLyrics || '';
      return {
        id: 'lrclib', ok: Boolean(text),
        kind: text ? (result.syncedLyrics ? 'synced' : 'plain') : 'none',
        plainLyrics: result?.plainLyrics || '', syncedLyrics: result?.syncedLyrics || '',
        matched: result?.matched || null, ms: Date.now() - started,
        lines: lineCount(text), preview: previewLines(text),
        match: result?.matched ? scorePercent(result.matched.score) : null,
        reason: text ? null : 'Nothing above the match threshold for this title and artist.',
      };
    }
  } catch (error) {
    return {
      id: sourceId, ok: false, kind: 'none', plainLyrics: '', syncedLyrics: '',
      matched: null, ms: Date.now() - started, lines: 0, preview: [],
      reason: error.message || 'Lookup failed', retryable: error.retryable !== false, retryAfter: error.retryAfter || 2,
    };
  }
  return {
    id: sourceId, ok: false, kind: 'none', plainLyrics: '', syncedLyrics: '',
    matched: null, ms: 0, lines: 0, preview: [], reason: 'Not a wired source.',
  };
}

/**
 * GET /api/music/lyrics
 *   (default)        → strict LRCLIB metadata match, then configured track-ID plain fallback
 *   ...&list=1       → every wired source, tried in parallel, with a real preview of
 *                      what each one returned. This is what "choose your source" reads.
 *   ...&source=lrclib → force one source, so the picker's choice actually applies.
 *
 * All lookup paths apply the same conservative identity checks.
 */
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

  /* ── catalogue only: the list of sources, no provider is touched ─────────
     The picker's "not wired" rows and the settings panel need the catalogue and
     nothing else. Without this guard those two screens each fired the full
     parallel lookup (two providers, 7s timeout apiece) to render static text. */
  if (wantsList && searchParams.get('catalogue') === '1' && !title && !id) {
    return NextResponse.json(
      { catalogue: groupedSources(), groups: SOURCE_GROUPS },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /* ── the picker: every wired source, in parallel, with its real output ───── */
  if (wantsList) {
    const ctx = { id, title, artist, album, duration, exclude, force, timeout: 7000 };
    const [saavn, lrclib] = await Promise.all([
      runSource('saavn', ctx),
      runSource('lrclib', ctx),
    ]);
    const byId = { saavn, lrclib };
    // "Auto" is not a third lookup — it is whichever wired source the cascade would
    // pick, which is exactly what the default path returns.
    const autoWinner = ['lrclib', 'saavn'].find((key) => byId[key]?.ok) || null;
    const auto = {
      id: 'auto', ok: Boolean(autoWinner), kind: autoWinner ? byId[autoWinner].kind : 'none',
      plainLyrics: autoWinner ? byId[autoWinner].plainLyrics : '',
      syncedLyrics: autoWinner ? byId[autoWinner].syncedLyrics : '',
      matched: autoWinner ? byId[autoWinner].matched : null,
      ms: autoWinner ? byId[autoWinner].ms : 0,
      lines: autoWinner ? byId[autoWinner].lines : 0,
      preview: autoWinner ? byId[autoWinner].preview : [],
      match: autoWinner && byId[autoWinner].match != null ? byId[autoWinner].match : null,
      winner: autoWinner,
      reason: autoWinner ? null : [saavn, lrclib].find(result => result.retryable)?.reason || 'Neither wired source returned lyrics for this track.',
      retryable: !autoWinner && [saavn, lrclib].some(result => result.retryable),
      retryAfter: Math.max(saavn.retryAfter || 0, lrclib.retryAfter || 0),
    };

    const catalogue = Object.fromEntries(
      groupedSources().flatMap((group) => group.items.map((item) => [item.id, item])),
    );

    const sources = [auto, byId.saavn, byId.lrclib].map((result) => {
      const meta = catalogue[result.id] || { id: result.id, name: result.id, mark: '?', kind: 'none' };
      return {
        id: result.id,
        name: meta.name,
        mark: meta.mark,
        pickable: true,
        kind: result.kind === 'auto' || result.kind === 'none' ? (result.kind === 'auto' ? 'auto' : 'none') : result.kind,
        // what APPLYING this source would do to the stage — a plain source has no timing
        applies: result.id === 'auto' ? (meta.kind === 'auto' ? (WIRED_SOURCE_KIND[auto.winner] || 'none') : 'none') : WIRED_SOURCE_KIND[result.id] || 'none',
        ok: result.ok,
        lines: result.lines,
        preview: result.preview,
        match: result.match ?? null,
        ms: result.ms,
        winner: result.winner || null,
        reason: result.reason,
        retryable: Boolean(result.retryable), retryAfter: result.retryAfter || 0,
        evidence: meta.evidence,
        note: meta.note,
        wired: true,
      };
    });

    return NextResponse.json(
      {
        sources,
        groups: SOURCE_GROUPS.map((group) => ({ id: group.id, label: group.label, badge: group.badge, tone: group.tone })),
        catalogue: groupedSources(),
        wanted: { id, title, artist, album, duration },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /* ── pinned source: what the picker's choice applies ────────────────────── */
  if (forced && forced !== 'auto') {
    if (forced === 'inst') {
      return NextResponse.json(
        { lyrics: '', plainLyrics: '', syncedLyrics: '', instrumental: true, source: 'inst', applied: 'none' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (!isPickable(forced) || !sourceById(forced)?.group) {
      return NextResponse.json(
        { lyrics: '', plainLyrics: '', syncedLyrics: '', source: forced, applied: 'none', message: 'That source is not wired in this app.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const result = await runSource(forced, { id, title, artist, album, duration, exclude, force, timeout: 7000 });
    if (!result.ok) {
      return NextResponse.json(
        {
          lyrics: '', plainLyrics: '', syncedLyrics: '', source: forced, applied: 'none',
          message: result.reason || 'That source had nothing for this track.',
          retryable: Boolean(result.retryable), retryAfter: result.retryAfter || 0,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      {
        lyrics: result.plainLyrics || result.syncedLyrics || '',
        plainLyrics: result.plainLyrics,
        syncedLyrics: result.syncedLyrics,
        instrumental: false,
        source: forced,
        applied: result.kind,          // 'synced' | 'plain' — the UI keys the highlight off this
        matched: result.matched,
        matchVersion: LYRICS_MATCH_VERSION,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    let failure;
    const lrclibResult = await lookupLrclibLyrics({ title, artist, album, duration, exclude, force, timeout: 7000 }).catch(error => { failure = error; return null; });
    if (lrclibResult?.lyrics) return NextResponse.json(lrclibResult, { headers: { 'Cache-Control': 'no-store' } });
    // Track-ID-bound plain lyrics from an explicitly configured provider only.
    const saavnResult = searchParams.get('skipSaavn') === '1' ? null : await lookupSaavnLyrics(id, { timeout: 2500 }).catch(error => { failure = failure || error; return null; });
    if (saavnResult?.lyrics) return NextResponse.json({ ...saavnResult, matchVersion: LYRICS_MATCH_VERSION }, { headers: { 'Cache-Control': 'no-store' } });

    if (failure) throw failure;
    return NextResponse.json(
      {
        lyrics: '',
        plainLyrics: '',
        syncedLyrics: '',
        source: 'none',
        message: title ? 'No confidently matched lyrics found for this track. We did not substitute another song.' : 'No song title/artist supplied for lyrics lookup.',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Provider outages are expected, retryable outcomes — not a missing song.
    return NextResponse.json(
      {
        lyrics: '',
        plainLyrics: '',
        syncedLyrics: '',
        source: 'error',
        message: error.message || 'Lyrics lookup failed',
        retryable: error.retryable !== false, retryAfter: error.retryAfter || 2,
      },
      { status: error.retryable === false ? 502 : 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(error.retryAfter || 2) } },
    );
  }
}
