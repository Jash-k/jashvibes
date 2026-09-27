/**
 * GET /api/moviesda/match?tmdbId=&title=&year= — v10.6.0
 *
 * Background check the watch page fires after (not before) playback resolves:
 * "does the moviesda scraper data know this title?" Cheap: a cached index
 * lookup, zero upstream hops. Only the stable pageUrl + counts come back —
 * switching to the source resolves fresh links at click time.
 */
import { NextResponse } from 'next/server';
import { matchMoviesda } from '@/lib/moviesdaSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const type = String(params.get('type') || 'movie');
    // The scraper indexes movies only.
    if (type !== 'movie') return NextResponse.json({ match: null }, { headers: { 'Cache-Control': 'no-store' } });

    const match = await matchMoviesda({
      tmdbId: params.get('tmdbId'),
      title: params.get('title'),
      year: params.get('year'),
    });
    return NextResponse.json(
      {
        match: match
          ? {
              title: match.title,
              year: match.year,
              pageUrl: match.pageUrl,
              tmdbId: match.tmdbId || 0,
              mp4Count: match.mp4Count,
              embedCount: match.embedCount,
            }
          : null,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch {
    return NextResponse.json({ match: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
