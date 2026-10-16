const fs = require('node:fs');
const assert = require('node:assert/strict');

/**
 * test-admin-controls.cjs — the control-room contracts, without a database.
 *
 * Three layers, because the admin work fails in three different ways:
 *
 *   1. **Behaviour of the pure helpers** (ordering, orphan matching, undo routing). These are the
 *      parts with real logic, and they are imported for real from the app's own source — no copies
 *      in the test that can drift. The `@/…` imports of DB models are swapped for inert stubs, so
 *      the module links without a Mongo connection; nothing in these helpers ever calls them.
 *   2. **Coverage**: every mutation route must record its action. If someone adds a button and
 *      forgets the trail, this test fails — which is the only way "audit on every tab" stays true
 *      after today.
 *   3. **Honesty of the trail**: irreversible actions must say so at the route, so the History tab
 *      never offers an Undo the server would refuse.
 */

/** Import an app module with its `@/…` dependencies replaced by inert data-URL stubs. */
async function importStubbed(relPath) {
  let source = fs.readFileSync(relPath, 'utf8');
  const specs = [];
  source = source.replace(/import\s+([^'"]+?)\s+from\s+'([^']+)';/g, (whole, clause, spec) => {
    if (!spec.startsWith('@/')) return whole;
    specs.push({ clause: clause.trim(), spec });
    return '';
  });
  let stubIndex = 0;
  source = source.replace(/import\s+([^'"]+?)\s+from\s+'(?!@\/)([^']+)';/g, '');
  // Build one stub module per distinct specifier, exporting every name the file asked for.
  const stubs = new Map();
  for (const { clause, spec } of specs) {
    if (!stubs.has(spec)) stubs.set(spec, new Set());
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const name of named[1].split(',').map((part) => part.split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        stubs.get(spec).add(name);
      }
    }
  }
  for (const [spec, names] of stubs) {
    const named = [...names].map((name) => `export const ${name} = () => { throw new Error(${JSON.stringify(`stub ${name} called`)}); };`).join('\n');
    const stub = `export default {};\n${named}\n`;
    source = source.replace(`'${spec}'`, `'data:text/javascript;base64,${Buffer.from(stub).toString('base64')}'`);
  }
  // Anything left importing an app module would link-fail confusingly; make that explicit.
  assert(!/from\s+'@\//.test(source), `${relPath}: an import was not stubbed`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64') + `#${stubIndex++}`);
}

(async () => {
  const catalog = await importStubbed('lib/catalogAdmin.js');
  const audit = await importStubbed('lib/adminAudit.js');
  const orphans = await importStubbed('lib/catalogOrphans.js');

  // ── 1. Home ordering: pinned first, then the scraped order ─────────────────
  const scraped = [
    { key: 'movie:zeta', title: 'Zeta', rawTitle: 'Zeta 2024', type: 'movie', section: 'movies', sourceIndex: 0 },
    { key: 'movie:alpha', title: 'Alpha', rawTitle: 'Alpha 2023', type: 'movie', section: 'movies', sourceIndex: 1 },
    { key: 'series:delta', title: 'Delta', rawTitle: 'Delta S01', type: 'series', section: 'series', sourceIndex: 0 },
  ];
  // The same two movies, with the *second* one pinned: a pin must jump the queue.
  const pinnedAlpha = { ...scraped[1], pinned: true, position: 0 };

  assert.equal(catalog.CATALOG_SORTS.includes('home'), true, 'the panel must offer the home order');
  assert.equal(catalog.CATALOG_SORTS.includes('az'), true);
  assert.deepEqual(catalog.CATALOG_SECTIONS, ['all', 'movies', 'series']);

  assert.deepEqual(
    catalog.orderCatalogRows([...scraped], { sort: 'home', section: 'all' }).map((row) => row.key),
    ['movie:zeta', 'movie:alpha', 'series:delta'],
    'sort=home mirrors the home page: scraped order, movies before series',
  );
  assert.deepEqual(
    catalog.orderCatalogRows([scraped[0], pinnedAlpha, scraped[2]], { sort: 'home', section: 'all' }).map((row) => row.key),
    ['movie:alpha', 'movie:zeta', 'series:delta'],
    'a pin floats to the top of the same order the viewer sees',
  );
  assert.deepEqual(
    catalog.orderCatalogRows([...scraped], { sort: 'az', section: 'all' }).map((row) => row.key),
    ['movie:alpha', 'movie:zeta', 'series:delta'],
    'sort=az sorts by title',
  );
  assert.deepEqual(
    catalog.orderCatalogRows([...scraped], { sort: 'home', section: 'series' }).map((row) => row.key),
    ['series:delta'],
    'section=series restricts the view',
  );
  // Unknown values must fall back, never 500.
  assert.equal(catalog.orderCatalogRows([...scraped], { sort: 'nonsense', section: 'nonsense' }).length, 3);

  // Position is the home position per section, computed over the whole catalogue — the number the
  // panel shows in the row badge, which has to equal where a viewer will actually find the title.
  const positioned = scraped.map((row) => ({ ...row }));
  catalog.assignHomePositions(positioned);
  assert.deepEqual(positioned.map((row) => [row.key, row.position]), [
    ['movie:zeta', 1], ['movie:alpha', 2], ['series:delta', 1],
  ], 'series numbering restarts in its own section');

  // ── 2. Undo routing ───────────────────────────────────────────────────────
  assert.deepEqual(audit.restoreFilter({ target: { key: 'movie:x' } }, 'key'), { key: 'movie:x' });
  assert.deepEqual(audit.restoreFilter({ target: { key: '507f1f77bcf86cd799439011' } }, '_id'), { _id: '507f1f77bcf86cd799439011' });
  assert.equal(audit.restoreFilter({ target: {} }, 'key'), null, 'a keyless action cannot be restored');

  const badge = audit.actionBadge({ reversible: true });
  assert.equal(badge.undoable, true);
  assert.equal(audit.actionBadge({ revertedAt: new Date() }).undoable, false, 'undoing twice must be refused');
  assert.equal(audit.actionBadge({ reversible: false, action: 'catalog.sync' }).undoable, false);
  assert.match(audit.actionBadge({ reversible: false, action: 'catalog.sync' }).reason, /cannot be undone/);

  for (const action of ['catalog.sync', 'catalog.purge', 'live.sync', 'extras.import']) {
    assert(audit.IRREVERSIBLE[action], `${action} must be declared irreversible`);
  }

  // ── 3. Orphan detection and re-bind suggestions ────────────────────────────
  const liveRows = [
    { key: 'movie:the grey man', title: 'The Grey Man', rawTitle: 'The Grey Man 2022', year: '2022', type: 'movie' },
    { key: 'movie:grey man 2024', title: 'Grey Man', rawTitle: 'Grey Man 2024', year: '2024', type: 'movie' },
    { key: 'series:the grey man', title: 'The Grey Man', rawTitle: 'The Grey Man S01', year: '2022', type: 'series' },
  ];
  const overrideDocs = [
    // Dead: the forum renamed the release, so this key no longer exists in the catalogue.
    { key: 'movie:the gray man 2022', type: 'movie', rawTitle: 'The Gray Man 2022', titleOverride: 'The Gray Man', yearOverride: '2022', hidden: true, updatedAt: new Date('2026-01-02') },
    // Alive: its key is in the listing, so it must not be reported.
    { key: 'movie:the grey man', type: 'movie', rawTitle: 'The Grey Man 2022', pinned: true, updatedAt: new Date('2026-01-03') },
  ];

  const report = orphans.buildOrphanReport(overrideDocs, liveRows);
  assert.equal(report.count, 1, 'only the override whose key left the catalogue is an orphan');
  assert.equal(report.applied, 1);
  assert.equal(report.orphans[0].key, 'movie:the gray man 2022');
  assert.equal(report.orphans[0].carry.hidden, true, 'the re-bind must carry the whole intent');

  const suggestions = orphans.suggestRebinds(overrideDocs[0], liveRows);
  assert(suggestions.length <= 3);
  assert(suggestions.every((row) => row.why), 'every suggestion must explain itself');
  assert.equal(suggestions[0].key, 'movie:the grey man', 'the same-year spelling variant is the best suggestion');
  assert.match(suggestions[0].why, /spelling differs/, 'the reason must name what actually matched');
  assert(!suggestions.some((row) => row.key === 'series:the grey man'), 'a movie override must never be suggested a series row');
  assert(suggestions.every((row) => row.type === 'movie'), 'type is never crossed');

  // An override whose title left the catalogue entirely suggests nothing rather than guessing.
  const gone = { key: 'movie:some withdrawn film', type: 'movie', rawTitle: 'Some Withdrawn Film 1999', yearOverride: '1999' };
  assert.equal(orphans.buildOrphanReport([gone], liveRows).orphans[0].suggestions.length, 0);

  // ── 4. Bulk edits: same planner for preview and apply, no-ops stay no-ops ──
  const bulk = await importStubbed('lib/catalogBulk.js');

  const plain = { key: 'movie:one', title: 'One', rawTitle: 'One 2021', type: 'movie', hidden: false, pinned: false };
  const hiddenRow = { key: 'movie:two', title: 'Two', rawTitle: 'Two 2020', type: 'movie', hidden: true, pinned: false };
  const pinnedRow = { key: 'movie:three', title: 'Three', rawTitle: 'Three 2019', type: 'movie', hidden: false, pinned: true, override: { pinned: true } };

  const hidePlan = bulk.planBulk([plain, hiddenRow], { op: 'hide' });
  assert.equal(hidePlan.changed.length, 1, 'only the visible row changes');
  assert.equal(hidePlan.skipped.length, 1, 'an already-hidden row is skipped, not rewritten');
  assert.deepEqual(hidePlan.changed[0].after, { hidden: true });
  assert.equal(hidePlan.changed[0].before, null, 'a row with no override has no before');
  assert.match(hidePlan.summary, /1 row will change/);

  // Restoring the only interesting field must delete the override rather than store empty strings.
  const restore = bulk.planBulk([{ ...hiddenRow, override: { hidden: true } }], { op: 'restore' });
  assert.equal(restore.changed.length, 1);
  assert.equal(restore.changed[0].after, null, 'restoring leaves nothing behind to store');

  // A pin must survive an unrelated bulk action.
  const pinStay = bulk.planBulk([pinnedRow], { op: 'hide' });
  assert.deepEqual(pinStay.changed[0].after, { pinned: true, hidden: true }, 'bulk hide must not drop an existing pin');

  assert.throws(() => bulk.planBulk([plain], { op: 'explode' }), /Unknown bulk action/);

  // ── 5. Duplicates ─────────────────────────────────────────────────────────
  const rows = [
    { key: 'movie:a', title: 'Vikram', rawTitle: 'Vikram (2022) 1080p', type: 'movie', year: '2022', tmdbId: 842675, qualityTier: 4 },
    { key: 'movie:b', title: 'Vikram', rawTitle: 'Vikram 2022 HDRip', type: 'movie', year: '2022', qualityTier: 1 },
    { key: 'series:a', title: 'Vikram', rawTitle: 'Vikram S01', type: 'series', year: '2022' },
    { key: 'movie:c', title: 'Vikram', rawTitle: 'Vikram 1996', type: 'movie', year: '1996', tmdbId: 1 },
  ];
  const groups = bulk.findDuplicateGroups(rows);
  assert.equal(groups.length, 1, 'the 2022 movie pair groups; the series and the 1996 film do not');
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].suggestedWinner.key, 'movie:a', 'the matched, highest-quality row is suggested');
  assert(groups[0].reasons.every((reason) => reason), 'every row explains its role');

  // ── 6. Dry-run diff ───────────────────────────────────────────────────────
  const key = (item) => `${item.type}:${item.rawTitle}`;
  const cachedScrape = { movies: [{ type: 'movie', rawTitle: 'One 2021', title: 'One', year: '2021' }, { type: 'movie', rawTitle: 'Old 2010', title: 'Old', year: '2010' }], series: [] };
  const freshScrape = { movies: [{ type: 'movie', rawTitle: 'One 2021', title: 'One', year: '2022' }, { type: 'movie', rawTitle: 'New 2026', title: 'New', year: '2026' }], series: [] };
  const diff = bulk.diffScrape(cachedScrape, freshScrape, key);
  assert.deepEqual(diff.counts, { before: 2, after: 2, added: 1, removed: 1, changed: 1, net: 0 });
  assert.equal(diff.added[0].title, 'New');
  assert.equal(diff.removed[0].title, 'Old');
  assert.deepEqual(diff.changed[0].fields, ['year']);
  assert.deepEqual(bulk.orphanedBy(diff, ['movie:One 2021', 'movie:Old 2010', 'movie:New 2026']), ['movie:Old 2010'],
    'only the override on a title the sync removes is reported as at risk');

  // Normalisation is what makes duplicate grouping work at all: quality noise must vanish.
  assert.equal(bulk.normaliseTitle('Vikram [1080p] (2022) Tamil Dubbed x264'), 'vikram');
  assert.equal(bulk.normaliseTitle('The Gray Man 2022 WEB-DL'), 'gray man');

  // ── 7. Coverage: every mutation route records, or the trail is a lie ───────
  const MUST_RECORD = [
    'app/api/admin/catalog/override/route.js',
    'app/api/admin/catalog/overrides/route.js',
    'app/api/admin/catalog/sync/route.js',
    'app/api/admin/catalog/orphans/route.js',
    'app/api/admin/lyrics/route.js',
    'app/api/admin/stremio/addons/route.js',
    'app/api/admin/extras/route.js',
    'app/api/admin/vod/items/route.js',
    'app/api/admin/vod/items/rematch/route.js',
    'app/api/admin/vod/sources/route.js',
    'app/api/live-service/sources/route.js',
    'app/api/live-service/channels/route.js',
    'app/api/live-service/import/route.js',
    'app/api/live-service/purge/route.js',
    'app/api/live-service/sync/route.js',
    'app/api/admin/tv/sweep/route.js',
    'app/api/admin/tv/auto-sync/route.js',
    // The Music tab talks to the app's own playlist endpoint; the panel marks its requests so the
    // trail records the admin's edits without logging the owner's ordinary imports.
    'app/api/music/playlists/route.js',
  ];
  for (const file of MUST_RECORD) {
    const code = fs.readFileSync(file, 'utf8');
    assert(code.includes('recordAction('), `${file} mutates without recording an action`);
    assert(code.includes("from '@/lib/adminAudit'"), `${file} does not import the audit helper`);
  }
  assert(fs.readFileSync('components/admin/MusicTab.js', 'utf8').includes("'x-jash-admin': '1'"), 'the Music tab must mark its requests as admin ones');
  // Branch-level coverage: the lyrics route handles save and delete in one handler, and a missing
  // record in one of those branches is invisible to an import check (that is exactly how it slipped
  // through once). Every action name the handler can emit must appear.
  const lyricsCode = fs.readFileSync('app/api/admin/lyrics/route.js', 'utf8');
  for (const action of ['lyrics.save', 'lyrics.delete']) {
    assert(lyricsCode.includes(`action: '${action}'`), `the lyrics handler must record ${action}`);
  }
  assert((lyricsCode.match(/recordAction\(/g) || []).length >= 2, 'both lyrics branches must record');

  // Vault writes all funnel through one store, so the trail lives there.
  assert(fs.readFileSync('lib/vaultAdminStore.js', 'utf8').includes('recordAction('), 'vault writes must record');

  // ── 5. Honesty: the destructive paths declare themselves ───────────────────
  for (const [file, action] of [
    ['app/api/admin/catalog/sync/route.js', 'catalog.sync'],
    ['app/api/live-service/purge/route.js', 'live.purge'],
    ['app/api/live-service/import/route.js', 'live.import'],
    ['app/api/admin/tv/sweep/route.js', 'live.sweep'],
  ]) {
    const code = fs.readFileSync(file, 'utf8');
    const block = code.slice(code.indexOf(`action: '${action}'`), code.indexOf(`action: '${action}'`) + 400);
    assert(/reversible: false/.test(block), `${action} must be recorded as irreversible`);
  }

  // The History tab must never offer Undo on a row it cannot restore, and the panel must reach it.
  const historyTab = fs.readFileSync('components/admin/HistoryTab.js', 'utf8');
  assert(historyTab.includes('row.reversible ?'), 'History must branch on reversibility');
  assert(historyTab.includes('/api/admin/history'), 'History must read the log');
  const adminApp = fs.readFileSync('components/admin/AdminApp.js', 'utf8');
  assert(adminApp.includes("id: 'history'"), 'the History tab must be reachable');
  assert(adminApp.includes('HistoryTab'), 'the History tab must be mounted');
  assert(fs.readFileSync('components/admin/HomeTab.js', 'utf8').includes('tab=history'), 'every Home row must link to its own history');

  console.log('PASS admin controls: home order/pins/sections, undo routing + honesty, orphan report and re-bind suggestions, bulk planner no-ops and pin preservation, duplicate grouping, dry-run diff + orphan forecast, audit coverage on every mutation route, History reachable and undo-aware.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
