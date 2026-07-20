import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSaavnApiBase() {
  return (process.env.SAAVN || process.env.SAAVN_API || 'https://saavnapi.onrender.com').replace(/\/+$/, '');
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'JaSH-ViBeS/1.0 (lyrics lookup; educational personal app)',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function extractSaavnLyrics(payload) {
  const data = payload?.data || payload;
  return data?.lyrics || data?.text || data?.snippet || data?.copyright_text || '';
}

async function lookupSaavnLyrics(id = '') {
  if (!id) return null;
  const base = getSaavnApiBase();
  const candidates = [
    `${base}/api/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/api/lyrics?id=${encodeURIComponent(id)}`,
  ];

  for (const url of candidates) {
    const payload = await fetchJson(url);
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

async function lookupLrclibLyrics({ title = '', artist = '', album = '', duration = 0 } = {}) {
  const cleanTitle = normalize(title);
  const cleanArtist = normalize(artist);
  const cleanAlbum = normalize(album);
  const cleanDuration = Math.round(Number(duration || 0));
  if (!cleanTitle || !cleanArtist) return null;

  const base = getLyricsApiBase();
  const wanted = { title: cleanTitle, artist: cleanArtist, album: cleanAlbum, duration: cleanDuration };

  // Try LRCLIB's exact endpoint first. It often returns synced lyrics directly.
  const exactUrl = new URL('/api/get', `${base}/`);
  exactUrl.searchParams.set('track_name', cleanTitle);
  exactUrl.searchParams.set('artist_name', cleanArtist);
  if (cleanAlbum) exactUrl.searchParams.set('album_name', cleanAlbum);
  if (cleanDuration) exactUrl.searchParams.set('duration', String(cleanDuration));
  const exact = await fetchJson(exactUrl.toString());
  if (exact?.plainLyrics || exact?.syncedLyrics) return mapLrclibItem(exact, exactUrl.toString(), wanted);

  const searchUrl = new URL('/api/search', `${base}/`);
  searchUrl.searchParams.set('track_name', cleanTitle);
  searchUrl.searchParams.set('artist_name', cleanArtist);
  if (cleanAlbum) searchUrl.searchParams.set('album_name', cleanAlbum);
  if (cleanDuration) searchUrl.searchParams.set('duration', String(cleanDuration));

  const results = await fetchJson(searchUrl.toString());
  if (Array.isArray(results) && results.length) {
    const best = results
      .filter((item) => item?.plainLyrics || item?.syncedLyrics)
      .map((item) => ({ item, score: scoreLrclibResult(item, wanted) }))
      .sort((a, b) => b.score - a.score)[0];

    if (best && best.score >= 55) return mapLrclibItem(best.item, searchUrl.toString(), wanted);
  }

  // Some Tamil old songs fail LRCLIB's structured artist search because Saavn
  // returns many artist/composer/actor names. MusicSync-style lookup works by
  // falling back to a broad title query, then scoring locally.
  const genericQueries = [
    cleanTitle,
    cleanTitle.replace(/\b\(.*?\)\b/g, '').trim(),
    cleanAlbum ? `${cleanTitle} ${cleanAlbum}` : '',
  ].filter(Boolean);

  for (const query of [...new Set(genericQueries)]) {
    const genericUrl = new URL('/api/search', `${base}/`);
    genericUrl.searchParams.set('q', query);
    const genericResults = await fetchJson(genericUrl.toString());
    if (!Array.isArray(genericResults) || !genericResults.length) continue;

    const best = genericResults
      .filter((item) => item?.plainLyrics || item?.syncedLyrics)
      .map((item) => ({ item, score: scoreLrclibResult(item, wanted) }))
      .sort((a, b) => b.score - a.score)[0];

    if (best && best.score >= 55) return mapLrclibItem(best.item, genericUrl.toString(), wanted);
  }

  return null;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get('id') || '').trim();
  const title = String(searchParams.get('title') || '').trim();
  const artist = String(searchParams.get('artist') || searchParams.get('artists') || '').trim();
  const album = String(searchParams.get('album') || '').trim();
  const duration = Number(searchParams.get('duration') || 0);

  try {
    const saavnResult = await lookupSaavnLyrics(id);
    if (saavnResult?.lyrics) {
      return NextResponse.json(saavnResult, { headers: { 'Cache-Control': 'no-store' } });
    }

    const lrclibResult = await lookupLrclibLyrics({ title, artist, album, duration });
    if (lrclibResult?.lyrics) {
      return NextResponse.json(lrclibResult, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json(
      {
        lyrics: '',
        plainLyrics: '',
        syncedLyrics: '',
        source: 'none',
        message: title ? 'No lyrics found for this track.' : 'No song title/artist supplied for lyrics lookup.',
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
