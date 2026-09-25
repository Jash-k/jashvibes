
import net from 'node:net';
import dns from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { isPlaylistResponse, rewritePlaylist } from '@/lib/player/playlistRewrite';

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


/**
 * Resolve-then-verify: hostname blocklists do not stop a DNS name that ANSWERS
 * with a private/loopback/metadata address (DNS rebinding to 169.254.169.254).
 * Every address the name resolves to must be public, else the fetch is refused.
 */
async function assertPublicHost(hostname = '') {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return; // literal IPs were already checked by isBlockedHost
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error('host does not resolve');
  }
  for (const { address } of addresses) {
    if (net.isIP(address) === 6) {
      const low = address.toLowerCase();
      if (low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80') || low === '::') {
        throw new Error('host resolves to a private address');
      }
      continue;
    }
    if (isPrivateIPv4(address)) throw new Error('host resolves to a private address');
  }
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
    if (!rawUrl) {
      return NextResponse.json({ error: 'Missing live proxy URL' }, { status: 400 });
    }

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid live proxy URL' }, { status: 400 });
    }

    if (!['http:', 'https:'].includes(target.protocol) || isBlockedHost(target.hostname)) {
      return NextResponse.json({ error: 'Blocked live proxy host' }, { status: 400 });
    }

    try {
      await assertPublicHost(target.hostname);
    } catch (error) {
      return NextResponse.json({ error: 'Blocked live proxy host', reason: error.message }, { status: 400 });
    }

    const upstreamHeaders = new Headers();
    const ua = searchParams.get('ua') || 'Mozilla/5.0 (compatible; JaSH-ViBeS-Live/1.0)';
    const referer = searchParams.get('ref') || searchParams.get('referer') || '';
    const cookie = searchParams.get('ck') || searchParams.get('cookie') || '';
    const range = pickHeader(request, ['range', 'Range']);
    const accept = pickHeader(request, ['accept', 'Accept']);

    if (ua) upstreamHeaders.set('User-Agent', ua);
    if (referer) upstreamHeaders.set('Referer', referer);
    if (cookie) upstreamHeaders.set('Cookie', cookie);
    if (range) upstreamHeaders.set('Range', range);
    if (accept) upstreamHeaders.set('Accept', accept);
    else upstreamHeaders.set('Accept', '*/*');

    // Some edges (Hotstar-class) refuse unless Referer and Origin arrive together;
    // a browser cannot send either cross-origin, which is why this proxy exists.
    if (referer && !upstreamHeaders.has('Origin')) {
      try { upstreamHeaders.set('Origin', new URL(referer).origin); } catch { /* keep target-only */ }
    }

    const upstream = await fetch(target.href, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      cache: 'no-store',
    });

    /* A playlist is not piped — it is REWRITTEN, so every variant, audio track,
       key and segment inside it comes back through this proxy too. Without the
       rewrite the master loads and the first child dies on CORS: the exact
       "cards show but the stream does not play" failure. */
    const contentType = upstream.headers.get('content-type') || '';
    if (request.method !== 'HEAD' && upstream.ok && isPlaylistResponse({ url: target.href, contentType })) {
      const playlistText = await upstream.text();
      const proxyBase = `${new URL(request.url).origin}/api/live-proxy`;
      const extras = new URLSearchParams();
      if (ua) extras.set('ua', ua);
      if (referer) extras.set('ref', referer);
      if (cookie) extras.set('ck', cookie);
      const extraQuery = extras.toString();
      const rewritten = rewritePlaylist(playlistText, {
        baseUrl: target.href,
        wrap: (child) => `${proxyBase}?u=${encodeURIComponent(child)}${extraQuery ? `&${extraQuery}` : ''}`,
      });
      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store, max-age=0',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
          'Access-Control-Allow-Headers': 'Range,Accept,Origin,Content-Type',
        },
      });
    }

    const headers = new Headers();
    const copyHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ];
    copyHeaders.forEach((name) => {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    });
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range,Accept,Origin,Content-Type');
    headers.set('Cache-Control', 'no-store, max-age=0');

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error('[api/live-proxy] Error:', error);
    return NextResponse.json({ error: error.message || 'Live proxy failed' }, { status: 502 });
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
