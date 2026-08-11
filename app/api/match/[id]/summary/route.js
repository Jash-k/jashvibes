import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend(`/api/match/${encodeURIComponent(params?.id || '')}/summary`, searchParams, { timeoutMs: 25000 });
    return sportsJson(data, { maxAge: 20 });
  } catch (error) {
    return sportsError(error, { ok: false, MatchSummary: null });
  }
}
