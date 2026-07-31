import net from 'node:net';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPrivateIPv4(hostname = '') {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a === 0
  );
}

function isBlockedHost(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  if (net.isIP(host) === 4 && isPrivateIPv4(host)) return true;
  return false;
}

function pickHeader(request, names = []) {
  for (const name of names) {
    const value = request.headers.get(name);
    if (value) return value;
  }
  return '';
}

async function proxy(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('u') || searchParams.get('url') || '';
    if (!rawUrl) return NextResponse.json({ error: 'Missing Pocket proxy URL' }, { status: 400 });

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid Pocket proxy URL' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target.hostname)) {
      return NextResponse.json({ error: 'Blocked Pocket proxy host' }, { status: 400 });
    }

    const headers = new Headers();
    const ua = searchParams.get('ua') || 'Mozilla/5.0 (compatible; JaSH-ViBeS-Pocket/1.0)';
    const referer = searchParams.get('ref') || searchParams.get('referer') || '';
    const cookie = searchParams.get('ck') || searchParams.get('cookie') || '';
    const range = pickHeader(request, ['range', 'Range']);
    const accept = pickHeader(request, ['accept', 'Accept']);

    if (ua) headers.set('User-Agent', ua);
    if (referer) headers.set('Referer', referer);
    if (cookie) headers.set('Cookie', cookie);
    if (range) headers.set('Range', range);
    headers.set('Accept', accept || '*/*');

    const upstream = await fetch(target.href, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      cache: 'no-store',
    });

    const responseHeaders = new Headers();
    ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'].forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    });
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', 'Range,Accept,Origin,Content-Type');
    responseHeaders.set('Cache-Control', 'no-store, max-age=0');

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[api/live-pocket/proxy] Error:', error);
    return NextResponse.json({ error: error.message || 'Pocket proxy failed' }, { status: 502 });
  }
}

export async function GET(request) {
  return proxy(request);
}

export async function HEAD(request) {
  return proxy(request);
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Range,Accept,Origin,Content-Type',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
