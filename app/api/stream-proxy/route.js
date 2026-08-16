import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stremio media proxy with Range emulation for chunk-stream sources.
 *
 * Telegram-based Stremio addons serve MP4 files as a plain sequential stream:
 * no Accept-Ranges, no Content-Range, sometimes no Content-Length. A <video>
 * element pointed at such a URL can only play linearly — seeking silently
 * restarts or stalls because every seek is a new Range request the upstream
 * ignores.
 *
 * This proxy makes those streams seekable:
 *   1. Probe the URL once (HEAD, then Range 0-0, then header-only GET) to
 *      learn the total byte size and whether the upstream honours Range.
 *   2. If the upstream honours Range → pure pass-through (no CPU cost).
 *   3. If not (chunk mode) and the size is known → on each Range request open
 *      a fresh upstream GET, read-and-discard `start` bytes, then stream the
 *      remainder as a fully valid `206 Partial Content` response with proper
 *      Content-Length / Content-Range. Forward seeks cost one discarded
 *      prefix of bandwidth; backward seeks re-open and skip again. That is
 *      the only possible mechanism on a sequential stream, and it works.
 *
 * Safety: targets are limited to origins of the configured STREMIO addons
 * (plus STREAM_PROXY_HOSTS extras), so this route cannot be used as an open
 * HTTP proxy.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Range,Accept,Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,X-Seek-Support',
};

// The video element fires many range probes while seeking; never punish that.
const PROBE_TTL_MS = 30 * 60 * 1000;
const PROBE_CACHE_MAX = 2000;
const proberCache = (globalThis.__jashStreamProbeCache ||= new Map());

function addonOrigins() {
  const urls = [
    process.env.STREMIO,
    process.env.STREMIO_ADDON,
    process.env.STREMIO_ADDON_URL,
    process.env.STREMIO_MANIFEST,
    process.env.STREMIO_WATCH,
    process.env.STREMIO_WATCH_ADDON,
    process.env.STREMIO_PROVIDER,
    process.env.STREMIO_PROVIDER_ADDON,
    process.env.STREMIO_PROVIDER_MANIFEST,
    process.env.STREMIO_HOME,
    process.env.STREMIO_CATALOG,
  ];
  const origins = new Set();
  for (const value of urls) {
    if (!value) continue;
    for (const part of String(value).split(',')) {
      try {
        const parsed = new URL(part.trim());
        if (['http:', 'https:'].includes(parsed.protocol)) origins.add(parsed.origin.toLowerCase());
      } catch {}
    }
  }
  for (const extra of String(process.env.STREAM_PROXY_HOSTS || '').split(',')) {
    const host = extra.trim().toLowerCase();
    if (host) origins.add(host.includes('://') ? new URL(host).origin.toLowerCase() : host);
  }
  return origins;
}

function parseTarget(rawUrl = '') {
  if (!rawUrl || rawUrl.length > 8000) return null;
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function isAllowedTarget(parsed) {
  const origins = addonOrigins();
  if (!origins.size) return false;
  const origin = parsed.origin.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  for (const allowed of origins) {
    if (origin === allowed || host === allowed) return true;
    // Allow sub-hosts/parent-hosts of an allowed origin a user configured
    // (telegram addons often serve files from *.workers.dev / *.onrender.com siblings).
    if (host.endsWith(`.${allowed}`) || allowed.endsWith(`.${host}`)) return true;
  }
  return false;
}

function parseContentRangeTotal(value = '') {
  const match = String(value || '').match(/\/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function remember(url, info) {
  if (proberCache.size >= PROBE_CACHE_MAX) proberCache.clear();
  proberCache.set(url, { ...info, checkedAt: Date.now() });
}

function cachedProbe(url) {
  const entry = proberCache.get(url);
  return entry && Date.now() - entry.checkedAt < PROBE_TTL_MS ? entry : null;
}

async function timedFetch(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { cache: 'no-store', redirect: 'follow', ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeTarget(href) {
  const cached = cachedProbe(href);
  if (cached) return cached;

  const info = { seekable: false, supportsRange: false, size: null, contentType: '', checkedAt: Date.now() };

  // 1. HEAD — cheapest when the server implements it.
  try {
    const head = await timedFetch(href, { method: 'HEAD' });
    info.contentType = head.headers.get('content-type') || '';
    const length = Number(head.headers.get('content-length'));
    if (Number.isFinite(length) && length > 0) info.size = length;
    if (/bytes/i.test(head.headers.get('accept-ranges') || '')) info.supportsRange = true;
    if (info.size && info.supportsRange) info.seekable = true;
  } catch {}

  // 2. Range 0-0 probe — settles both range support and total size.
  if (!info.seekable) {
    try {
      const ranged = await timedFetch(href, { headers: { Range: 'bytes=0-0' } });
      if (ranged.status === 206) {
        info.supportsRange = true;
        const total = parseContentRangeTotal(ranged.headers.get('content-range'));
        if (total) info.size = total;
        info.contentType = info.contentType || ranged.headers.get('content-type') || '';
        await ranged.arrayBuffer().catch(() => {});
        if (info.size) info.seekable = true;
      } else if (ranged.status === 416) {
        const total = parseContentRangeTotal(ranged.headers.get('content-range'));
        if (total) {
          info.size = total;
          info.seekable = false; // knows its size but refuses ranges entirely
        }
      } else {
        // 200 to a ranged request == the "telegram chunk" behavior.
        info.supportsRange = false;
        if (!info.size) {
          const length = Number(ranged.headers.get('content-length'));
          if (Number.isFinite(length) && length > 0) info.size = length;
        }
      }
      if (ranged.body) try { await ranged.body.cancel(); } catch {}
    } catch {}
  }

  // 3. Header-only GET — last resort for the size.
  if (!info.size) {
    try {
      const controller = new AbortController();
      const plain = await fetch(href, { cache: 'no-store', redirect: 'follow', signal: controller.signal });
      info.contentType = info.contentType || plain.headers.get('content-type') || '';
      const length = Number(plain.headers.get('content-length'));
      if (Number.isFinite(length) && length > 0) info.size = length;
      controller.abort();
      if (plain.body) try { await plain.body.cancel(); } catch {}
    } catch {}
  }

  remember(href, info);
  return info;
}

function looksLikeVideo(href = '', contentType = '') {
  if (/video\//i.test(contentType)) return true;
  return /\.(mp4|mkv|webm|mov|m4v|ts|avi)(\?|$)/i.test(href);
}

function copyMediaHeaders(fromHeaders, toHeaders, { length, contentRange, contentType, seekable }) {
  const type = contentType || fromHeaders.get('content-type') || '';
  toHeaders.set('Content-Type', type || 'application/octet-stream');
  const etag = fromHeaders.get('etag');
  if (etag) toHeaders.set('ETag', etag);
  const lastModified = fromHeaders.get('last-modified');
  if (lastModified) toHeaders.set('Last-Modified', lastModified);
  toHeaders.set('Accept-Ranges', 'bytes');
  if (Number.isFinite(length)) toHeaders.set('Content-Length', String(length));
  if (contentRange) toHeaders.set('Content-Range', contentRange);
  toHeaders.set('X-Seek-Support', seekable ? 'range' : 'none');
  for (const [key, value] of Object.entries(CORS_HEADERS)) toHeaders.set(key, value);
  toHeaders.set('Cache-Control', 'private, no-transform');
}

/**
 * Opens the upstream as a plain sequential GET, discards `skipBytes`, then
 * exposes the remainder as a web ReadableStream. Returns null when the
 * upstream connection fails.
 */
async function openSkippedStream(href, skipBytes) {
  const upstream = await fetch(href, { cache: 'no-store', redirect: 'follow' });
  if (!upstream.ok && upstream.status !== 200) return { upstream, body: null };
  if (!upstream.body) return { upstream, body: null };
  if (skipBytes <= 0) return { upstream, body: upstream.body };

  const reader = upstream.body.getReader();
  let remaining = skipBytes;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) { controller.close(); return; }
          if (remaining > 0) {
            if (value.byteLength <= remaining) {
              remaining -= value.byteLength;
              continue;
            }
            const slice = value.subarray(remaining);
            remaining = 0;
            controller.enqueue(slice);
            return;
          }
          controller.enqueue(value);
          return;
        }
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      try { await reader.cancel(); } catch {}
    },
  });
  return { upstream, body: stream };
}

function parseRangeHeader(raw = '', size) {
  const match = String(raw || '').match(/bytes=(\d*)-(\d*)/);
  if (!match) return null;
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return null;
  if (!startRaw) {
    // Suffix range: last N bytes.
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0 || !Number.isFinite(size)) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start < 0) return null;
  let end = endRaw ? Number(endRaw) : null;
  if (end !== null && (!Number.isFinite(end) || end < start)) end = null;
  if (Number.isFinite(size)) {
    if (start >= size) return { start, end: size - 1, unsatisfiable: true };
    end = end === null ? size - 1 : Math.min(end, size - 1);
  }
  return { start, end };
}

async function handle(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawTarget = searchParams.get('u') || '';
    const target = parseTarget(rawTarget);
    if (!target) return jsonError('A valid http(s) target is required', 400);
    if (!isAllowedTarget(target)) return jsonError('Target host is not an allowed Stremio stream source', 403);
    const href = target.href;

    // Lightweight capability ping for the player UI (cache-warm, one GET).
    if (searchParams.get('ping') === '1') {
      const probe = await probeTarget(href);
      return new NextResponse(JSON.stringify({
        ok: true,
        seekable: Boolean(probe.seekable || (probe.size && !probe.supportsRange)),
        nativeRange: probe.supportsRange,
        emulatedRange: Boolean(probe.size && !probe.supportsRange),
        sizeBytes: probe.size,
      }), { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    const probe = await probeTarget(href);
    const clientRange = request.headers.get('range') || '';
    const range = parseRangeHeader(clientRange, probe.size);

    if (range?.unsatisfiable) {
      const headers = new Headers(CORS_HEADERS);
      headers.set('Content-Range', `bytes */${probe.size}`);
      return new Response(null, { status: 416, headers });
    }

    // Fast path: upstream honours Range — stream straight through.
    if (probe.supportsRange) {
      const upstreamHeaders = new Headers({ Accept: request.headers.get('accept') || '*/*' });
      if (clientRange) upstreamHeaders.set('Range', clientRange);
      const upstream = await fetch(href, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        cache: 'no-store',
        redirect: 'follow',
      });
      const headers = new Headers();
      const length = Number(upstream.headers.get('content-length'));
      copyMediaHeaders(upstream.headers, headers, {
        length: Number.isFinite(length) ? length : undefined,
        contentRange: upstream.headers.get('content-range') || undefined,
        contentType: looksLikeVideo(href, upstream.headers.get('content-type') || '') ? (upstream.headers.get('content-type') || 'video/mp4') : undefined,
        seekable: true,
      });
      return new Response(request.method === 'HEAD' ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    // Chunk mode (telegram-style sequential stream).
    if (!probe.size) {
      // Size unknown → pass through untouched; seeking is impossible but
      // linear play still works, and the banner can say why.
      const upstream = await fetch(href, { cache: 'no-store', redirect: 'follow' });
      const headers = new Headers();
      copyMediaHeaders(upstream.headers, headers, { seekable: false });
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    const start = range ? range.start : 0;
    if (start >= probe.size) {
      const headers = new Headers(CORS_HEADERS);
      headers.set('Content-Range', `bytes */${probe.size}`);
      return new Response(null, { status: 416, headers });
    }
    const end = range?.end ?? probe.size - 1;
    const length = end - start + 1;

    const { upstream, body } = await openSkippedStream(href, start);
    if (!body) {
      return jsonError(`Upstream stream failed (HTTP ${upstream?.status || '?'})`, 502);
    }
    const headers = new Headers();
    copyMediaHeaders(upstream.headers, headers, {
      length,
      contentRange: `bytes ${start}-${end}/${probe.size}`,
      contentType: looksLikeVideo(href, upstream.headers.get('content-type') || '') ? (upstream.headers.get('content-type') || 'video/mp4') : undefined,
      seekable: true,
    });
    headers.set('X-Seek-Mode', 'emulated');
    const isPartial = start > 0 || end < probe.size - 1;
    return new Response(request.method === 'HEAD' ? null : body, {
      status: isPartial ? 206 : 200,
      headers,
    });
  } catch (error) {
    console.error('[api/stream-proxy] failed:', error);
    return jsonError(error.message || 'Stream proxy failed', 502);
  }
}

function jsonError(message, status = 500) {
  return new NextResponse(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
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
