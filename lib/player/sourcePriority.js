export { providerOrder, WATCH_PROVIDERS } from '@/lib/watch/policy';
export function sourceRank(item = {}) { const p = String(item.provider || item.source || '').toLowerCase(); if (p.includes('vault')) return 0; if (p.includes('stremio')) return 1; if (p.includes('mirchi')) return 3; return item.type === 'iframe' || item.format === 'embed' ? 9 : 2; }
export function orderBySourcePriority(items = []) { return items.map((item, i) => ({ item, i })).sort((a, b) => sourceRank(a.item) - sourceRank(b.item) || a.i - b.i).map((v) => v.item); }
