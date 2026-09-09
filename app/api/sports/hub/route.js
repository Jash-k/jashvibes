import { NextResponse } from 'next/server';
import { FEED_TTL_LIVE_MS, cachedFeed, findFeedItem, loadHub } from '@/lib/sportsFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One hub request per open match: `?source=bcci&id=…`, nothing else.
 *
 * The display context for a match (teams, venue, status words, its stream variants) is read from the same
 * cached feed the board came from, which is why the URL stays two path segments long. The old surface put a
 * base64 copy of the score into the match URL, so a bookmark from yesterday printed yesterday's score today.
 * Query parameters are accepted only as a fallback for a match no feed is currently carrying — a deep link to a
 * finished game, for instance — and they are whitelisted to plain label fields for that reason.
 *
 * No per-request fan-out beyond this route: a live match is served from a 20 s window and the client decides
 * when to ask again.
 */
const SEED_FIELDS = ['home', 'away', 'homeCode', 'awayCode', 'competition', 'venue', 'statusLine', 'result', 'startAt', 'state', 'stream', 'cardId', 'inningsKind', 'competitionId', 'matchOrder', 'scoreHome', 'scoreAway', 'coverage', 'toss', 'playerOfMatch', 'gameId'];

function readSeed(searchParams) {
  const seed = {};
  for (const field of SEED_FIELDS) {
    const value = searchParams.get(field);
    if (value) seed[field] = value.slice(0, 160);
  }
  return seed;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const source = String(searchParams.get('source') || 'bcci').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  const id = String(searchParams.get('id') || '').slice(0, 64);
  if (!id) {
    return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });
  }
  try {
    const force = searchParams.get('force') === '1';
    const feed = await cachedFeed({ force }).catch(() => null);
    const card = findFeedItem(feed || {}, source, id) || {};
    const hub = await loadHub({ source, id, seed: { ...readSeed(searchParams), ...card } });
    const seconds = hub.match?.state === 'live' ? Math.round(FEED_TTL_LIVE_MS / 1000) : 120;
    return NextResponse.json({ ...hub, source, fromFeed: Boolean(card.id) }, {
      headers: { 'Cache-Control': `public, max-age=${seconds}` },
    });
  } catch (error) {
    // Never a 500 with an empty body: the page prints this sentence inside the hub.
    return NextResponse.json({
      ok: false,
      source,
      error: error.message || 'the hub could not be built',
      panels: { scorecard: { state: 'unavailable', note: error.message || 'the score feed did not answer' } },
      match: { source, id },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
