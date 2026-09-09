import { NextResponse } from 'next/server';
import { cachedFeed } from '@/lib/sportsFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Sports feed in one request.
 *
 * The page used to fetch a third-party GitHub dump and an external Render backend straight from the browser and
 * normalise the rows inline. That gave the free tier a per-view fan-out, gave the user a blank wall when a source
 * slept, and could not tell the two apart. Here the sources are read once, merged, and the answer carries
 * per-source health, so "2 of 5 feeds answered" is a fact on screen rather than a guess.
 *
 * The caching, the request coalescing and the short failure window live in `cachedFeed` (lib/sportsFeed.js)
 * because `/api/sports/hub` needs the same answer — one upstream read serves both routes.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get('force') === '1';
  const started = Date.now();
  try {
    const payload = await cachedFeed({ now: started, force });
    const fresh = payload.cachedAt + (payload.ttlMs || 0) - Date.now();
    const maxAge = Math.max(0, Math.min(20, Math.ceil(fresh / 1000)));
    return NextResponse.json(
      { ...payload, tookMs: Date.now() - started },
      { headers: { 'Cache-Control': maxAge > 1 ? `public, max-age=${maxAge}` : 'no-store' } },
    );
  } catch (error) {
    // A board that cannot be read says so; it never answers 500 with an empty body.
    return NextResponse.json(
      { ok: false, unavailable: true, items: [], counts: { live: 0, soon: 0, done: 0, tbc: 0 }, sources: [], note: error.message || 'no feed answered' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
