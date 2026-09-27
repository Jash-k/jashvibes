/**
 * GET /api/moviesda/resolve?pageUrl= — v10.6.2 cache warmer.
 *
 * The watch page fires this in the background the moment the source match
 * lands, so the hop-chain walk happens while the user watches the Stremio
 * stream. Clicking DIRECT MP4 afterwards hits the warm 45-minute cache and
 * switches instantly. Returns only counts — the playable links stay
 * server-side and are minted by /api/resolve on click.
 */
import { NextResponse } from 'next/server';
import { resolveMoviesdaMovie } from '@/lib/moviesda/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_HOSTS = ['moviesda34.com', 'movies.downloadpage.xyz', 'www.moviesda34.com'];

export async function GET(request) {
  try {
    const pageUrl = String(new URL(request.url).searchParams.get('pageUrl') || '');
    let host = '';
    try {
      host = new URL(pageUrl).hostname;
    } catch { /* invalid */ }
    if (!ALLOWED_HOSTS.includes(host)) {
      return NextResponse.json({ ok: false, error: 'pageUrl must be a moviesda item page' }, { status: 400 });
    }

    const started = Date.now();
    const fresh = await resolveMoviesdaMovie(pageUrl);
    return NextResponse.json(
      {
        ok: true,
        mp4Count: fresh.mp4s?.length || 0,
        embedCount: fresh.embeds?.length || 0,
        reason: fresh.reason || '',
        ms: Date.now() - started,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'warm failed' }, { status: 200 });
  }
}
