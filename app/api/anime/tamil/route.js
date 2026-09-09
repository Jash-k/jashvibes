import { NextResponse } from 'next/server';
import { TTL_LISTING_MS, loadListing } from '@/lib/animeTamilFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/anime/tamil?page=2` — one page of the Tamil list, `?all=1` for the whole walk,
 * `?q=…` to search the source, `?force=1` to drop this route's window early.
 *
 * The window is 6 hours because a catalogue of this kind barely moves, and the walk is opt-in: a
 * "Load more" tap costs one upstream read, not one per page seen so far. A Render/Koyeb free instance
 * must never be the thing that keeps this list warm — nothing here is scheduled, and nothing is stored.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Math.min(Number(searchParams.get('page') || 1), 60));
  const all = searchParams.get('all') === '1';
  const query = String(searchParams.get('q') || '').trim().slice(0, 60);
  try {
    const feed = await loadListing({
      page,
      all,
      query,
      force: searchParams.get('force') === '1',
    });
    const age = Number(feed?.cacheAgeMs) || 0;
    const seconds = Math.max(5, Math.round((TTL_LISTING_MS - age) / 1000));
    return NextResponse.json({
      ok: Boolean(feed?.ok),
      items: feed?.items || [],
      page: feed?.page || page,
      maxPage: feed?.maxPage || 1,
      hasNext: Boolean(feed?.hasNext),
      all: Boolean(feed?.all),
      complete: feed?.complete,
      pagesFetched: feed?.pagesFetched,
      generatedAt: feed?.generatedAt || 0,
      source: feed?.source || '',
      cached: Boolean(feed?.cached),
      stale: Boolean(feed?.stale),
      error: feed?.error || (feed?.ok ? '' : 'the listing did not answer'),
    }, {
      headers: { 'Cache-Control': feed?.ok ? `public, max-age=${Math.min(seconds, 3600)}` : 'no-store' },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, items: [], error: error?.message || 'the listing could not be read' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
