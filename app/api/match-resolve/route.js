import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend('/api/match-resolve', searchParams, { timeoutMs: 25000 });
    return sportsJson(data, { maxAge: 300 });
  } catch (error) {
    return sportsError(error, { ok: false, payload: null });
  }
}
