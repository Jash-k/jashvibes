import dbConnect from '@/lib/db';
import StremioAddon from '@/models/StremioAddon';

function envAddon(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

/**
 * First-run seed for the Stremio registry, from the same env chain the app
 * already honours. Empty registry afterwards = admin CRUD is authoritative.
 */
export async function seedStremioAddonsIfEmpty() {
  await dbConnect();
  const count = await StremioAddon.estimatedDocumentCount();
  if (count > 0) return false;

  const catalog = envAddon('STREMIO', 'STREMIO_ADDON', 'STREMIO_ADDON_URL', 'STREMIO_MANIFEST', 'STREMIO_HOME', 'STREMIO_CATALOG');
  const watch = envAddon('STREMIO_WATCH', 'STREMIO_WATCH_ADDON', 'STREMIO_PROVIDER');
  const seeds = [];
  if (catalog) seeds.push({ label: 'Env catalog addon', manifestUrl: catalog.replace(/\/manifest\.json.*$/i, ''), kind: 'catalog', sortOrder: 10 });
  if (watch) seeds.push({ label: 'Env watch addon', manifestUrl: watch.replace(/\/manifest\.json.*$/i, ''), kind: 'watch', sortOrder: 20 });
  if (seeds.length) await StremioAddon.insertMany(seeds).catch(() => {});
  return seeds.length > 0;
}
