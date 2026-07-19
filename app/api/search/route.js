import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import { fetchTMDB, mapTMDBMovie, mapTMDBSeries } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TAMILMV_COLLECTION = 'tamilmv_scrapes';

// Helpful Tamil exact-title boosts. TMDB's normal popularity search can bury
// older Tamil films with generic English titles such as “Citizen”.
const TAMIL_EXACT_MOVIE_OVERRIDES = {
  citizen: 69399,
};

function normalizeType(type) {
  return type === 'tv' ? 'series' : type;
}

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseYearFromQuery(query = '') {
  return String(query).match(/\b(19\d{2}|20\d{2})\b/)?.[1] || '';
}

function parseTMDBDirectTarget(query = '') {
  const raw = String(query || '').trim();
  const urlMatch = raw.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (urlMatch) {
    return {
      mediaType: urlMatch[1].toLowerCase() === 'tv' ? 'tv' : 'movie',
      id: Number(urlMatch[2]),
    };
  }

  const typedMatch = raw.match(/^(movie|tv|series)\s*[:#-]?\s*(\d+)$/i);
  if (typedMatch) {
    return {
      mediaType: typedMatch[1].toLowerCase() === 'movie' ? 'movie' : 'tv',
      id: Number(typedMatch[2]),
    };
  }

  return null;
}

function mapTMDBItem(item, mediaType) {
  const mapped = mediaType === 'tv' ? mapTMDBSeries(item) : mapTMDBMovie(item);
  return {
    ...mapped,
    type: normalizeType(mediaType),
    mediaType,
    source: 'tmdb',
  };
}

function scoreTMDBItem(item, query) {
  const normalizedQuery = normalizeText(query).replace(/\b(19\d{2}|20\d{2})\b/g, '').trim();
  const queryYear = parseYearFromQuery(query);
  const title = normalizeText(item.title || '');
  const originalTitle = normalizeText(item.originalTitle || '');
  const releaseYear = String(item.releaseDate || '').slice(0, 4);

  let score = 0;

  if (title === normalizedQuery || originalTitle === normalizedQuery) score += 260;
  else if (title.startsWith(normalizedQuery) || originalTitle.startsWith(normalizedQuery)) score += 160;
  else if (title.includes(normalizedQuery) || originalTitle.includes(normalizedQuery)) score += 100;

  if (queryYear && releaseYear === queryYear) score += 90;
  if (item.language === 'ta') score += 85;
  if (item.posterUrl) score += 18;
  if (item.type === 'movie') score += 8;
  score += Math.min(Number(item.rating || 0), 10);

  // Keep TMDB popularity order as a weak tie-breaker by preserving array order elsewhere.
  return score;
}

function dedupeAndRank(items, query) {
  const byKey = new Map();

  for (const item of items) {
    if (!item?.tmdbId || !item?.title) continue;
    const key = `${item.type}-${item.tmdbId}`;
    const scored = { ...item, searchScore: scoreTMDBItem(item, query) };
    const existing = byKey.get(key);
    if (!existing || scored.searchScore > existing.searchScore) byKey.set(key, scored);
  }

  return [...byKey.values()]
    .sort((a, b) => b.searchScore - a.searchScore)
    .slice(0, 12);
}

function scoreLocalItem(item, query) {
  const q = normalizeText(query);
  const title = normalizeText(item.title || '');
  const originalTitle = normalizeText(item.originalTitle || '');
  const scrapedTitle = normalizeText(item.scrapedTitle || item.rawTitle || '');
  const text = `${title} ${originalTitle} ${scrapedTitle}`.trim();

  if (!q || !text) return 0;
  if (title === q || originalTitle === q) return 300;
  if (title.startsWith(q) || originalTitle.startsWith(q)) return 220;
  if (title.includes(q) || originalTitle.includes(q)) return 170;
  if (scrapedTitle.includes(q)) return 120;

  const tokens = q.split(' ').filter((token) => token.length > 1);
  if (!tokens.length) return text.includes(q) ? 50 : 0;

  const hits = tokens.filter((token) => text.includes(token)).length;
  return hits ? Math.round((hits / tokens.length) * 80) : 0;
}

async function searchLocalTamilMVCache(query) {
  try {
    const mongoose = await dbConnect();
    const doc = await mongoose.connection.db.collection(TAMILMV_COLLECTION).findOne({ key: 'latest' });
    const items = [...(doc?.movies || []), ...(doc?.series || [])];

    return items
      .map((item) => ({ item, score: scoreLocalItem(item, query) }))
      .filter((entry) => entry.score > 0 && entry.item?.tmdbId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(({ item }) => ({
        id: item.id || `tamilmv-${item.type}-${item.tmdbId}`,
        tmdbId: item.tmdbId,
        type: item.type === 'tv' ? 'series' : item.type || 'movie',
        title: item.title || item.originalTitle || 'Untitled',
        originalTitle: item.originalTitle || '',
        synopsis: item.synopsis || '',
        posterUrl: item.posterUrl || '',
        backdropUrl: item.backdropUrl || '',
        releaseDate: item.releaseDate || '',
        rating: item.rating || 0,
        language: item.language || item.category || '',
        source: 'tamilmv-cache-fallback',
      }));
  } catch (error) {
    console.warn('[api/search] Local fallback failed:', error.message);
    return [];
  }
}

async function fetchDirectTMDBItem(mediaType, id) {
  const details = await fetchTMDB(mediaType === 'tv' ? `/tv/${id}` : `/movie/${id}`, {
    language: 'en-IN',
  });
  return mapTMDBItem(details, mediaType);
}

async function fetchSearchPages(path, params, mediaType, pages = 3) {
  const requests = [];
  for (let page = 1; page <= pages; page += 1) {
    requests.push(
      fetchTMDB(path, { ...params, page })
        .then((payload) => (payload.results || []).map((item) => mapTMDBItem(item, mediaType)))
        .catch(() => []),
    );
  }

  const pagesData = await Promise.all(requests);
  return pagesData.flat();
}

async function searchTMDB(query) {
  const direct = parseTMDBDirectTarget(query);
  if (direct?.id) {
    return [await fetchDirectTMDBItem(direct.mediaType, direct.id)];
  }

  const normalizedQuery = normalizeText(query).replace(/\b(19\d{2}|20\d{2})\b/g, '').trim();
  const queryYear = parseYearFromQuery(query);
  const all = [];

  const overrideId = TAMIL_EXACT_MOVIE_OVERRIDES[normalizedQuery];
  if (overrideId) {
    try {
      all.push(await fetchDirectTMDBItem('movie', overrideId));
    } catch {}
  }

  const common = {
    query,
    include_adult: 'false',
    language: 'en-IN',
  };

  // Search movies/TV directly across multiple pages so older Tamil titles with
  // generic names are not hidden behind popular international results.
  const [movies, tv] = await Promise.all([
    fetchSearchPages('/search/movie', {
      ...common,
      ...(queryYear ? { year: queryYear } : {}),
    }, 'movie', 5),
    fetchSearchPages('/search/tv', {
      ...common,
      ...(queryYear ? { first_air_date_year: queryYear } : {}),
    }, 'tv', 3),
  ]);

  all.push(...movies, ...tv);
  return dedupeAndRank(all, query);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = String(searchParams.get('q') || '').trim();

  if (!query) {
    return NextResponse.json({ results: [], items: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const results = await searchTMDB(query);
    return NextResponse.json(
      { results, items: results, source: 'tmdb' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('[api/search] TMDB search failed:', error.message);

    const fallbackResults = await searchLocalTamilMVCache(query);
    return NextResponse.json(
      {
        results: fallbackResults,
        items: fallbackResults,
        source: fallbackResults.length ? 'tamilmv-cache-fallback' : 'none',
        warning: error.message || 'TMDB search failed',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  }
}
