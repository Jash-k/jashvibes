// Client-safe browsing classification only; never rewrites playback kind or episode identity.
export const VAULT_TABS = [
  { id: 'tamil-movie', label: 'Tamil Movies' },
  { id: 'tamil-dubbed-movie', label: 'Dubbed Movies' },
  { id: 'tamil-series', label: 'Tamil Series' },
  { id: 'tamil-dubbed-series', label: 'Dubbed Series' },
];
export function vaultCategory(item = {}) {
  const category = String(item.category || '').toLowerCase();
  if (VAULT_TABS.some((tab) => tab.id === category)) return category;
  const origin = item.origin || (item.language === 'ta' ? 'tamil' : item.language ? 'dubbed' : 'unknown');
  if (origin === 'unknown') return 'unclassified';
  return `${origin === 'dubbed' ? 'tamil-dubbed' : 'tamil'}-${item.isSeries || item.kind === 'series' ? 'series' : 'movie'}`;
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
