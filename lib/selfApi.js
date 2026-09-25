import { NextResponse } from 'next/server';

/**
 * Server-side self-call helper. Some admin actions ("Sync now", "Purge cache",
 * "TV health sweep") are thin triggers over EXISTING battle-tested endpoints
 * — rather than duplicating their logic, we call our own API with the caller's
 * credentials forwarded (cookies + token header), so authorization and
 * behaviour are byte-identical to pressing the original button.
 */
export async function selfApi(request, path, { method = 'GET', body, timeoutMs = 180_000 } = {}) {
  // Loopback, not the public origin: a container calling its own public URL
  // has to hairpin through the edge (Cloudflare), where the connection is
  // routinely refused — the "fetch failed" the admin sweep showed. The server
  // listens on 0.0.0.0:$PORT, so 127.0.0.1 is always the shortest path.
  const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
  const headers = { Accept: 'application/json' };
  const cookie = request.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  const token = request.headers.get('x-jash-token') || request.headers.get('x-service-token');
  if (token) headers['x-jash-token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      error?.name === 'AbortError'
        ? `The internal ${method} ${path} timed out after ${Math.round(timeoutMs / 1000)}s.`
        : `Internal self-call failed (${method} ${path}): ${error?.message || 'unknown'}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status}): ${path}`);
  }
  return data;
}

export function jsonNoStore(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}
