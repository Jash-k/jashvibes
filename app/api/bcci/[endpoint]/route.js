import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY = {
  live: { liveMatches: [] },
  upcoming: { upcomingMatches: [] },
  recent: { recentMatches: [] },
  highlights: { success: true, videos: [] },
  highlight: { success: true, videos: [] },
};

export async function GET(request, { params }) {
  const endpoint = params?.endpoint || 'live';
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend(`/api/bcci/${endpoint}`, searchParams, {
      timeoutMs: endpoint === 'highlights' ? 35000 : 25000,
      fallback: ['live', 'upcoming', 'recent'].includes(endpoint) ? { ...EMPTY[endpoint], upstreamUnavailable: true } : null,
    });
    return sportsJson(data, { maxAge: ['live', 'match'].includes(endpoint) ? 20 : 60 });
  } catch (error) {
    return sportsError(error, EMPTY[endpoint] || null);
  }
}
