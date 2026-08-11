import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY = {
  highlights: { success: true, videos: [], total: 0, hasMore: false },
  play: { success: false, url: '' },
};

export async function GET(request, { params }) {
  const endpoint = params?.endpoint || 'highlights';
  const { searchParams } = new URL(request.url);
  try {
    // Keep ICC play manifests on the sports backend. The signed ICC Akamai URL is
    // resolved by that backend and /api/icc/vod/* already sends CORS: * there.
    // Re-proxying from this app can break the entitlement because some signed
    // tokens are origin/IP sensitive.
    const data = await fetchSportsBackend(`/api/icc/${endpoint}`, searchParams, { timeoutMs: endpoint === 'play' ? 45000 : 30000 });
    return sportsJson(data, { maxAge: endpoint === 'highlights' ? 300 : 0 });
  } catch (error) {
    return sportsError(error, EMPTY[endpoint] || null);
  }
}
