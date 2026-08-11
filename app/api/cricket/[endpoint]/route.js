import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY = {
  innings: { ok: true, innings: [] },
  balls: { ok: true, overs: [] },
  photo: { ok: false, image: '' },
};

export async function GET(request, { params }) {
  const endpoint = params?.endpoint || 'innings';
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend(`/api/cricket/${endpoint}`, searchParams, { timeoutMs: 30000 });
    return sportsJson(data, { maxAge: endpoint === 'photo' ? 600 : 20 });
  } catch (error) {
    return sportsError(error, EMPTY[endpoint] || null);
  }
}
