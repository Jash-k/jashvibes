import { safeFetch, publicDestination, readLimitedText } from '@/lib/server/safeFetch';

import net from 'node:net';
import dns from 'node:dns/promises';
import { NextResponse } from 'next/server';
import { isPlaylistResponse, rewritePlaylist } from '@/lib/player/playlistRewrite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isBlockedHost(hostname = '') { return !hostname; }
async function assertPublicHost(hostname) { await publicDestination(`https://${hostname}`); }

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

    const rawHeaders = searchParams.get('hd') || '{}';
    try { for (const [name, value] of Object.entries(JSON.parse(rawHeaders))) { if (/^(host|connection|content-length|transfer-encoding|upgrade)$/i.test(name) || value == null) continue; upstreamHeaders.set(name, String(value)); } } catch { return NextResponse.json({ error: 'Invalid source headers' }, { status: 400 }); }
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

    let requestBody;
    if (request.method === 'POST') {
      const reader = request.body?.getReader(); const chunks = []; let size = 0;
      if (reader) { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 1024 * 1024) { await reader.cancel(); return NextResponse.json({ error: 'Licence request body exceeds 1 MiB.' }, { status: 413 }); } chunks.push(Buffer.from(value)); } }
      requestBody = Buffer.concat(chunks); upstreamHeaders.set('Content-Type', request.headers.get('content-type') || 'application/octet-stream');
    }
    const upstream = await safeFetch(target.href, {
      method: request.method === 'HEAD' ? 'HEAD' : request.method === 'POST' ? 'POST' : 'GET',
      body: requestBody,
      headers: upstreamHeaders,
      redirect: 'follow',
      cache: 'no-store',
      signal: request.signal,
    });

    /* A playlist is not piped — it is REWRITTEN, so every variant, audio track,
       key and segment inside it comes back through this proxy too. Without the
       rewrite the master loads and the first child dies on CORS: the exact
       "cards show but the stream does not play" failure. */
    const contentType = upstream.headers.get('content-type') || '';
    if (request.method !== 'HEAD' && upstream.ok && isPlaylistResponse({ url: target.href, contentType })) {
      const playlistText = await readLimitedText(upstream);
      const proxyBase = `${new URL(request.url).origin}/api/live-proxy`;
      const extras = new URLSearchParams();
      if (rawHeaders !== '{}') extras.set('hd', rawHeaders);
      if (ua) extras.set('ua', ua);
      if (referer) extras.set('ref', referer);
      if (cookie) extras.set('ck', cookie);
      const extraQuery = extras.toString();
      const rewritten = rewritePlaylist(playlistText, {
        baseUrl: upstream.url || target.href,
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
    headers.set('X-Jash-Upstream-Url', upstream.url);
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

export async function POST(request) { return proxy(request); }
