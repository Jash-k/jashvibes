import { NextResponse } from 'next/server';
import { fetchTMDB, mapTMDBMovie, mapTMDBSeries } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Lightweight metadata endpoint used by the watch page to record Continue
 * Watching entries / My List favorites with a proper title and poster.
 *
 * GET /api/tmdb/meta?type=movie|series&tmdbId=597
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawType = String(searchParams.get('type') || 'movie').toLowerCase();
    const type = rawType === 'series' || rawType === 'tv' ? 'series' : 'movie';
    const tmdbId = Number(searchParams.get('tmdbId'));

    if (!tmdbId || Number.isNaN(tmdbId)) {
      return NextResponse.json({ error: 'A numeric tmdbId is required' }, { status: 400 });
    }

    const mediaType = type === 'series' ? 'tv' : 'movie';
    const data = await fetchTMDB(`/${mediaType}/${tmdbId}`);
    const mapped = type === 'series' ? mapTMDBSeries(data) : mapTMDBMovie(data);

    return NextResponse.json(
      {
        ok: true,
        ...mapped,
        year: String(mapped.releaseDate || '').slice(0, 4),
      },
      {
        headers: {
          // Metadata rarely changes; cache at the edge/browser for a day.
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
        },
      },
    );
  } catch (error) {
    console.error('[api/tmdb/meta] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Unable to load title metadata' },
      { status: 500 },
    );
  }
}
