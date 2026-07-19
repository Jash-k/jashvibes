import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import VodItem from '@/models/VodItem';
import {
  fetchVodEntriesFromSources,
  matchMovieToTMDB,
  runLimitedConcurrency,
} from '@/lib/vodM3u';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-sync-token') || '';
  const expected = process.env.SYNC || process.env.VOD_SYNC || process.env.VOD_SYNC_TOKEN || '';
  if (!expected) return true;
  return token && token === expected;
}

function mergeByKey(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const existing = map.get(entry.key);
    if (!existing) {
      map.set(entry.key, { ...entry, streams: [entry.stream] });
      continue;
    }
    existing.streams.push(entry.stream);
    if (!existing.year && entry.year) existing.year = entry.year;
  }

  return [...map.values()].map((item) => {
    const seen = new Set();
    item.streams = item.streams.filter((stream) => {
      if (!stream?.url || seen.has(stream.url)) return false;
      seen.add(stream.url);
      return true;
    });
    return item;
  });
}

async function syncVod() {
  const syncBatch = new Date().toISOString();
  const { entries, sources, errors } = await fetchVodEntriesFromSources();
  const grouped = mergeByKey(entries);
  const syncLimit = Number(process.env.VOD_LIMIT || process.env.CLASSICS_LIMIT || 0);
  const workItems = syncLimit > 0 ? grouped.slice(0, syncLimit) : grouped;

  let matched = 0;
  let unmatched = 0;
  let stored = 0;

  await dbConnect();

  await runLimitedConcurrency(workItems, Number(process.env.VOD_CONCURRENCY || 3), async (item) => {
    let tmdb = null;
    try {
      tmdb = await matchMovieToTMDB({ title: item.title, year: item.year });
    } catch (error) {
      console.warn('[vod/sync] TMDB match failed:', item.title, error.message);
    }

    if (tmdb?.tmdbId) matched += 1;
    else unmatched += 1;

    const key = tmdb?.tmdbId ? `tmdb:movie:${tmdb.tmdbId}` : item.key;
    const streams = item.streams || [];
    const sourcesList = [...new Set(streams.map((stream) => stream.source).filter(Boolean))];

    const setPayload = {
      key,
      title: tmdb?.title || item.title,
      normalizedTitle: item.normalizedTitle,
      type: 'movie',
      year: tmdb?.year || item.year || undefined,
      releaseDate: tmdb?.releaseDate || (item.year ? new Date(`${item.year}-01-01`) : undefined),
      tmdbId: tmdb?.tmdbId || undefined,
      tmdbMatched: Boolean(tmdb?.tmdbId),
      originalTitle: tmdb?.originalTitle || '',
      synopsis: tmdb?.synopsis || '',
      posterUrl: tmdb?.posterUrl || streams.find((stream) => stream.logo)?.logo || '',
      backdropUrl: tmdb?.backdropUrl || '',
      rating: tmdb?.rating || 0,
      voteCount: tmdb?.voteCount || 0,
      language: tmdb?.language || '',
      genres: tmdb?.genres || [],
      syncBatch,
      lastSyncedAt: new Date(),
    };

    await VodItem.updateOne(
      { key },
      {
        $set: {
          ...setPayload,
          sources: sourcesList,
          streams,
        },
      },
      { upsert: true },
    );
    stored += 1;
  });

  return {
    ok: true,
    syncBatch,
    sourceCount: sources.length,
    sources: sources.map((source) => ({ label: source.label })),
    parsedEntries: entries.length,
    groupedTitles: grouped.length,
    processed: workItems.length,
    stored,
    matched,
    unmatched,
    errors,
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized VOD sync token' }, { status: 401 });
  }

  try {
    const result = await syncVod();
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/vod/sync] Error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'VOD sync failed' }, { status: 500 });
  }
}

export const POST = GET;
