import { NextResponse } from 'next/server';
import { scrapeTamilMV } from '@/lib/tamilmvScraper';
import { scrapeCollection } from '@/lib/tamilmvPayload';
import { verifyRequestToken } from '@/lib/serverAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


function isAuthorized(request) {
  // A logged-in owner (valid app session) may always trigger the cron.
  if (verifyRequestToken(request)) return true;

  const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-cron-token') || '';
  const expected = process.env.CRON || process.env.CRON_SECRET || process.env.SCRAPE || process.env.SCRAPE_TOKEN || '';

  // Fail CLOSED: this route is exempt from the middleware session check so
  // external schedulers can call it, therefore its own token check must never
  // fail open. Previously it allowed everyone when no CRON secret was set.
  if (!expected) return false;
  return Boolean(token) && token === expected;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized cron token' }, { status: 401 });
  }

  try {
    const cacheLimit = Number(process.env.TAMILMV_CACHE_LIMIT || 90);
    const payload = await scrapeTamilMV({
      fetchPostersEnabled: true,
      maxPosterFetches: Number(process.env.TAMILMV_POSTERS || process.env.TAMILMV_MAX_POSTER_FETCHES || 8),
      limitPerType: cacheLimit,
      matchTMDB: true,
      includeTvShows: false,
    });

    if (!(payload.movies || []).length && !(payload.series || []).length) return NextResponse.json({ ok: false, saved: false, error: 'Source returned no titles; the previous catalogue was preserved.' }, { status: 502 });
    await (await scrapeCollection()).updateOne(
      { key: 'latest' },
      {
        $set: {
          key: 'latest',
          ...payload,
          tvshows: [],
          items: [...(payload.movies || []), ...(payload.series || [])],
          count: (payload.movies || []).length + (payload.series || []).length,
          cacheLimit,
          refreshedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, saved: true, count: payload.count, updatedAt: payload.updatedAt });
  } catch (error) {
    console.error('[api/cron/tamilmv] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'TamilMV cron scrape failed' },
      { status: 500 }
    );
  }
}
