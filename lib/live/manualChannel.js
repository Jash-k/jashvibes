/**
 * lib/live/manualChannel.js — validation for owner-authored live channels.
 * Pure helpers shared by the Admin CRUD route and its tests (no Next/server
 * imports, so plain Node can exercise them).
 */

export function cleanHttpUrl(value = '') {
  try {
    const parsed = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

export function detectManualFormat(url = '', hint = '') {
  const wanted = String(hint || '').toLowerCase();
  if (['hls', 'dash', 'video', 'unknown'].includes(wanted)) return wanted;
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mpd')) return 'dash';
  if (lower.includes('.m3u8') || lower.includes('m3u8')) return 'hls';
  if (/\.(mp4|webm|mkv|ts)(\?|#|$)/.test(lower)) return 'video';
  return 'unknown';
}
