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

let lyricQueue = Promise.resolve();
const cooldowns = new Map();
async function fetchJson(url, options = {}) {
  const isLrc = new URL(url).origin === new URL(getLyricsApiBase()).origin;
  if (!isLrc) return fetchJsonNow(url, options);
  const work = lyricQueue.catch(() => {}).then(async () => {
    const origin = new URL(url).origin;
    if ((cooldowns.get(origin) || 0) > Date.now()) return null;
    if (options.deadline && Date.now() >= options.deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 220));
    return fetchJsonNow(url, options);
  });
  lyricQueue = work.catch(() => null);
  return work;
}
async function fetchJsonNow(url, options = {}) {
  const { timeout = 10000, deadline, ...rest } = options;
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(Math.max(1, Math.min(timeout, deadline ? deadline - Date.now() : timeout))),
    ...rest,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'JaSH-ViBeS/11.0 (https://github.com/Jash-k/jashvibes)',
      ...(rest.headers || {}),
    },
  });
  if (response.status === 429 || response.status === 503) {
    const retry = response.headers.get('retry-after');
    const until = /^\d+$/.test(retry || '') ? Date.now() + Number(retry) * 1000 : Date.parse(retry || '');
    cooldowns.set(new URL(url).origin, Number.isFinite(until) ? until : Date.now() + 30000);
    return null;
  }
  if (!response.ok) return null;
  return response.json().catch(() => null);
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

  for (const url of candidates) {
    const payload = await fetchJson(url, { timeout: Math.max(1, Math.floor(timeout / candidates.length)) }).catch(() => null);
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
  const key = JSON.stringify([ctx.title, ctx.artist, ctx.album, ctx.duration, ctx.exclude]);
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
  const lookup = async (path, params) => {
    if (Date.now() >= deadline) return null;
    const url = new URL(path, base + '/');
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, String(value));
    const payload = await fetchJson(url.toString(), { timeout: 3000, deadline }).catch(() => null);
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
  if (wanted.album && Date.now() < deadline) return lookup('/api/search', { track_name: wanted.title });
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
      reason: error.message || 'Lookup failed',
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
      reason: autoWinner ? null : 'Neither wired source returned lyrics for this track.',
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
    const lrclibResult = await lookupLrclibLyrics({ title, artist, album, duration, exclude, force, timeout: 7000 });
    if (lrclibResult?.lyrics) return NextResponse.json(lrclibResult, { headers: { 'Cache-Control': 'no-store' } });
    // Track-ID-bound plain lyrics from an explicitly configured provider only.
    const saavnResult = searchParams.get('skipSaavn') === '1' ? null : await lookupSaavnLyrics(id, { timeout: 2500 });
    if (saavnResult?.lyrics) return NextResponse.json({ ...saavnResult, matchVersion: LYRICS_MATCH_VERSION }, { headers: { 'Cache-Control': 'no-store' } });

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
    console.error('[api/music/lyrics] Error:', error);
    return NextResponse.json(
      {
        lyrics: '',
        plainLyrics: '',
        syncedLyrics: '',
        source: 'error',
        message: error.message || 'Lyrics lookup failed',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
