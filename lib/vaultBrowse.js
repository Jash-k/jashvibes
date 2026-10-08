// Client-safe browsing classification only; never rewrites playback kind or episode identity.
export const VAULT_TABS = [
  { id: 'tamil-movie', label: 'Tamil Movies' },
  { id: 'tamil-dubbed-movie', label: 'Dubbed Movies' },
  { id: 'tamil-series', label: 'Tamil Series' },
  { id: 'tamil-dubbed-series', label: 'Dubbed Series' },
];
export function vaultCategory(item = {}) {
  const category = String(item.category || '').toLowerCase();
  const language = String(item.language || item.originalLanguage || '').trim().toLowerCase();
  const knownCategory = VAULT_TABS.some((tab) => tab.id === category);
  const series = knownCategory ? category.endsWith('-series') : Boolean(item.isSeries || item.kind === 'series');
  // Language metadata wins over a conflicting upstream Tamil-original bucket.
  // Do not infer original language from a title's script or English spelling.
  const tamil = ['ta', 'tam', 'tamil'].includes(language);
  const unknown = !language || ['unknown', 'und', 'null'].includes(language);
  if (!unknown) return `${tamil ? 'tamil' : 'tamil-dubbed'}-${series ? 'series' : 'movie'}`;
  // Incomplete metadata may still have an explicit catalogue classification.
  if (knownCategory) return category;
  if (item.origin === 'tamil' || item.origin === 'dubbed') return `${item.origin === 'tamil' ? 'tamil' : 'tamil-dubbed'}-${series ? 'series' : 'movie'}`;
  return 'unclassified';
}
export function vaultUpdatedTime(item = {}) {
  const updated = Date.parse(item.updatedAt || '');
  if (Number.isFinite(updated)) return updated;
  const added = Date.parse(item.addedAt || '');
  return Number.isFinite(added) ? added : 0;
}
export function latestVaultFirst(a, b) {
  // Stable sort preserves JSON order for tied or absent timestamps.
  return vaultUpdatedTime(b) - vaultUpdatedTime(a);
}
