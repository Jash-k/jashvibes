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
import { searchMoviesdaMovie } from '@/lib/moviesda/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const params = new URL(request.url).searchParams;
    const type = String(params.get('type') || 'movie');
    // The scraper indexes movies only.
    if (type !== 'movie') return NextResponse.json({ match: null }, { headers: { 'Cache-Control': 'no-store' } });

    const title = params.get('title');
    const year = Number(params.get('year')) || 0;
    let match = await matchMoviesda({ tmdbId: params.get('tmdbId'), title, year });

    // v10.7.0 hybrid: index miss → live search on moviesda (URL guess, then
    // A–Z listing). Cached 6h server-side; costs upstream fetches only for
    // titles the scraper data does not know yet.
    if (!match && params.get('search') === '1' && title) {
      const pageUrl = await searchMoviesdaMovie(title, year).catch(() => null);
      if (pageUrl) {
        match = { title, year, pageUrl, tmdbId: 0, mp4Count: 0, embedCount: 0, source: 'search' };
      }
    }
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
