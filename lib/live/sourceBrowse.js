import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';

// Each card belongs to exactly one admin source, including in All Sources.
// Never leak another provider's variants into a selected source's playback.
export function sourceBrowseGroups(groups = [], sources = []) {
  const enabled = new Map(sources.map(s => [s.id, s]));
  const out = [];
  for (const group of groups) {
    const buckets = new Map();
    for (const variant of group.variants || []) {
      if (!enabled.has(variant.sourceId)) continue;
      if (!buckets.has(variant.sourceId)) buckets.set(variant.sourceId, []);
      buckets.get(variant.sourceId).push({ ...variant, sourceLabel: enabled.get(variant.sourceId).label });
    }
    for (const [sourceId, variants] of buckets) {
      out.push({ ...group, parentLogicalId: group.logicalId,
        logicalId: `${group.logicalId}::source:${sourceId}`, sourceIds: [sourceId],
        sourceLabel: enabled.get(sourceId).label, variants, best: variants[0],
        logo: variants[0].logo || group.logo, variantCount: variants.length });
    }
  }
  return sortFeaturedTamil(out);
}

export function sortFeaturedTamil(groups = []) {
  const rank = (g) => {
    const name = String(g.displayName || g.name || '').toLowerCase();
    if (/^(?:star\s+)?vijay(?:\s+(?:tv|hd|sd))?$/.test(name)) return 0;
    if (/^sun\s+tv(?:\s+(?:hd|sd))?$/.test(name)) return 1;
    if (/^sony\s+vizha\b/.test(name)) return 2;
    return (g.variants || []).some(v => /^(?:ta|tam|tamil)$/i.test(v.language || '') || isMainstreamTamilChannel(v, v.sourceId)) ? 3 : 4;
  };
  return [...groups].sort((a, b) => rank(a) - rank(b)
    || String(a.displayName || '').localeCompare(String(b.displayName || ''))
    || String(a.sourceLabel || '').localeCompare(String(b.sourceLabel || '')));
}

// The resolve response owns current playback fields; don't reuse stale keys,
// source identity or headers from a previously fetched catalogue snapshot.
export function resolvedPlaybackChannel(data, variant = {}) {
  return { ...variant, ...data.channel, channelId: data.channel?.id,
    url: data.originUrl, format: data.format,
    cookie: data.cookie ?? '', workerUrl: variant.url };
}
