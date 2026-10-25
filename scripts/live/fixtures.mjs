/** Shared channel/doc fixtures for the live contract suites. */
export const ch = (name, category = 'Entertainment', extra = {}) => ({ name, category, sourceId: 'iptv-org-tamil', ...extra });

export const doc = (over) => ({
  channelId: `d${Math.random().toString(36).slice(2, 8)}`, sourceId: 'iptv-org-tamil',
  name: 'X', normalizedName: 'x', category: 'Entertainment', url: 'https://e.test/a.m3u8',
  format: 'hls', playable: true, hidden: false, catalogs: [], headers: {}, ...over,
});
