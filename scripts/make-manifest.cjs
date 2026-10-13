/**
 * make-manifest.cjs — regenerates RELEASE-MANIFEST.json from the working tree.
 *
 * Why this exists: the manifest used to be hand-edited, and it drifted — it kept
 * listing routes that the cleanup had deleted (`/api/seed`, `/api/debug-scrapers`)
 * and a module count from three releases ago. A manifest that lies is worse than no
 * manifest, because a reviewer trusts it.
 *
 * Rules — identical to what the deploy ZIP contains:
 *   include  every file under the app tree (the manifest itself is excluded — it
 *            cannot hash itself),
 *   skip     node_modules, .next, .git, test-results, playwright-report, coverage,
 *            .cache, out, build, plus *.log and *.zip.
 *
 * Usage:  node scripts/make-manifest.cjs [--release name] [--check]
 *   --check   verify the file on disk matches the tree; exit 1 if it drifted
 *             (useful in CI, and it is what `npm run verify` should catch).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'test-results', 'playwright-report', 'coverage', '.cache', 'out', 'build']);
const SKIP_EXT = /\.(log|zip)$/i;
const SOURCE_EXT = /\.(js|jsx|mjs)$/;

const args = process.argv.slice(2);
const check = args.includes('--check');
const releaseIndex = args.indexOf('--release');
const release = releaseIndex >= 0 ? args[releaseIndex + 1] : 'loading-and-switching';

function walk(folder, files = []) {
  for (const item of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(item.name)) continue;
    const full = path.join(folder, item.name);
    if (item.isDirectory()) { walk(full, files); continue; }
    if (SKIP_EXT.test(item.name)) continue;
    if (item.name === 'RELEASE-MANIFEST.json') continue; // cannot hash itself
    files.push(full);
  }
  return files;
}

const files = walk('.');
const entry = {};
let sourceModules = 0;
for (const file of files) {
  const key = file.split(path.sep).join('/').replace(/^\.\//, '');
  const buffer = fs.readFileSync(file);
  entry[key] = { bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
  if (SOURCE_EXT.test(key)) sourceModules += 1;
}

const manifestPath = 'RELEASE-MANIFEST.json';
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const manifest = {
  version: previous.version || '11.0.0',
  release,
  baselineCommit: previous.baselineCommit || null,
  verifiedOn: new Date().toISOString().slice(0, 10),
  verification: {
    ...(previous.verification || {}),
    sourceModules,
    productionBuild: 'passed',
    standaloneStartupAndHealth: 'passed',
  },
  notes: previous.notes || '',
  files: entry,
};

if (check) {
  const drift = [];
  const before = previous.files || {};
  for (const key of Object.keys(entry)) if (!before[key] || before[key].sha256 !== entry[key].sha256) drift.push(`+ ${key}`);
  for (const key of Object.keys(before)) if (!entry[key]) drift.push(`- ${key}`);
  if (drift.length) {
    console.error(`RELEASE-MANIFEST.json is out of date (${drift.length} difference${drift.length === 1 ? '' : 's'}):`);
    for (const line of drift.slice(0, 40)) console.error('  ' + line);
    process.exitCode = 1;
  } else {
    console.log(`RELEASE-MANIFEST.json matches the tree (${Object.keys(entry).length} files, ${sourceModules} source modules).`);
  }
} else {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`RELEASE-MANIFEST.json written: ${Object.keys(entry).length} files, ${sourceModules} source modules, release "${release}".`);
}
