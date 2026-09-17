/*
 * lib/player/playlistRewrite.js — the HLS proxy's playlist rewriter.
 *
 * A CORS-less CDN (FanCode, SonyLiv) cannot be played by any browser directly:
 * the master may answer, but the first variant request dies on CORS. The fix is
 * a proxy that does not just pipe bytes — it rewrites the playlist so EVERY
 * child (variants, audio, keys, segments) routes back through the proxy, which
 * can set the headers a browser may not and answers with CORS open.
 *
 * Pure module: text in, text out. Both proxies (`/api/live-proxy` and the
 * user's own Cloudflare Worker, `docs/STREAM-WORKER.md`) use the same rules.
 */

const PLAYLIST_RX = /\.(m3u8)(\?|#|$)/i;

/** True when this upstream response should be treated as an HLS playlist. */
export function isPlaylistResponse({ url = '', contentType = '' } = {}) {
  if (/mpegurl/i.test(String(contentType))) return true;
  return PLAYLIST_RX.test(String(url || '').split('#')[0]);
}

/**
 * Rewrite a playlist so every child rides `wrap(url)` (the proxy).
 *
 * Rules the field taught us:
 *  - `#EXT-X-MEDIA:...URI="…"` and `#EXT-X-I-FRAME-STREAM-INF:...URI="…"` are
 *    children too, quoted inside the tag.
 *  - A child with no query of its own inherits the parent's: SonyLiv signs the
 *    master with `?hdnea=…` (acl `/*`), names children relatively, and a
 *    relative resolve drops the query — left alone the master loads and every
 *    variant 403s. Children that carry their own query were signed separately
 *    and are left untouched (beyond absolutising).
 *  - A non-OK upstream is never rewritten as if it were a playlist: an Akamai
 *    refusal is an HTML page, and wrapping its lines produced a 200-looking
 *    manifest full of nonsense instead of the actual reason.
 */
export function rewritePlaylist(text = '', { baseUrl = '', wrap = (u) => u } = {}) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return String(text || '');
  }
  const parentQuery = base.search;
  const toAbs = (ref) => {
    let u;
    try {
      u = new URL(ref, base);
    } catch {
      return null;
    }
    if (!u.search && parentQuery) u.search = parentQuery;
    return u.toString();
  };
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (whole, uri) => {
          const abs = toAbs(uri);
          return abs ? `URI="${wrap(abs)}"` : whole;
        });
      }
      const abs = toAbs(trimmed);
      return abs ? wrap(abs) : line;
    })
    .join('\n');
}
