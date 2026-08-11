export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ICC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: '*/*',
  Referer: 'https://www.icc-cricket.com/',
  Origin: 'https://www.icc-cricket.com',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, Accept-Ranges',
};

function targetFromRequest(request) {
  const url = new URL(request.url);
  const marker = '/api/icc/vod/';
  const index = url.pathname.indexOf(marker);
  const raw = index >= 0 ? url.pathname.slice(index + marker.length) : '';
  if (!raw) return '';
  return `https://${raw}${url.search || ''}`;
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request) {
  const target = targetFromRequest(request);
  if (!target) return new Response('missing path', { status: 400, headers: CORS });
  try {
    const upstream = await fetch(target, { cache: 'no-store', redirect: 'follow', headers: ICC_HEADERS });
    const headers = new Headers(CORS);
    const contentType = upstream.headers.get('content-type') || (/\.mpd(\?|$)/i.test(target) ? 'application/dash+xml' : 'application/octet-stream');
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'no-store');
    for (const key of ['content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(key);
      if (value) headers.set(key, value);
    }
    if (!upstream.ok) return new Response(null, { status: upstream.status, headers });
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return Response.json({ error: error.message || 'ICC VOD proxy failed' }, { status: 502, headers: CORS });
  }
}
