/**
 * Node ESM resolve hook so the test runner can import the app's modules using
 * the same `@/` alias Next.js uses — no bundler, no extra dependency.
 *
 * Run through package.json: `npm test`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const relative = specifier.slice(2);
    for (const candidate of [relative, `${relative}.js`, `${relative}.jsx`, `${relative}.mjs`, path.join(relative, 'index.js')]) {
      const absolute = path.join(root, candidate);
      if (existsSync(absolute) && !absolute.endsWith(path.sep)) {
        return { url: pathToFileURL(absolute).href, format: 'module', shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export default { resolve };
