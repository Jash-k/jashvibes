import { NextResponse } from 'next/server';

/**
 * Server-side self-call helper. Some admin actions ("Sync now", "Purge cache",
 * "TV health sweep") are thin triggers over EXISTING battle-tested endpoints
 * — rather than duplicating their logic, we call our own API with the caller's
 * credentials forwarded (cookies + token header), so authorization and
 * behaviour are byte-identical to pressing the original button.
 */
export async function selfApi(request, path, { method = 'GET', body } = {}) {
  const origin = new URL(request.url).origin;
  const headers = { Accept: 'application/json' };
  const cookie = request.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  const token = request.headers.get('x-jash-token') || request.headers.get('x-service-token');
  if (token) headers['x-jash-token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}): ${path}`);
  }
  return data;
}

export function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}
