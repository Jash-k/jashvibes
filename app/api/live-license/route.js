/**
 * app/api/live-license/route.js
 * Dedicated DRM license proxy — forwards EME license requests with auth headers.
 * Separate from live-proxy (media segments) so credential scoping is correct:
 *   - Media segments: NEVER forward Authorization/Cookie cross-origin
 *   - License requests: MUST forward them (token, Authorization, customData)
 *
 * Called by usePlaybackEngine requestFilter for RequestType.LICENSE
 *   /api/live-license?u=<licenseUrl>&ch=<channelId>
 *
 * Security: publicDestination check + no header logging
 */
import { safeFetch, publicDestination } from '@/lib/server/safeFetch';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickHeader(request, names = []) {
  for (const name of names) {
    const v = request.headers.get(name);
    if (v) return v;
  }
  return '';
}

async function proxy(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('u') || searchParams.get('url') || '';
    if (!rawUrl) return NextResponse.json({ error: 'Missing license URL' }, { status: 400 });

    let target;
    try { target = new URL(rawUrl); } catch { return NextResponse.json({ error: 'Invalid license URL' }, { status: 400 }); }
    if (!['http:', 'https:'].includes(target.protocol)) return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 });

    try { await publicDestination(`https://${target.hostname}`); } catch (e) {
      return NextResponse.json({ error: 'Blocked license host', reason: e.message }, { status: 400 });
    }

    // Collect license-specific headers from query (injected by requestFilter)
    const auth = searchParams.get('auth') || searchParams.get('authorization') || '';
    const token = searchParams.get('token') || '';
    const customData = searchParams.get('customData') || '';
    const headersJson = searchParams.get('hd') || '{}';
    let extraHeaders = {};
    try {
      const parsed = JSON.parse(headersJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extraHeaders = parsed;
    } catch {}

    const upstreamHeaders = new Headers();
    // Read content-type from original request (EME challenge is binary)
    const ct = request.headers.get('content-type') || 'application/octet-stream';
    upstreamHeaders.set('Content-Type', ct);
    upstreamHeaders.set('Accept', '*/*');
    // Forward auth
    if (auth) upstreamHeaders.set('Authorization', auth);
    if (token) upstreamHeaders.set('X-AxDRM-Message', token); // Axinom
    if (customData) upstreamHeaders.set('customData', customData);
    // Forward extra allowed headers
    for (const [k, v] of Object.entries(extraHeaders)) {
      if (!k || !v) continue;
      if (/^(host|connection|content-length|cookie)$/i.test(k)) continue;
      try { upstreamHeaders.set(k, String(v)); } catch {}
    }

    let body = null;
    if (request.method === 'POST') {
      const ab = await request.arrayBuffer();
      if (ab.byteLength > 1024 * 1024) return NextResponse.json({ error: 'License body too large' }, { status: 413 });
      body = Buffer.from(ab);
    }

    const upstream = await safeFetch(target.href, {
      method: request.method === 'POST' ? 'POST' : 'GET',
      headers: upstreamHeaders,
      body,
      redirect: 'follow',
      cache: 'no-store',
      signal: request.signal,
    });

    // Pass through license response as-is (usually binary)
    const resHeaders = new Headers();
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    resHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,customData,X-AxDRM-Message');
    resHeaders.set('Cache-Control', 'no-store');
    const ct2 = upstream.headers.get('content-type');
    if (ct2) resHeaders.set('Content-Type', ct2);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: resHeaders,
    });
  } catch (error) {
    console.error('[api/live-license] relay failed:', error?.name || 'Error');
    return NextResponse.json({ error: 'License relay failed' }, { status: 502 });
  }
}

export async function GET(request) { return proxy(request); }
export async function POST(request) { return proxy(request); }
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,customData,X-AxDRM-Message',
      'Cache-Control': 'no-store',
    },
  });
}
