import { getStremioStreams } from '@/lib/stremioAddon';

// The addon fetches can wait up to DEFAULT_TIMEOUT_MS (3 min) internally,
// which would stall Auto Priority. Enforce our own shorter budget; the
// underlying fetch keeps running harmlessly in the background.
const AUTO_TIMEOUT_MS = Number(process.env.STREMIO_WATCH_AUTO_TIMEOUT_MS || 15000);
const MANUAL_TIMEOUT_MS = Number(process.env.STREMIO_WATCH_TIMEOUT_MS || 25000);

function withTimeout(promise, ms, message) {
  let timer;
  const raced = Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
  return raced.finally(() => clearTimeout(timer));
}

/** Parse container/codec/audio/part info out of an addon stream entry. */
function analyzeStream(stream = {}) {
  const text = `${stream.name || ''} ${stream.title || ''} ${stream.label || ''}`.toLowerCase();
  const url = String(stream.url || '').toLowerCase();

  const container = /\.mp4(\?|$|%)|\bmp4\b/.test(url) || /\bmp4\b/.test(text)
    ? 'mp4'
    : /\.mkv/.test(url) || /\bmkv\b/.test(text)
      ? 'mkv'
      : /\.m3u8/.test(url)
        ? 'hls'
        : '';

  const video = /x265|h\.?265|hevc/.test(text) ? 'hevc' : /x264|h\.?264|avc/.test(text) ? 'h264' : '';

  let audio = '';
  if (/\baac\b/.test(text)) audio = 'aac';
  else if (/e-?ac-?3|ddp\b|dd\+|dolby\s*digital\s*plus/.test(text)) audio = 'eac3';
  else if (/\bac-?3\b|dolby\s*digital/.test(text)) audio = 'ac3';
  else if (/dts|truehd|atmos|lpcm|flac/.test(text)) audio = 'hd';

  // Telegram uploads are often split into Part001/Part002 files. The release
  // note form is "[ PART-1 of 6.1GB ]" (the number after "of" is a SIZE, not a
  // part count), so treat any explicit part marker as "split release".
  const partText = text.match(/part\s*-?\s*0*(\d{1,2})\s*(?:of|\/)/);
  const partFile = decodeURIComponent(url).match(/part\s*-?\s*0*(\d{1,3})\s*\.(?:mkv|mp4|avi|m4v|ts)/);
  const partIndex = partText ? Number(partText[1]) : partFile ? Number(partFile[1]) : 0;

  const height = Number((text.match(/\b(2160|1440|1080|720|576|540|480|360|240)p\b/) || [])[1] || 0);

  return {
    container,
    video,
    audio,
    height,
    isSplitRelease: partIndex > 0,
    isLaterPart: partIndex > 1,
  };
}

/**
 * Rank streams for in-browser playback (the addon's own order only knows
 * quality). mp4/x264/AAC full files win; HEVC/E-AC3/12GB remuxes and split
 * parts sink. Later parts of a split release are never auto-picked.
 */
function browserScore(stream = {}) {
  const tech = analyzeStream(stream);
  let score = Number(stream.qualityScore || 0);

  if (tech.container === 'mp4') score += 35;
  else if (tech.container === 'hls') score += 28;
  else if (tech.container === 'mkv') score += 6;
  else score += 12;

  if (tech.video === 'h264') score += 30;
  else if (tech.video === 'hevc') score += 6;
  else score += 15;

  if (tech.audio === 'aac') score += 30;
  else if (tech.audio === 'ac3') score += 18;
  else if (tech.audio === 'eac3') score += 5;
  else if (tech.audio === 'hd') score += 0;
  else score += 12;

  const sizeGB = Number(stream.sizeBytes || 0) / 1_073_741_824;
  if (sizeGB >= 0.4 && sizeGB <= 4.5) score += 10;
  else if (sizeGB > 12) score -= 12;

  if (tech.isLaterPart) score -= 1000;
  else if (tech.isSplitRelease) score -= 40;

  return score;
}

function qualityTag(stream = {}) {
  const fromName = `${stream.name || ''} ${stream.title || ''}`.match(/\b(2160p|1440p|1080p|720p|576p|540p|480p|4k)\b/i)?.[1];
  return fromName ? fromName.toUpperCase() : 'HD';
}

/**
 * Resolve the Stremio addon's streams for a TMDB title and pick the most
 * browser-friendly one (a specific stream can be forced via `streamId`).
 * Returns a provider-shaped object compatible with the embed providers so the
 * watch page can treat Stremio like any other server.
 */
export async function resolveStremioProvider({ tmdbId, type = 'movie', season = 1, episode = 1, streamId = '', mode = 'auto' } = {}) {
  const normalizedType = type === 'series' || type === 'tv' ? 'series' : 'movie';
  const timeoutMs = mode === 'manual' ? MANUAL_TIMEOUT_MS : AUTO_TIMEOUT_MS;

  const payload = await withTimeout(
    getStremioStreams({ type: normalizedType, id: `tmdb:${tmdbId}`, source: 'watch', season, episode }),
    timeoutMs,
    `Stremio addon did not answer within ${Math.round(timeoutMs / 1000)}s.`,
  );

  const streams = payload?.streams || [];
  if (!streams.length) {
    throw new Error(
      normalizedType === 'series'
        ? `Your Stremio addon has no stream for S${season} E${episode} of this series.`
        : 'Your Stremio addon has no stream for this title.',
    );
  }

  const ranked = streams
    .map((stream) => ({ ...stream, score: browserScore(stream) }))
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore || a.sizeBytes - b.sizeBytes);

  const chosen = (streamId && ranked.find((stream) => stream.id === streamId)) || ranked[0];
  const quality = qualityTag(chosen);

  return {
    id: 'stremio',
    providerId: 'stremio',
    provider: 'Stremio',
    label: `Stremio${quality === 'HD' ? '' : ` ${quality}`}${chosen.size ? ` • ${chosen.size}` : ''}`,
    streamUrl: chosen.url,
    streamType: 'direct',
    fallbacks: ranked.filter((stream) => stream.id !== chosen.id).map((stream) => stream.url).slice(0, 10),
    availableStreams: ranked.map((stream) => ({
      id: stream.id,
      label: stream.label,
      url: stream.url,
      size: stream.size || '',
    })),
    selectedStreamId: chosen.id,
    externalId: `stremio:${normalizedType}:${tmdbId}:s${season}:e${episode}`,
    health: null,
    count: ranked.length,
  };
}

export function createStremioAttempt(result, status = 'configured', reason = '') {
  return {
    providerId: 'stremio',
    provider: 'Stremio',
    label: result?.label || 'Direct file streams from your Stremio addon',
    status,
    reason,
    streamUrl: result?.streamUrl || '',
    fallbacks: result?.fallbacks || [],
    health: null,
  };
}
