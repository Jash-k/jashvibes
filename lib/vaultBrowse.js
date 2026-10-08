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
  // Metadata-backed only: a published bucket alone is not evidence of origin.
  // Missing language and category/language conflicts require review, not guessing.
  const tamil = ['ta', 'tam', 'tamil'].includes(language);
  const unknown = !language || ['unknown', 'und', 'null', 'none', 'n/a'].includes(language);
  if (unknown) return 'unverified';
  if (knownCategory) {
    const categoryTamil = category === 'tamil-movie' || category === 'tamil-series';
    if (categoryTamil !== tamil) return 'unverified';
  }
  return `${tamil ? 'tamil' : 'tamil-dubbed'}-${series ? 'series' : 'movie'}`;
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
