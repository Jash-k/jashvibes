import dbConnect from '@/lib/db';
import StremioAddon from '@/models/StremioAddon';

/**
 * Mongo-first Stremio addon resolution.
 *
 * `lib/stremioAddon.js` resolves the manifest URL synchronously (env chain →
 * built-in default) and is called from many sync call-sites. This module keeps
 * a short-lived (60 s) process cache of the admin-chosen addon per kind, and
 * every Stremio entry route warms it before resolving. When the registry is
 * empty the env/built-in chain applies unchanged.
 */
const WARM_TTL_MS = 60 * 1000;

export async function warmStremioRegistry() {
  const cache = (globalThis.__jashStremioRegistry ||= { at: 0, map: {} });
  if (Date.now() - cache.at < WARM_TTL_MS) return cache.map;
  try {
    await dbConnect();
    const docs = await StremioAddon.find({ enabled: true }).sort({ sortOrder: 1 }).lean();
    const map = {};
    for (const kind of ['catalog', 'watch']) {
      const first = docs.find((doc) => doc.kind === kind);
      if (first?.manifestUrl) map[kind] = first.manifestUrl;
    }
    cache.map = map;
    cache.at = Date.now();
  } catch {
    /* DB unreachable: env chain applies */
  }
  return cache.map;
}

export function stremioRegistryOverride(kind = 'catalog') {
  return globalThis.__jashStremioRegistry?.map?.[kind] || '';
}
