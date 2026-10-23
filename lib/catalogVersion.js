/*
 * Shared, dependency-free invalidation for the cached Live catalogue (A3).
 *
 * This lives in its own module so the Mongoose model files can invalidate the cache
 * without importing lib/liveService.js — that would be a require cycle, since
 * liveService imports the models. Both sides agree on one global object, so a single
 * counter serves them.
 *
 * Invalidation is wired to the models rather than to the Admin routes because there
 * are a dozen write paths: the Admin panel, the hourly auto-sync, the onboarding
 * sync, the import endpoint and the self-heal pass. Hooking the models means all of
 * them invalidate correctly without every one having to remember to.
 */
export function bumpLiveCatalog() {
  const cache = globalThis.__jashLiveCatalogCache;
  if (!cache) return;   // not built yet in this process — nothing cached to drop
  cache.version += 1;
  cache.entries.clear();
}

export default bumpLiveCatalog;
