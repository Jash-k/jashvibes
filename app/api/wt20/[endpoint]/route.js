import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY = {
  schedule: { data: { matches: [] } },
  scorecard: { Matchdetail: {}, Teams: {}, Innings: [] },
  commentary: { data: [] },
};

export async function GET(request, { params }) {
  const endpoint = params?.endpoint || 'schedule';
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend(`/api/wt20/${endpoint}`, searchParams, { timeoutMs: 30000 });
    return sportsJson(data, { maxAge: endpoint === 'schedule' ? 60 : 20 });
  } catch (error) {
    return sportsError(error, EMPTY[endpoint] || null);
  }
}
