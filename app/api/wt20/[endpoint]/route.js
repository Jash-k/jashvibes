import { NextResponse } from 'next/server';
import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WT20_CLIENT_ID = 'tPZJbRgIub3Vua93/DWtyQ==';
const WT20_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.icc-cricket.com/',
  'Origin': 'https://www.icc-cricket.com',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function GET(request, { params }) {
  const resolvedParams = await params;
  const endpoint = resolvedParams?.endpoint || 'schedule';
  const { searchParams } = new URL(request.url);

  try {
    if (endpoint === 'scorecard') {
      const gameId = searchParams.get('game_id');
      if (!gameId) return NextResponse.json({ ok: false, error: 'game_id is required' }, { status: 400 });

      const url = `https://assets-icc.sportz.io/cricket/v1/game/scorecard?client_id=${encodeURIComponent(WT20_CLIENT_ID)}&feed_format=json&game_id=${encodeURIComponent(gameId)}&lang=en`;
      const response = await fetch(url, {
        headers: WT20_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data, {
          headers: { 'Cache-Control': 'public, max-age=15, s-maxage=15' },
        });
      }
    }

    if (endpoint === 'schedule') {
      const seriesIds = searchParams.get('series_ids') || '12672';
      const gameCount = searchParams.get('game_count') || '10';
      const isLive = searchParams.get('is_live') || 'true';
      const isRecent = searchParams.get('is_recent') || 'true';
      const isUpcoming = searchParams.get('is_upcoming') || 'true';

      const q = new URLSearchParams({
        client_id: WT20_CLIENT_ID,
        feed_format: 'json',
        game_count: gameCount,
        is_deleted: 'false',
        is_live: isLive,
        is_recent: isRecent,
        is_upcoming: isUpcoming,
        lang: 'en',
        league_ids: '1,9,10,35',
        pagination: 'false',
        series_ids: seriesIds,
        timezone: '0530',
      });

      const url = `https://assets-icc.sportz.io/cricket/v1/schedule?${q.toString()}`;
      const response = await fetch(url, {
        headers: WT20_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data, {
          headers: { 'Cache-Control': 'public, max-age=45, s-maxage=45' },
        });
      }
    }

    if (endpoint === 'commentary') {
      const gameId = searchParams.get('game_id');
      const inning = searchParams.get('inning') || '1';
      const pageNumber = searchParams.get('page_number') || '1';
      const pageSize = searchParams.get('page_size') || '20';

      if (!gameId) return NextResponse.json({ ok: false, error: 'game_id is required' }, { status: 400 });

      const q = new URLSearchParams({
        client_id: WT20_CLIENT_ID,
        feed_format: 'json',
        game_id: gameId,
        inning,
        key_event: 'true',
        lang: 'en',
        page_number: pageNumber,
        page_size: pageSize,
      });

      const url = `https://assets-icc.sportz.io/cricket/v1/game/commentary?${q.toString()}`;
      const response = await fetch(url, {
        headers: WT20_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const data = await response.json();
        return NextResponse.json(data, {
          headers: { 'Cache-Control': 'public, max-age=15, s-maxage=15' },
        });
      }
    }

    // Fallback to proxy backend if direct call didn't return OK
    const data = await fetchSportsBackend(`/api/wt20/${endpoint}`, searchParams, { timeoutMs: 15000 });
    return sportsJson(data, { maxAge: endpoint === 'schedule' ? 45 : 15 });
  } catch (error) {
    try {
      const fallbackData = await fetchSportsBackend(`/api/wt20/${endpoint}`, searchParams, { timeoutMs: 15000 });
      return sportsJson(fallbackData, { maxAge: 15 });
    } catch {
      return sportsError(error, { data: endpoint === 'schedule' ? { matches: [] } : {} });
    }
  }
}
