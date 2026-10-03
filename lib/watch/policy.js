// Client-safe, deterministic VOD entry and provider policy. Live/music use other policies.
export const WATCH_PROVIDERS = [
  { id: 'vault', name: 'Vault' }, { id: 'retro', name: 'ReTro' },
  { id: 'stremio', name: 'Stremio' }, { id: 'mp4', name: 'Direct MP4' }, { id: 'mirchi', name: 'Mirchi' },
];
export const MAX_PROVIDER_ALTERNATIVES = 3;
/** ok → unknown → dead. Absent health counts as unknown, never as dead. */
const HEALTH_RANK = { ok: 0, unknown: 1, dead: 2 };
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
  }).filter((item) => { if (seen.has(item.url)) return false; seen.add(item.url); return true; })
    // Direct-link candidates carry a health verdict from the resolver's probe
    // (lib/moviesda/resolve.js). Dead ones sort last so "Auto" and "Next source"
    // walk the living hosts before the dead ones. Providers that have no health
    // information — vault, stremio, mirchi — all rank equal and keep the plain
    // quality ordering they had before: Array.prototype.sort is stable.
    .sort((a, b) => (HEALTH_RANK[a.health] ?? 1) - (HEALTH_RANK[b.health] ?? 1)
      || parseInt(b.quality || 0, 10) - parseInt(a.quality || 0, 10));
}
/**
 * Which candidate does "Auto" open?
 *
 * Two rules now, in order: honour the requested quality, and never auto-open a
 * host that refused. Before health existed the answer was purely positional, so a
 * viewer who had ever picked 1080p would be sent to a dead 1080p host while a
 * working 720p sat right below it. Health comes from the resolver's probe
 * (lib/moviesda/resolve.js) and is absent for vault/stremio/mirchi candidates,
 * which keeps this function's original behaviour for every provider that has no
 * probe — `item.health !== 'dead'` is true when health is undefined.
 */
export function chooseCandidate(items, quality = '') {
  const usable = (item) => item.health !== 'dead';
  const wanted = quality ? items.findIndex((item) => item.quality && item.quality === quality && usable(item)) : -1;
  if (wanted >= 0) return wanted;
  const firstUsable = items.findIndex(usable);
  if (firstUsable >= 0) return firstUsable;
  // Everything refused: fall back to the old rule rather than to nothing.
  return quality ? Math.max(0, items.findIndex((item) => item.quality === quality)) : 0;
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
