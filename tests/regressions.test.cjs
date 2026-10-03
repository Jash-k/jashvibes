/**
 * Regression guards for the four fixes of 2026-10-03.
 *
 * Each of these was a real, reported bug. They are asserted against the source
 * tree rather than by importing UI modules (React components cannot be imported
 * by `node --test`), because what must not happen is a *future edit* quietly
 * undoing the fix. If one of these fails, read it before "fixing the test".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const walk = (relative) => {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(js|jsx|cjs|mjs)$/.test(entry.name)) out.push(full);
    }
  };
  visit(path.join(root, relative));
  return out;
};

test('bug 1: the live service panel imports every hook it calls', () => {
  const file = read('components/live/LiveServicePanel.js');
  const importLine = file.match(/import\s*\{([^}]+)\}\s*from\s*'react'/);
  assert.ok(importLine, 'the panel must import its hooks from react');
  const imported = importLine[1].split(',').map((part) => part.trim());
  for (const hook of ['useState', 'useMemo', 'useEffect', 'useRef']) {
    const used = new RegExp(`\\b${hook}\\s*\\(`).test(file);
    if (used) assert.ok(imported.includes(hook), `${hook}() is called but not imported (this was the "userref" crash)`);
  }
});

test('bug 2: the global Stremio shelf accepts a viewer session, not only an owner session', () => {
  const file = read('app/api/stremio/pins/route.js');
  // The page writes pins in a viewer session; requiring the admin realm here is
  // exactly what made pins appear not to last.
  assert.match(file, /verifyRequestToken/, 'the pins route must accept the viewer session');
  assert.match(file, /isValidAdminToken/, 'the pins route must still accept the owner session');
  assert.match(file, /rejectCrossOriginMutation/, 'shelf writes must stay CSRF-protected');
  // And a failure must be reported rather than swallowed.
  assert.doesNotMatch(file, /insertMany\([^)]*\)\.catch\(\(\) => \{\}\)/, 'a failed shelf write must not be swallowed');
});

test('bug 3: watch history cannot be written back in', () => {
  assert.equal(fs.existsSync(path.join(root, 'lib/player/resume.js')), false, 'lib/player/resume.js was removed');

  const store = read('lib/watchStore.js');
  for (const gone of ['upsertHistoryEntry', 'getHistory', 'saveWatchProgress', 'saveOrUpsertProgress', 'clearHistory', 'removeHistoryEntry']) {
    assert.doesNotMatch(store, new RegExp(`export (function|const) ${gone}\\b`), `${gone} must not be exported again`);
  }
  // The favourites half must survive the removal untouched.
  for (const kept of ['getFavorites', 'toggleFavoriteItem', 'removeFavoriteItem', 'clearFavorites', 'useLibraryVersion', 'makeWatchKey']) {
    assert.match(store, new RegExp(`export (function|const) ${kept}\\b`), `${kept} must still exist`);
  }
  // The old localStorage key may only be referenced by the one-time purge.
  for (const file of [...walk('app'), ...walk('components'), ...walk('hooks')]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /jash:library:continue/, `${path.relative(root, file)} must not touch the legacy history key`);
  }
});

test('bug 3: no surface still renders resume state', () => {
  for (const file of [...walk('app'), ...walk('components')]) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /ResumeToast|resumePrompt/, `${path.relative(root, file)} still renders a resume prompt`);
    assert.doesNotMatch(source, /slide\.progress/, `${path.relative(root, file)} still reads a resume percentage`);
  }
});

test('bug 4: the home page no longer renders a Vault row', () => {
  const home = read('app/page.js');
  assert.doesNotMatch(home, /VaultRail/, 'the home Vault rail must stay removed');
  assert.doesNotMatch(home, /VAULT_CACHE_KEY/, 'its session cache key must stay removed with it');
  // /vault itself is untouched and still reachable.
  assert.equal(fs.existsSync(path.join(root, 'app/vault/page.js')), true);
  assert.equal(fs.existsSync(path.join(root, 'app/api/vault/route.js')), true);
});

test('dead modules stay dead', () => {
  assert.equal(fs.existsSync(path.join(root, 'components/LibraryRows.js')), false, 'LibraryRows.js was replaced by LibraryCard.js');
  assert.equal(fs.existsSync(path.join(root, 'components/LibraryCard.js')), true);
  for (const file of walk('lib')) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /isLiveHistoryKey|jv-vault-rail-card/, `${path.relative(root, file)} references removed APIs`);
  }
});
