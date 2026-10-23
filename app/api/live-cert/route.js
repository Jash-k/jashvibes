/**
 * app/api/live-cert/route.js
 * FairPlay server certificate fetcher — returns binary .cer for Shaka's
 * drm.advanced['com.apple.fps'].serverCertificateUri
 *
 * Usage: player.configure({ drm: { advanced: { 'com.apple.fps': { serverCertificateUri: '/api/live-cert?u=<certUrl>' } } } })
 */
import { safeFetch, publicDestination } from '@/lib/server/safeFetch';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('u') || searchParams.get('url') || '';
    if (!rawUrl) return NextResponse.json({ error: 'Missing cert URL' }, { status: 400 });
    let target;
    try { target = new URL(rawUrl); } catch { return NextResponse.json({ error: 'Invalid cert URL' }, { status: 400 }); }
    if (!['http:', 'https:'].includes(target.protocol)) return NextResponse.json({ error: 'Invalid protocol' }, { status: 400 });
    try { await publicDestination(`https://${target.hostname}`); } catch (e) {
      return NextResponse.json({ error: 'Blocked cert host', reason: e.message }, { status: 400 });
    }
    const upstream = await safeFetch(target.href, {
      headers: { Accept: 'application/octet-stream,*/*' },
      cache: 'no-store',
      signal: request.signal,
    });
    if (!upstream.ok) return NextResponse.json({ error: `Cert fetch ${upstream.status}` }, { status: upstream.status });
    const buf = await upstream.arrayBuffer();
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    console.error('[api/live-cert] failed:', e?.name);
    return NextResponse.json({ error: 'Cert fetch failed' }, { status: 502 });
  }
}
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Cache-Control': 'no-store' } });
}
