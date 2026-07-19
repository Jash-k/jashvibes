import { NextResponse } from 'next/server';
import { scrapeTamilMV } from '@/lib/tamilmvScraper';
import dbConnect from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COLLECTION_NAME = 'tamilmv_scrapes';

function isAuthorized(request) {
  const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-cron-token') || '';
  const expected = process.env.CRON || process.env.CRON_SECRET || process.env.SCRAPE || process.env.SCRAPE_TOKEN || '';
  if (!expected) return true;
  return token && token === expected;
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

    const mongoose = await dbConnect();
    await mongoose.connection.db.collection(COLLECTION_NAME).updateOne(
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
