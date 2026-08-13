export const LIVE_CATALOGS = Object.freeze([
  { id: 'main', name: 'MainCH', icon: '★', color: 'red', order: 0 },
  { id: 'music', name: 'Music', icon: '♫', color: 'fuchsia', order: 1 },
  { id: 'local', name: 'LocalCH', icon: '⌂', color: 'cyan', order: 2 },
  { id: 'sports', name: 'Sports', icon: '⚽', color: 'green', order: 3 },
  { id: 'kids', name: 'Kids', icon: '☻', color: 'yellow', order: 4 },
  { id: 'others', name: 'Others', icon: '•••', color: 'zinc', order: 5 },
]);

export const LIVE_CATALOG_IDS = Object.freeze(LIVE_CATALOGS.map((catalog) => catalog.id));

const CATALOG_BY_ID = new Map(LIVE_CATALOGS.map((catalog) => [catalog.id, catalog]));

export function isLiveCatalogId(value = '') {
  return CATALOG_BY_ID.has(String(value || '').trim().toLowerCase());
}

export function getLiveCatalog(value = '') {
  return CATALOG_BY_ID.get(String(value || '').trim().toLowerCase()) || null;
}

export function normalizeCatalogMemberships(value = []) {
  const input = Array.isArray(value) ? value : [];
  const map = new Map();

  for (const item of input) {
    const catalogId = String(typeof item === 'string' ? item : item?.catalogId || item?.id || '')
      .trim()
      .toLowerCase();
    if (!isLiveCatalogId(catalogId)) continue;

    const rawPosition = Number(typeof item === 'object' ? item.position : 9999);
    const position = Number.isFinite(rawPosition) ? Math.max(0, Math.round(rawPosition)) : 9999;
    const current = map.get(catalogId);
    if (!current || position < current.position) map.set(catalogId, { catalogId, position });
  }

  return [...map.values()].sort((a, b) => {
    const catalogOrder = (getLiveCatalog(a.catalogId)?.order ?? 99) - (getLiveCatalog(b.catalogId)?.order ?? 99);
    return catalogOrder || a.position - b.position;
  });
}

export function getChannelCatalogs(channel = {}) {
  return normalizeCatalogMemberships(channel.catalogs || channel.catalogMemberships || []);
}

export function getChannelCatalogIds(channel = {}) {
  if (Array.isArray(channel.catalogIds)) {
    return [...new Set(channel.catalogIds.map((item) => String(item || '').toLowerCase()).filter(isLiveCatalogId))];
  }
  return getChannelCatalogs(channel).map((item) => item.catalogId);
}

export function isChannelMapped(channel = {}) {
  return getChannelCatalogIds(channel).length > 0;
}

export function getCatalogPosition(channel = {}, catalogId = '') {
  const memberships = getChannelCatalogs(channel);
  if (catalogId && catalogId !== 'all') {
    return memberships.find((item) => item.catalogId === catalogId)?.position ?? 999999;
  }
  return memberships.reduce((lowest, item) => Math.min(lowest, item.position), 999999);
}

export function catalogLabel(catalogId = '') {
  return getLiveCatalog(catalogId)?.name || catalogId || 'Unmapped';
}

export function sortChannelsForCatalog(channels = [], catalogId = 'all') {
  return [...(channels || [])].sort((a, b) => {
    if (catalogId === 'all') {
      const aFirst = getChannelCatalogs(a)[0];
      const bFirst = getChannelCatalogs(b)[0];
      const catalogDiff = (getLiveCatalog(aFirst?.catalogId)?.order ?? 99) - (getLiveCatalog(bFirst?.catalogId)?.order ?? 99);
      if (catalogDiff) return catalogDiff;
    }

    const positionDiff = getCatalogPosition(a, catalogId) - getCatalogPosition(b, catalogId);
    if (positionDiff) return positionDiff;
    const favoriteDiff = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
    if (favoriteDiff) return favoriteDiff;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export function buildCatalogSummary(channels = []) {
  return LIVE_CATALOGS.map((catalog) => ({
    ...catalog,
    count: (channels || []).filter((channel) => getChannelCatalogIds(channel).includes(catalog.id)).length,
  }));
}
