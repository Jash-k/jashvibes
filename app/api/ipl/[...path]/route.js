import { fetchSportsBackend, sportsError, sportsJson } from '@/lib/sportsProxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallbackFor(path) {
  if (/all-matches$/.test(path)) return { ok: true, matches: [], source: 'unavailable' };
  if (path === 'highlight-videos') return { ok: true, videos: [] };
  if (path === 'stream') return { ok: false, url: '' };
  return null;
}

export async function GET(request, { params }) {
  const path = (params?.path || []).join('/');
  const { searchParams } = new URL(request.url);
  try {
    const data = await fetchSportsBackend(`/api/ipl/${path}`, searchParams, { timeoutMs: /all-matches$/.test(path) ? 45000 : 30000 });
    return sportsJson(data, { maxAge: /all-matches$/.test(path) ? 600 : 30 });
  } catch (error) {
    return sportsError(error, fallbackFor(path));
  }
}
