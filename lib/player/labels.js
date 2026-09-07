/**
 * Small display helpers shared by every player surface (and the catalogue
 * cards that label Stremio files). Kept pure so they are testable and so the
 * labels stop drifting per page.
 */

export function fmtTime(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtClock(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  return new Date(value * 1000).toISOString().slice(11, 19);
}

export function fmtSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

/**
 * "…/Thalaivan.1080p.WEBRip.x264.2.9GB.ESub.mkv ⁍ Quality : 1080p" → "1080p 2.9GB"
 * Telegram/Stremio URLs embed the release name, and their trailing descriptive
 * text sits *after* the extension, so match mid-path.
 */
export function parseUrlSourceLabel(url = '') {
  try {
    const text = decodeURIComponent(String(url || '')).replace(/[_-]+/g, ' ');
    const resolution =
      text.match(/\b(?:2160p|1440p|1080p|720p|576p|540p|480p|360p|240p)\b/i)?.[0] ||
      (/\b(?:4k|uhd)\b/i.test(text) ? '4K' : '');
    // Bounded on purpose: an unbounded [\d.]+ swallows the encoder prefix in
    // “x264.2.9GB” and prints a 264 GB file.
    const size = text.match(/\b(\d{1,3}(?:\.\d{1,2})?)\s?(GB|MB|TB)\b/i)?.slice(1).join('').toUpperCase() || '';
    const normalized = resolution ? (/^4k$/i.test(resolution) ? '4K' : resolution) : '';
    return [normalized, size].filter(Boolean).join(' ');
  } catch {
    return '';
  }
}

/** Height in px for a label like "1080p" / "4K" (0 = unknown). */
export function heightFromLabel(label = '') {
  const text = String(label || '');
  const direct = text.match(/\b(\d{3,4})p\b/i)?.[1];
  if (direct) return Number(direct);
  if (/\b(?:4k|uhd|2160)\b/i.test(text)) return 2160;
  return 0;
}

/**
 * Build the source picker list.
 * `streams` are the resolver's own labels (Stremio meta), `urls` the playable
 * alternatives; labels fall back to the URL filename, then "Source N".
 */
export function buildSourceList({ urls = [], streams = [], labelFor } = {}) {
  return (urls || [])
    .filter(Boolean)
    .map((url, index) => {
      const matched = (streams || []).find((stream) => stream && (stream.url === url || stream.streamUrl === url));
      const metaLabel = matched
        ? [matched.title, matched.name, matched.behaviorHints?.bingeGroup, matched.quality, matched.label]
            .filter(Boolean)
            .join(' • ')
            .replace(/\s+/g, ' ')
        : '';
      const custom = typeof labelFor === 'function' ? labelFor(url, index, matched) : '';
      return { url, index, label: metaLabel || custom || parseUrlSourceLabel(url) || `Source ${index + 1}` };
    });
}

/** Codec warnings before the user commits to a 12 GB remux. */
const UNBROWSER_FRIENDLY = [
  { test: /\b(?:hevc|x265|h\.?265)\b/i, label: 'HEVC', note: 'HEVC may not decode on many Android/Windows browsers' },
  { test: /\be-?ac-?3|ddp|dd\+/i, label: 'E-AC3', note: 'Dolby Digital Plus audio can be silent in Chrome without a decoder' },
  { test: /\bdts|truehd|atmos/i, label: 'DTS/TrueHD', note: 'DTS/TrueHD audio usually plays without sound in browsers' },
  { test: /\.(?:mkv|webm)/i, label: 'Matroska', note: 'MKV cannot be demuxed by the browser reliably' },
];

export function warnForSource({ url = '', label = '', name = '', title = '' } = {}) {
  const haystack = `${url} ${label} ${name} ${title}`;
  const hits = UNBROWSER_FRIENDLY.filter((item) => item.test.test(haystack));
  return { risky: hits.length > 0, tags: hits.map((item) => item.label), notes: hits.map((item) => item.note) };
}
