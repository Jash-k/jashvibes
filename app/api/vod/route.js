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
    // `undated=1` is the Decade Room's "no year" tab. Titles the scraper never matched to TMDB have
    // no year at all, and a plain year window would drop them out of the archive entirely.
    const undated = searchParams.get('undated') === '1';

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

    // Everything except the year window. The ruler counts per decade against *this*, so switching
    // decades shows real numbers for the other decades instead of zeroing out the one you left.
    const shelfFilter = {};
    if (q) shelfFilter.$text = { $search: q };
    if (source && source !== 'all') shelfFilter.sources = source;
    if (genre && genre !== 'all') shelfFilter.genres = genre;
    if (Number.isFinite(minRating) && minRating > 0) shelfFilter.rating = { $gte: minRating };

    const filter = { ...shelfFilter };
    if (undated) {
      filter.year = { $in: [null, 0] };
    } else {
      if (Number.isFinite(yearFrom) && yearFrom > 0) filter.year = { ...(filter.year || {}), $gte: yearFrom };
      if (Number.isFinite(yearTo) && yearTo > 0) filter.year = { ...(filter.year || {}), $lte: yearTo };
    }

    const total = await VodItem.countDocuments(filter);
    const docs = await VodItem.find(filter)
      .sort(q ? { score: { $meta: 'textScore' }, ...buildSort(sort) } : buildSort(sort))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    // One pass for the decade histogram (over `shelfFilter`, so it is window-independent) alongside
    // the facet lists. The collection is a few hundred documents, so this is not a second scan cost
    // worth a cache; the page asks for it on the same request it already makes.
    const [facets, yearRows] = await Promise.all([
      VodItem.aggregate([
      { $group: {
        _id: null,
        minYear: { $min: '$year' },
        maxYear: { $max: '$year' },
        sources: { $addToSet: '$sources' },
        genres: { $addToSet: '$genres' },
      } },
      ]),
      VodItem.aggregate([
        { $match: shelfFilter },
        { $group: { _id: '$year', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
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
      undated: Boolean(undated),
      // The whole shelf, filtered or not: the page uses these two to prove that decade buckets plus the
      // no-year bucket add up to what the same query counted.
      archiveTotal: totalDbCount,
      filteredTotal: total,
      facets: {
        sources: flatSources,
        genres: flatGenres,
        minYear: facets[0]?.minYear || null,
        maxYear: facets[0]?.maxYear || null,
        years: (yearRows || [])
          .map((row) => ({ year: Number.isFinite(row?._id) ? row._id : null, count: Number(row?.count) || 0 }))
          .filter((row) => row.count > 0),
      },
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('[api/vod] Error:', error);
    return NextResponse.json({ error: error.message || 'Unable to load Tamil Classics', items: [] }, { status: 500 });
  }
}
