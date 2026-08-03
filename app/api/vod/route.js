import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import VodItem, { ensureVodTextIndexSafe } from '@/models/VodItem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clamp(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function buildSort(sort = 'rating.desc') {
  switch (sort) {
    case 'rating.asc': return { rating: 1, voteCount: -1, year: -1 };
    case 'year.desc': return { year: -1, rating: -1 };
    case 'year.asc': return { year: 1, rating: -1 };
    case 'title.asc': return { title: 1 };
    case 'title.desc': return { title: -1 };
    case 'synced.desc': return { lastSyncedAt: -1 };
    case 'rating.desc':
    default:
      return { rating: -1, voteCount: -1, year: -1 };
  }
}

function publicItem(item) {
  return {
    id: String(item._id),
    title: item.title,
    type: item.type,
    tmdbId: item.tmdbId,
    tmdbMatched: item.tmdbMatched,
    originalTitle: item.originalTitle,
    year: item.year,
    releaseDate: item.releaseDate,
    synopsis: item.synopsis,
    posterUrl: item.posterUrl,
    backdropUrl: item.backdropUrl,
    rating: item.rating,
    voteCount: item.voteCount,
    language: item.language,
    genres: item.genres || [],
    sources: item.sources || [],
    streamsCount: item.streams?.length || 0,
    lastSyncedAt: item.lastSyncedAt,
  };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = clamp(searchParams.get('page'), 1, 1, 9999);
    const limit = clamp(searchParams.get('limit'), 24, 1, 60);
    const q = String(searchParams.get('q') || '').trim();
    const source = String(searchParams.get('source') || 'all').trim();
    const genre = String(searchParams.get('genre') || 'all').trim();
    const minRating = Number(searchParams.get('minRating') || 0);
    const yearFrom = Number(searchParams.get('yearFrom') || 0);
    const yearTo = Number(searchParams.get('yearTo') || 0);
    const sort = searchParams.get('sort') || 'rating.desc';

    await dbConnect();
    await ensureVodTextIndexSafe();
    const totalDbCount = await VodItem.countDocuments({});

    if (totalDbCount === 0) {
      return NextResponse.json({
        items: [],
        count: 0,
        total: 0,
        page,
        limit,
        hasMore: false,
        needsSync: true,
        message: 'No Tamil Classics synced yet. Run /api/vod/sync first.',
      });
    }

    const filter = {};
    if (q) filter.$text = { $search: q };
    if (source && source !== 'all') filter.sources = source;
    if (genre && genre !== 'all') filter.genres = genre;
    if (Number.isFinite(minRating) && minRating > 0) filter.rating = { ...(filter.rating || {}), $gte: minRating };
    if (Number.isFinite(yearFrom) && yearFrom > 0) filter.year = { ...(filter.year || {}), $gte: yearFrom };
    if (Number.isFinite(yearTo) && yearTo > 0) filter.year = { ...(filter.year || {}), $lte: yearTo };

    const total = await VodItem.countDocuments(filter);
    const docs = await VodItem.find(filter)
      .sort(q ? { score: { $meta: 'textScore' }, ...buildSort(sort) } : buildSort(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const facets = await VodItem.aggregate([
      { $group: {
        _id: null,
        minYear: { $min: '$year' },
        maxYear: { $max: '$year' },
        sources: { $addToSet: '$sources' },
        genres: { $addToSet: '$genres' },
      } },
    ]);

    const flatSources = [...new Set((facets[0]?.sources || []).flat().filter(Boolean))].sort();
    const flatGenres = [...new Set((facets[0]?.genres || []).flat().filter(Boolean))].sort();

    return NextResponse.json({
      items: docs.map(publicItem),
      count: docs.length,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      needsSync: false,
      facets: {
        sources: flatSources,
        genres: flatGenres,
        minYear: facets[0]?.minYear || null,
        maxYear: facets[0]?.maxYear || null,
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[api/vod] Error:', error);
    return NextResponse.json({ error: error.message || 'Unable to load Tamil Classics', items: [] }, { status: 500 });
  }
}
