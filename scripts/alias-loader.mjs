/**
 * scripts/alias-loader.mjs
 *
 * Lets plain Node run the app's own modules. `jsconfig.json` maps `@/*` to the
 * repo root for Next's bundler, but Node does not know that mapping — so
 * scripts that want the *real* parser (lib/liveTv.js) instead of a copy need
 * this resolve hook.
 *
 *   node --import ./scripts/alias-register.mjs scripts/live-doctor.mjs <url>
 *
 * Only the `@/` prefix is rewritten, and only to files inside the repo.
 */
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function firstExisting(candidate) {
  const tries = [candidate, `${candidate}.js`, `${candidate}.jsx`, `${candidate}.mjs`, path.join(candidate, 'index.js')];
  return tries.find((file) => fs.existsSync(file)) || '';
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const found = firstExisting(path.join(ROOT, specifier.slice(2)));
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }
  return nextResolve(specifier, context);
}
