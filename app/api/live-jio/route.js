import { NextResponse } from 'next/server';
import { getFreshJioCookie, getJioChannelAccess } from '@/lib/liveTv';
import {
  JIO_REFERER,
  JIO_USER_AGENT,
  appendJioCookieToUrl,
  getJioCookieExpiry,
  isJioCookieValid,
  isJioStreamUrl,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range,Accept,Origin,Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,X-Jash-Jio-Token-Expires',
  'Cache-Control': 'no-store, max-age=0',
};

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

function validTarget(rawUrl = '') {
  if (!rawUrl || rawUrl.length > 8000) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || !isJioStreamUrl(parsed.href)) return null;
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

async function fetchAllowedJio(url, options, cookie, redirects = 3) {
  let current = validTarget(appendJioCookieToUrl(url, cookie));
  if (!current) throw new Error('Blocked Jio playback host');

  for (let attempt = 0; attempt <= redirects; attempt += 1) {
    const response = await fetch(current.href, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    const next = location
      ? validTarget(appendJioCookieToUrl(new URL(location, current).href, cookie))
      : null;
    if (!next) throw new Error('Blocked Jio playback redirect');
    current = next;
  }
  throw new Error('Too many Jio playback redirects');
}

async function handle(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawTarget = searchParams.get('u') || searchParams.get('url') || '';
    const requestedCookie = normalizeJioCookie(searchParams.get('ck') || searchParams.get('cookie') || '');
    const force = searchParams.get('force') === '1';
    const channelDescriptor = {
      tvgId: searchParams.get('channelId') || searchParams.get('tvgId') || '',
      name: searchParams.get('name') || '',
      url: searchParams.get('channelUrl') || '',
    };
    const hasChannelDescriptor = Boolean(channelDescriptor.tvgId || channelDescriptor.name || channelDescriptor.url);
    const access = isJioCookieValid(requestedCookie)
      ? { cookie: requestedCookie, playbackUrl: rawTarget || channelDescriptor.url, scoped: false }
      : hasChannelDescriptor
        ? await getJioChannelAccess(channelDescriptor, { force })
        : { cookie: await getFreshJioCookie({ force }), playbackUrl: rawTarget, scoped: false };
    const cookie = normalizeJioCookie(access.cookie);
    const expiresAt = getJioCookieExpiry(cookie);

    if (!rawTarget) {
      return json({
        ok: Boolean(cookie),
        available: Boolean(cookie),
        cookie,
        playbackUrl: access.playbackUrl || channelDescriptor.url || null,
        scoped: Boolean(access.scoped),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        expiresAtMs: expiresAt,
      }, cookie ? 200 : 503);
    }

    const target = validTarget(rawTarget);
    if (!target) return json({ ok: false, error: 'Only approved Jio stream hosts are allowed' }, 400);
    if (!cookie) return json({ ok: false, error: 'No valid Jio playback token is available' }, 503);

    const upstreamUrl = appendJioCookieToUrl(target.href, cookie);
    const upstreamHeaders = new Headers({
      Accept: request.headers.get('accept') || '*/*',
      Referer: JIO_REFERER,
      'User-Agent': JIO_USER_AGENT,
      Cookie: cookie,
    });
    const range = request.headers.get('range');
    if (range) upstreamHeaders.set('Range', range);

    const upstream = await fetchAllowedJio(upstreamUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers: upstreamHeaders,
      cache: 'no-store',
    }, cookie);

    const headers = new Headers(CORS_HEADERS);
    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (expiresAt) headers.set('X-Jash-Jio-Token-Expires', new Date(expiresAt).toISOString());

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    console.error('[api/live-jio] Playback request failed:', error);
    return json({ ok: false, error: error.message || 'Jio playback request failed' }, 502);
  }
}

export async function GET(request) {
  return handle(request);
}

export async function HEAD(request) {
  return handle(request);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
