import { NextResponse } from 'next/server';
import { loadSourcePage } from '@/lib/animeTamilFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/anime/tamil/page?u=/episode/<slug>` — one page of the source, sanitized and served by us.
 *
 * This exists because a cross-origin frame cannot be cleaned by anybody: put `piratexplay.cc` in an
 * `iframe` and their ad scripts, their pop-under and their `beforeunload` reload all run, and the app can
 * only wrap the frame in a `sandbox` attribute. Serving the document from this origin is what makes the
 * surgery possible — the ad hosts' script tags are removed before the bytes reach the browser, their
 * chrome is hidden by a stylesheet we control, and `window.open` is stubbed.
 *
 * Two things it deliberately is not: a proxy for video (an HLS file still goes from the host's CDN to the
 * browser, so this server never carries media bytes) and a general URL fetcher (`loadSourcePage` accepts a
 * path on the configured site and nothing else, the same guard the other routes use).
 *
 * The response is CSP-sandboxed, which makes it an opaque origin: the scripts inside it cannot read this
 * app's `localStorage`, where the access token lives. That is why the frame can run their player without
 * running *as* us.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = String(searchParams.get('u') || '').slice(0, 300);
  if (!path) return new NextResponse('u required', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  try {
    const page = await loadSourcePage({ path, force: searchParams.get('force') === '1' });
    if (!page?.ok || !page.html) {
      const why = page?.error || 'the source page could not be read';
      return new NextResponse(
        `<!doctype html><meta charset="utf-8"><title>not loaded</title>`
        + `<body style="font:14px/1.6 ui-sans-serif,system-ui;color:#e8e8ef;background:#0b0b10;padding:22px">`
        + `<p>${escapeHtml(why)}</p><p style="opacity:.7">This is the app's sanitized view of one page of the source. `
        + `Nothing was cached for it, so try again in a moment or open it on the source itself.</p></body>`,
        { status: 502, headers: HTML_HEADERS({ 'cache-control': 'no-store' }) },
      );
    }
    return new NextResponse(page.html, {
      headers: HTML_HEADERS({
        'cache-control': `public, max-age=${Math.floor((page.ttlMs || 600000) / 1000)}`,
        'x-jash-dropped': String(page.dropped || 0),
      }),
    });
  } catch (error) {
    return new NextResponse(`<!doctype html><meta charset="utf-8"><title>not loaded</title><body>${escapeHtml(error?.message || 'failed')}</body>`, {
      status: 500,
      headers: HTML_HEADERS({ 'cache-control': 'no-store' }),
    });
  }
}

function HTML_HEADERS(extra = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    // Frameable by us and nobody else…
    'x-frame-options': 'SAMEORIGIN',
    // …and run in an opaque origin even by us, so the page cannot reach our storage.
    'content-security-policy': [
      'sandbox allow-scripts allow-forms allow-pointer-lock',
      "default-src 'none'",
      // Their own site, the player hosts, and anything inline they need to lay the page out.
      'script-src https: \'unsafe-inline\' \'unsafe-eval\' blob:',
      'style-src https: \'unsafe-inline\'',
      'img-src https: data: blob:',
      'media-src https: blob: data:',
      'font-src https: data:',
      'connect-src https: blob: ws: wss:',
      'worker-src blob: https:',
      'frame-src https:',
      "form-action 'none'",
      "frame-ancestors 'self'",
      "manifest-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'autoplay=(self), fullscreen=(self), microphone=(), camera=(), geolocation=()',
    ...extra,
  };
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
