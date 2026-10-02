// Client-safe, deterministic VOD entry and provider policy. Live/music use other policies.
export const WATCH_PROVIDERS = [
  { id: 'vault', name: 'Vault' }, { id: 'retro', name: 'ReTro' },
  { id: 'stremio', name: 'Stremio' }, { id: 'mp4', name: 'Direct MP4' }, { id: 'mirchi', name: 'Mirchi' },
];
export const MAX_PROVIDER_ALTERNATIVES = 3;
export function providerOrder(origin = 'home') {
  const base = ['vault', 'stremio', 'mp4', 'mirchi'];
  return [...new Set(origin === 'retro' ? ['retro', ...base] : origin === 'stremio' ? ['stremio', ...base] : base)];
}
export function resolutionOf(item = {}) {
  const value = `${item.quality || ''} ${item.label || ''} ${item.name || ''}`;
  const p = value.match(/\b(2160|1440|1080|720|576|540|480|360|240)p\b/i);
  if (p) return `${p[1]}p`;
  return /\b4k\b|\buhd\b/i.test(value) ? '2160p' : '';
}
export function normalizeCandidates(items = [], provider = '') {
  const seen = new Set();
  return items.filter((item) => item && /^https?:\/\//i.test(item.url || item.streamUrl || '')).map((item, index) => {
    const url = item.url || item.streamUrl;
    const embed = provider === 'vault' || provider === 'mirchi' || item.type === 'iframe' || item.kind === 'embed';
    return { ...item, url, id: item.id || `${provider}:${index}`, provider, kind: embed ? 'embed' : item.kind || '', quality: resolutionOf(item), label: item.label || item.quality || item.source || `${provider} stream ${index + 1}` };
  }).filter((item) => { if (seen.has(item.url)) return false; seen.add(item.url); return true; }).sort((a, b) => parseInt(b.quality || 0, 10) - parseInt(a.quality || 0, 10));
}
export function chooseCandidate(items, quality = '') {
  return items.findIndex((item) => item.quality && item.quality === quality) >= 0 ? items.findIndex((item) => item.quality === quality) : 0;
}
export function watchHref(item = {}, origin = 'home') {
  const q = new URLSearchParams({ origin });
  if (item.title) q.set('title', item.title);
  if (item.year || item.releaseDate) q.set('year', String(item.year || item.releaseDate).slice(0, 4));
  if (item.posterUrl || item.poster) q.set('poster', item.posterUrl || item.poster);
  if (item.imdbId) q.set('imdbId', item.imdbId);
  if (item.season) q.set('season', String(item.season));
  if (item.episode) q.set('episode', String(item.episode));
  const series = item.isSeries || item.type === 'series' || item.type === 'tv';
  q.set('mediaType', series ? 'series' : 'movie');
  if (origin === 'vault') return `/watch/vault/${encodeURIComponent(item.id)}?${q}`;
  if (origin === 'retro') return `/watch/retro/${encodeURIComponent(item.id)}?${q}`;
  if (origin === 'stremio') return `/watch/stremio-${series ? 'series' : 'movie'}/${encodeURIComponent(item.id)}?${q}`;
  if (item.tmdbId) return `/watch/${series ? 'series' : 'movie'}/${item.tmdbId}?${q}`;
  return `/watch/home/${encodeURIComponent(item.id || item.slug || 'unmatched')}?${q}`;
}
export function parseIdentity(value = '') {
  const input = String(value).trim();
  const imdbId = input.match(/\btt\d+\b/i)?.[0]?.toLowerCase() || '';
  const tmdb = input.match(/(?:movie|tv)\/(\d+)/i)?.[1] || input.match(/^(?:tmdb:)?(\d+)$/i)?.[1] || '';
  return { tmdbId: tmdb ? Number(tmdb) : null, imdbId, type: /\/tv\//i.test(input) ? 'series' : '' };
}
