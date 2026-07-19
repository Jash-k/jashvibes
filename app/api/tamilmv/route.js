import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import { scrapeTamilMV } from '@/lib/tamilmvScraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTION_NAME = 'tamilmv_scrapes';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_LIMIT = 15;
// Keep the first request light. Lazy loading expands the cache page-by-page up
// to this maximum instead of forcing a large scrape before anything appears.
const DEFAULT_MAX_CACHE_LIMIT = 90;

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function getMaxCacheLimit() {
  return clampNumber(process.env.TAMILMV_CACHE_LIMIT, DEFAULT_MAX_CACHE_LIMIT, DEFAULT_PAGE_LIMIT, 300);
}

function isAuthorized(request) {
  const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-scrape-token') || '';
  const expected = process.env.SCRAPE || process.env.SCRAPE_TOKEN || '';

  // Only SCRAPE_TOKEN protects forced refresh. SEED_TOKEN is intentionally not used here,
  // because many deployments already have SEED_TOKEN for old seed routes and the user
  // may still want TamilMV refresh to work without a separate scrape token.
  if (!expected) return true;
  return token && token === expected;
}

function emptyPayload(extra = {}) {
  return {
    updatedAt: null,
    source: process.env.TAMILMV || process.env.TAMILMV_BASE_URL || 'https://www.1tamilmv.report/',
    count: 0,
    movies: [],
    series: [],
    tvshows: [],
    pagination: {
      page: 1,
      limit: DEFAULT_PAGE_LIMIT,
      movies: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, hasMore: false },
      series: { page: 1, limit: DEFAULT_PAGE_LIMIT, total: 0, hasMore: false },
    },
    ...extra,
  };
}

async function getCollection() {
  const mongoose = await dbConnect();
  return mongoose.connection.db.collection(COLLECTION_NAME);
}

async function getCachedScrape() {
  const collection = await getCollection();
  return collection.findOne({ key: 'latest' });
}

async function saveScrape(payload) {
  const collection = await getCollection();
  await collection.updateOne(
    { key: 'latest' },
    {
      $set: {
        key: 'latest',
        ...payload,
        refreshedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

function isFresh(doc) {
  if (!doc?.refreshedAt) return false;
  return Date.now() - new Date(doc.refreshedAt).getTime() < ONE_DAY_MS;
}

function getRequestPaging(searchParams) {
  const limit = clampNumber(searchParams.get('limit'), DEFAULT_PAGE_LIMIT, 1, 48);
  const page = clampNumber(searchParams.get('page'), 1, 1, 999);
  const groupValue = String(searchParams.get('group') || 'all').toLowerCase();
  const group = ['movies', 'series', 'all'].includes(groupValue) ? groupValue : 'all';
  return { page, limit, group, start: (page - 1) * limit, end: page * limit };
}

function groupNeedsMore(cached, group, end, maxCacheLimit) {
  if (!cached) return true;
  const needs = (items = []) => items.length < end && items.length < maxCacheLimit;
  if (group === 'movies') return needs(cached.movies || []);
  if (group === 'series') return needs(cached.series || []);
  return needs(cached.movies || []) || needs(cached.series || []);
}

function paginateList(items = [], paging) {
  return items.slice(paging.start, paging.end);
}

function pageInfo(items = [], paging, cacheLimit = 0, maxCacheLimit = DEFAULT_MAX_CACHE_LIMIT) {
  const canExpandCache = items.length > 0 && items.length >= cacheLimit && cacheLimit < maxCacheLimit && paging.end >= items.length;
  return {
    page: paging.page,
    limit: paging.limit,
    total: items.length,
    returned: Math.max(0, Math.min(paging.limit, items.length - paging.start)),
    // If the user reached the current cache edge and we have not reached the
    // max cache limit, allow one more lazy request to expand the cache.
    hasMore: paging.end < items.length || canExpandCache,
  };
}

function paginatePayload(payload, paging, maxCacheLimit = DEFAULT_MAX_CACHE_LIMIT) {
  const allMovies = payload?.movies || [];
  const allSeries = payload?.series || [];
  const movies = paging.group === 'series' ? [] : paginateList(allMovies, paging);
  const series = paging.group === 'movies' ? [] : paginateList(allSeries, paging);

  const cacheLimit = payload?.cacheLimit || payload?.limitPerType || 0;

  return {
    ...payload,
    movies,
    series,
    tvshows: [],
    items: [...movies, ...series],
    count: movies.length + series.length,
    totalCached: allMovies.length + allSeries.length,
    cacheLimit,
    pagination: {
      page: paging.page,
      limit: paging.limit,
      group: paging.group,
      movies: pageInfo(allMovies, paging, cacheLimit, maxCacheLimit),
      series: pageInfo(allSeries, paging, cacheLimit, maxCacheLimit),
    },
  };
}

async function scrapeAndCache({ withPosters, matchTMDB, cacheLimit }) {
  const payload = await scrapeTamilMV({
    fetchPostersEnabled: withPosters,
    maxPosterFetches: Number(process.env.TAMILMV_POSTERS || process.env.TAMILMV_MAX_POSTER_FETCHES || 6),
    limitPerType: cacheLimit,
    matchTMDB,
    includeTvShows: false,
  });

  const cachePayload = {
    ...payload,
    tvshows: [],
    items: [...(payload.movies || []), ...(payload.series || [])],
    count: (payload.movies || []).length + (payload.series || []).length,
    cacheLimit,
  };

  if (cachePayload.count > 0) {
    await saveScrape(cachePayload);
  }

  return cachePayload;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const paging = getRequestPaging(searchParams);
  const force = searchParams.get('force') === '1' || searchParams.get('refresh') === '1';
  const withPosters = searchParams.get('posters') === '1';
  const matchTMDB = searchParams.get('tmdb') !== '0';
  const maxCacheLimit = getMaxCacheLimit();
  const requestedCacheLimit = Math.min(maxCacheLimit, Math.max(DEFAULT_PAGE_LIMIT, paging.end));

  try {
    let cached = await getCachedScrape();
    const cachedItems = [...(cached?.movies || []), ...(cached?.series || [])];
    const cachedIsEmpty = cached && (!cached.count || cachedItems.length === 0);
    const cachedMissingTopReleaseMetadata = cached && cachedItems.some((item) => item.isTopRelease === undefined || item.section === undefined);
    const needsRequestedPage = cached && groupNeedsMore(cached, paging.group, paging.end, maxCacheLimit);

    if (cached && isFresh(cached) && !force && !cachedIsEmpty && !cachedMissingTopReleaseMetadata && !needsRequestedPage) {
      return NextResponse.json(
        {
          ...paginatePayload(cached, paging, maxCacheLimit),
          cached: true,
          from: 'mongodb-cache',
        },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    if (force && !isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized refresh token' }, { status: 401 });
    }

    const payload = await scrapeAndCache({ withPosters, matchTMDB, cacheLimit: requestedCacheLimit });
    cached = payload.count > 0 ? await getCachedScrape() : null;

    return NextResponse.json(
      {
        ...paginatePayload(cached || payload, paging, maxCacheLimit),
        cached: false,
        from: 'live-scrape',
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('[api/tamilmv] Error:', error);

    try {
      const cached = await getCachedScrape();
      if (cached) {
        return NextResponse.json(
          {
            ...paginatePayload(cached, paging, maxCacheLimit),
            cached: true,
            from: 'stale-mongodb-cache',
            warning: error.message || 'Live scrape failed; showing cached data.',
          },
          { headers: { 'Cache-Control': 'no-store, max-age=0' } }
        );
      }
    } catch {}

    return NextResponse.json(
      emptyPayload({ error: error.message || 'TamilMV scrape failed' }),
      { status: 500 }
    );
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized refresh token' }, { status: 401 });
  }

  try {
    const cacheLimit = getMaxCacheLimit();
    const payload = await scrapeAndCache({ withPosters: true, matchTMDB: true, cacheLimit });

    return NextResponse.json({ ...payload, saved: payload.count > 0 });
  } catch (error) {
    console.error('[api/tamilmv] POST Error:', error);
    return NextResponse.json(
      { error: error.message || 'TamilMV scrape failed' },
      { status: 500 }
    );
  }
}
