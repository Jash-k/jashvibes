#!/usr/bin/env node
/*
 * scripts/db-maintenance.cjs — run the housekeeping pass against a real database.
 *
 *   npm run db:audit                               read-only report (this is the default)
 *   npm run db:clean                               safe tier: duplicates, dead sources, counters, indexes
 *   npm run db:clean -- --all                      + the app's own unused / broken / not-seen / hidden rules
 *   npm run db:clean -- --drop media               + drop one named legacy or unknown collection
 *   npm run db:clean -- --drop-indexes             explicit: drop indexes with no recorded use
 *
 * Flags: --days=N (staleness window, default 30) · --json · --uri=<mongodb uri> · --help
 *
 * The connection uses the same environment chain as the app: DB → DB_URI → MONGODB_URI.
 * Nothing is written unless one of --safe / --all / --drop / --drop-indexes is present, and
 * the report always prints before anything happens. Take a mongodump first if the database
 * holds anything you would miss.
 */
const { auditDatabase, applyPlan } = require('../lib/dbMaintenance.cjs');

// ── arguments ────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag) => {
  const inline = argv.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
};

if (has('--help') || has('-h')) {
  console.log(`
JaSH ViBeS · database maintenance

  node scripts/db-maintenance.cjs [flags]

  (no flags)          read-only audit — counts, duplicates, orphans, unused indexes
  --safe              remove duplicate rows, channels whose source is gone, recompute
                      counters, create the indexes the app relies on
  --all               everything above PLUS the app's own live-channel rules:
                      unused, broken, not-seen, hidden (favourites always protected)
  --drop <name>       drop one named collection (legacy or unknown). Repeatable.
  --drop-indexes      drop indexes with no recorded use
  --days=N            staleness window for "not seen" channels (default 30)
  --json              machine-readable audit
  --uri=<uri>         override the DB / DB_URI / MONGODB_URI environment chain
  --help              this text

  Every write mode prints the plan first, then what it removed.
`);
  process.exit(0);
}

const days = Math.max(1, Number(value('--days') || 30) || 30);
const drops = [];
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--drop' && argv[i + 1]) drops.push(argv[i + 1]);
  else if (argv[i].startsWith('--drop=')) drops.push(argv[i].slice('--drop='.length));
}
const shouldClean = has('--safe') || has('--all');
const dropIndexes = has('--drop-indexes');
const writeMode = shouldClean || drops.length > 0 || dropIndexes;
const tier = has('--all') ? 'all' : 'safe';
const asJson = has('--json');

// ── formatting ───────────────────────────────────────────────────────────────────────
const pad = (text, width) => String(text).padEnd(width);
const bytes = (n) => {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const day = (iso) => (iso ? iso.slice(0, 10) : '—');
const line = (label, text) => console.log(`  ${pad(label, 20)}${text}`);

// ── run ──────────────────────────────────────────────────────────────────────────────
(async () => {
  const uri = value('--uri') || process.env.DB || process.env.DB_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('No database configured. Set DB (or DB_URI / MONGODB_URI), or pass --uri=<uri>.');
    process.exit(2);
  }

  const mongoose = require('mongoose');
  mongoose.set('strictQuery', true);
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, bufferCommands: false });
  } catch (error) {
    console.error(`Could not connect: ${error.message}`);
    process.exit(2);
  }

  const db = mongoose.connection.db;
  const report = await auditDatabase(db, { days });

  if (asJson && !writeMode) {
    console.log(JSON.stringify(report, null, 2));
    await mongoose.disconnect();
    return;
  }

  console.log(`\nJaSH ViBeS · database maintenance — ${report.database}`);
  console.log(
    `${report.summary.collections} collections · ${report.summary.documents.toLocaleString('en')} documents · ${bytes(report.summary.bytes)}\n`,
  );

  console.log('INVENTORY');
  const width = Math.max(...report.collections.map((row) => row.name.length), 12) + 2;
  for (const row of report.collections) {
    const flags = [row.legacy ? 'legacy — nothing in the UI reads it' : '', row.known ? '' : 'unknown — the app never reads it'].filter(Boolean).join(' · ');
    console.log(`  ${pad(row.name, width)}${pad(row.count.toLocaleString('en'), 8)} ${pad(bytes(row.bytes), 9)} ${pad(`updated ${day(row.newest)}`, 22)}${flags}`);
  }

  console.log('\nDUPLICATES (keys that are supposed to be single)');
  const dupes = [
    ['tamilmv_scrapes', report.duplicates.tamilmv_scrapes],
    ['title_matches', report.duplicates.title_matches],
  ];
  for (const [name, groups] of dupes) {
    if (!groups.length) line(name, 'none ✓');
    else for (const group of groups) line(name, `${group.rows} rows for key "${group.key}" → keep the freshest, remove ${group.dropIds.length}`);
  }

  console.log('\nLIVE CHANNELS');
  line('total', `${report.live.channels.toLocaleString('en')}`);
  line('published', `${report.live.buckets.published.toLocaleString('en')} (appear in at least one catalogue)`);
  line('protected', `${report.live.buckets.protectedCount.toLocaleString('en')} favourited, manually mapped or guide-overridden — never candidates`);
  for (const [key, label] of [
    ['orphanSource', 'source no longer exists'],
    ['deletedSource', 'belongs to a deleted source'],
    ['unused', 'never published to a catalogue'],
    ['notSeen', `not seen in ${days} days and in no catalogue`],
    ['broken', 'marked broken and in no catalogue'],
    ['hidden', 'hidden and in no catalogue'],
  ]) {
    const count = report.live.seen[key];
    line(key, `${count.toLocaleString('en')}   ${label}${count ? '' : ' ✓'}`);
  }

  if (report.live.counters.length) {
    console.log('\nSOURCE COUNTERS (denormalised fields that drifted)');
    for (const row of report.live.counters) {
      const parts = Object.entries(row.drift).map(([field, values]) => `${field} ${values.stored} → ${values.actual}`);
      line(row.sourceId || '(no id)', parts.join(' · '));
    }
  }

  console.log('\nVOD ITEMS — reported, never deleted automatically');
  line('total', `${report.vod.total.toLocaleString('en')} · ${report.vod.hidden} hidden by you`);
  line('no source', `${report.vod.noSources} (still listed by /api/vod — it filters on hidden only)`);
  line('no streams', `${report.vod.noStreams}${report.vod.sampleNoStreams.length ? ` — e.g. ${report.vod.sampleNoStreams.map((row) => row.title).slice(0, 3).join(', ')}` : ''}`);
  line('unmatched', `${report.vod.unmatched} without a TMDB match`);

  console.log('\nINDEXES');
  if (report.indexes.missing.length) for (const row of report.indexes.missing) line('missing', `${row.collection}.${row.options.name || Object.keys(row.keys).join('_')} — ${row.why}`);
  else line('missing', 'none ✓');
  const dropAction = report.actions.find((row) => row.id === 'index.drop-unused');
  if (dropAction) for (const row of dropAction.indexes) line('low value', `${row.collection}.${row.name}${row.ops === null ? '' : ` (${row.ops} ops)`} — droppable with --drop-indexes`);
  const review = report.indexes.unused.filter((row) => !row.droppable);
  if (review.length) for (const row of review) line('unused since start', `${row.collection}.${row.name} — left alone; these stats reset on restart`);
  if (!dropAction && !review.length) line('no recorded use', 'none reported');

  console.log('\nPLAN');
  if (!report.actions.length) console.log('  nothing to do — the database is already tidy');
  for (const action of report.actions) {
    const tierLabel = action.tier === 'safe' ? 'safe' : action.tier === 'all' ? 'all ' : 'flg ';
    console.log(`  [${tierLabel}] ${action.label}`);
  }

  if (!writeMode) {
    console.log('\nNOTHING WAS CHANGED — this was a read-only audit.');
    console.log('  npm run db:clean                  remove duplicates, dead-source channels, fix counters, add indexes');
    console.log('  npm run db:clean -- --all         also apply the app\'s unused / broken / not-seen / hidden channel rules');
    console.log('  npm run db:clean -- --drop media  drop a named legacy or unknown collection\n');
    await mongoose.disconnect();
    return;
  }

  console.log(`\nAPPLYING (tier: ${shouldClean ? tier : 'explicit only'}${drops.length ? ` · drops: ${drops.join(', ')}` : ''}${dropIndexes ? ' · drop-indexes' : ''})`);
  const result = await applyPlan(db, report, {
    tier: shouldClean ? tier : 'none',
    drops,
    dropIndexes,
    onLog: (text) => console.log(text),
  });

  const removed = result.applied.reduce((sum, row) => sum + (row.removed || 0), 0);
  console.log(`\nDONE — ${result.applied.length} action(s) applied, ${removed.toLocaleString('en')} document(s) removed.`);
  if (result.skipped.length) {
    console.log('Skipped:');
    for (const row of result.skipped) console.log(`  ✗ ${row.id}${row.collection ? ` (${row.collection})` : ''}: ${row.error || row.reason}`);
  }
  if (result.notSelected.length) {
    console.log(`Not selected by this run (${result.notSelected.length}):`);
    for (const row of result.notSelected.slice(0, 8)) console.log(`  · [${row.tier}] ${row.label}`);
  }

  // After-counts, so the effect is visible rather than assumed.
  console.log('\nAFTER');
  const touched = [...new Set(result.applied.map((row) => row.collection))];
  for (const name of touched) {
    const count = await db.collection(name).countDocuments({}).catch(() => null);
    console.log(`  ${pad(name, 18)}${count === null ? '—' : count.toLocaleString('en')} documents`);
  }
  console.log('\nTip: run `npm run db:audit` again to confirm the plan is empty.\n');

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(`Failed: ${error.message}`);
  try {
    const mongoose = require('mongoose');
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
