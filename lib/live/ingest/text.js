// Pure text/URL/format helpers shared across the live ingest pipeline.
// Split from the former lib/liveTv.js god module (phase 1) — behaviour unchanged.

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHttpUrl(value = '') {
  const raw = normalizeWhitespace(value);
  if (!raw) return '';

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    // M3U providers sometimes put cookie/header payload in a URL fragment
    // (example: index.mpd?#__hdnea__=...&xxx=%7Ccookie=...). Fragments are
    // never sent to the CDN and they break token injection, so keep the real
    // playable URL clean and store cookies/headers separately.
    parsed.hash = '';
    return parsed.href.replace(/\?$/, '');
  } catch {
    return '';
  }
}

function slugify(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'channel';
}

function detectFormat(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('/m3u/') || lower.includes('/m3u?')) return 'hls';
  if (lower.includes('.mpd') || lower.includes('mpd.php') || lower.includes('/mpd/') || lower.includes('/mpd?')) return 'dash';
  if (/\.(mp4|webm|ogg|ts)(\?|$)/i.test(lower) || /live\.ts(\?|$)/i.test(lower)) return 'video';
  if (lower.includes('/hls/') || lower.includes('playlist')) return 'hls';
  return 'unknown';
}

function detectSourceType(url = '') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.json')) return 'json';
  if (lower.includes('.m3u') || lower.endsWith('.txt') || lower.includes('/zoh.txt')) return 'm3u';
  return 'json';
}

function parseAttrs(value = '') {
  const attrs = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function cleanChannelName(value = '') {
  return normalizeWhitespace(value)
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\s+\[(?:Tata Play|OTTLive|YuppTV|DistroTV|Phoenix|Cloud7)\]$/i, '')
    .trim();
}

export {
  cleanChannelName,
  detectFormat,
  detectSourceType,
  normalizeHttpUrl,
  normalizeWhitespace,
  parseAttrs,
  slugify,
};
