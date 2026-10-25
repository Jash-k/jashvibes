/**
 * lib/live/preview.js — adapt an admin LiveChannel row to the logical-group
 * shape LivePlayerV13 consumes, so Admin → Preview runs the exact same
 * resolve/policy/fallback stack as the public /live page (no second player
 * implementation, no mocked stream).
 *
 * Pure and side-effect free: one stored channel becomes a one-variant logical
 * group whose variant carries every field the resolve API and playback policy
 * read (URL, DRM keys, cookie, headers).
 */
export function channelDocToLogicalGroup(channel = {}) {
  const variant = {
    channelId: channel.channelId || channel.id || '',
    sourceId: channel.sourceId || 'manual',
    sourceLabel: channel.source || channel.sourceId || 'Manual',
    url: channel.url || '',
    format: String(channel.format || 'unknown').toLowerCase(),
    playable: channel.playable !== false,
    keyId: channel.keyId || '',
    key: channel.key || '',
    licenseKey: channel.licenseKey || '',
    licenseType: channel.licenseType || '',
    cookie: channel.cookie || '',
    userAgent: channel.userAgent || '',
    referer: channel.referer || '',
    headers: channel.headers && typeof channel.headers === 'object' ? channel.headers : {},
    workingStatus: channel.workingStatus || 'unknown',
    tvgId: channel.tvgId || '',
    catalogs: Array.isArray(channel.catalogs) ? channel.catalogs : [],
    catalogIds: Array.isArray(channel.catalogIds)
      ? channel.catalogIds
      : (Array.isArray(channel.catalogs)
        ? channel.catalogs.map((item) => (typeof item === 'string' ? item : item?.catalogId)).filter(Boolean)
        : []),
    order: Number.isFinite(Number(channel.order)) ? Number(channel.order) : 9999,
  };
  return {
    logicalId: channel.channelId || channel.id || `preview-${channel.name || 'channel'}`,
    displayName: channel.customName || channel.name || 'Channel preview',
    baseName: channel.name || '',
    name: channel.name || '',
    logo: channel.customLogo || channel.logo || '',
    category: channel.category || 'Live',
    language: channel.language || '',
    variants: [variant],
    best: variant,
    variantCount: 1,
    sourceIds: [variant.sourceId],
  };
}
