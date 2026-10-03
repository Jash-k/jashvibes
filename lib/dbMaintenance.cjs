/*
 * lib/dbMaintenance.js — the database's housekeeping pass.
 *
 * WHY THIS EXISTS
 * Nothing in the app deletes anything except on an explicit user action, so after a few
 * versions a database accumulates three kinds of quiet mess: rows that duplicate a key
 * which is supposed to be single (the scrape cache, manual title matches), live channels
 * whose source no longer exists or that were never published to a catalogue, and indexes
 * that cost writes without serving a query. None of it shows up as an error. It shows up
 * as a database that only grows, and an admin panel that slowly stops matching reality.
 *
 * THE RULES THIS FILE OBEYS
 *
 * 1. **Dry by default.** `auditDatabase()` only reads. `applyPlan()` is a separate call and
 *    does nothing unless the caller asks for a tier. Nothing here is a side effect of
 *    looking.
 * 2. **Owner intent is protected.** Favourites, manual channel maps and guide overrides are
 *    never candidates for deletion. Catalogue overrides and manual title matches are
 *    *reported*, never removed — they encode work that cannot be regenerated.
 * 3. **The app defines "unused", not this file.** The live-channel rules mirror
 *    `app/api/live-service/purge/route.js`. Where this file is stricter than that route it
 *    says so out loud (see `liveChannelFilters`).
 * 4. **Nothing is deleted that a screen can still show.** `VodItem` rows with no `sources`
 *    are STILL LISTED by `/api/vod`, which filters on `hidden` alone — verified against the
 *    route, not assumed. They are reported and never auto-deleted.
 * 5. **No imports, and not bundled.** This is the only .cjs module in lib/: it is required by
 *    `scripts/db-maintenance.cjs` and by the test suite, never by the app, so it must load in
 *    plain Node on any supported version. It only ever touches an injected `db` handle, which
 *    is what lets the tests exercise the decisions without a connection.
 */

const DAY_MS = 86400000;

/** Collections the application reads or writes. Anything else in the database is unknown. */
const CORE_COLLECTIONS = [
  'livechannels',
  'livesources',
  'liveprofiles',
  'voditems',
  'vodsources',
  'stremioaddons',
  'stremiopins',
  'catalogoverrides',
  'musicplaylists',
  'media',
  'settings',
  'tamilmv_scrapes',
  'title_matches',
];

/**
 * Known by name, but nothing in the UI reads it any more. Reported, never touched
 * automatically: only the owner can decide that the old catalogue is really disposable.
 */
const LEGACY_COLLECTIONS = {
  media:
    'the v10 catalogue (`sources[]` with embedded streams). Its only readers are /api/stream, '
    + '/api/resolve and /api/seed, and no client code calls any of them.',
};

/** Indexes the app relies on. Creation is non-destructive and safe to apply. */
const EXPECTED_INDEXES = [
  {
    collection: 'tamilmv_scrapes',
    keys: { key: 1 },
    options: { unique: true, name: 'key_1' },
    why: 'the catalogue cache is ONE row; the upsert must not be able to duplicate it',
  },
  {
    collection: 'title_matches',
    keys: { key: 1 },
    options: { unique: true, name: 'key_1' },
    why: 'one manual match per key — every write is an upsert, so duplicates are pure noise',
  },
  {
    collection: 'livechannels',
    keys: { hidden: 1, selected: 1, 'catalogs.catalogId': 1, order: 1 },
    options: { name: 'live_list_hot' },
    why: 'the /live list filters exactly these fields and sorts by order',
  },
  {
    collection: 'livechannels',
    keys: { sourceId: 1, order: 1 },
    options: { name: 'live_by_source' },
    why: 'admin lists scope by source then sort',
  },
];

/** Indexes that cost writes without serving a query. Only dropped on an explicit flag. */
const LOW_VALUE_INDEXES = [
  { collection: 'livechannels', name: 'selected_1', why: 'low-cardinality boolean; scanned thousands of times per sync' },
  { collection: 'livechannels', name: 'favorite_1', why: 'low-cardinality boolean; writes on every channel upsert' },
  { collection: 'livechannels', name: 'hidden_1', why: 'low-cardinality boolean; superseded by live_list_hot' },
  { collection: 'musicplaylists', name: 'title_text_description_text_owner_text', why: 'declared but nothing runs a $text query' },
];

// ── small helpers ────────────────────────────────────────────────────────────────────

/** Never let one unexpected driver error (or a permission-limited Atlas command) abort the audit. */
async function attempt(promise, fallback = null) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function olderThan(days) {
  return new Date(Date.now() - days * DAY_MS);
}

/** The stamp that says when a row was last touched, newest-first by preference. */
function newestStamp(doc = {}) {
  for (const field of ['refreshedAt', 'updatedAt', 'createdAt', 'lastSyncedAt', 'lastSeenAt']) {
    const time = doc?.[field] ? new Date(doc[field]).getTime() : NaN;
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

/** A channel the owner has marked by hand: favourite, manually mapped, or given a guide. */
function channelIsProtected(channel = {}) {
  return channel.favorite === true
    || channel.mappingManaged === true
    || (channel.epgOverride !== null && channel.epgOverride !== undefined && channel.epgOverride !== '');
}

/** Published = appears in at least one catalogue, which is what makes it visible in /live. */
function channelIsPublished(channel = {}) {
  return Array.isArray(channel.catalogs) && channel.catalogs.length > 0;
}

/**
 * The deletion rules for live channels, mirroring the modes in the app's own purge route
 * (`/api/live-service/purge`, default mode `unused`).
 *
 * One deliberate difference: this file protects favourites in EVERY mode. The app's route
 * only checks `favorite` in its `unused` and `notSeen` modes, so its `broken` and `hidden`
 * modes can delete a channel the owner starred. A maintenance pass has no business making
 * that call, so it does not.
 */
function liveChannelFilters({ days = 30, sourceIds = null } = {}) {
  const protectedByOwner = { favorite: { $ne: true }, mappingManaged: { $ne: true }, epgOverride: null };
  const unpublished = { 'catalogs.0': { $exists: false } };
  // Only channels of sources that still exist: channels of a deleted or absent source are
  // their own buckets below, and must not be counted — or removed — twice. The four modes are
  // mutually exclusive for the same reason: the app applies exactly ONE per call, while this
  // pass can run several, so overlapping filters would delete more than the report promised.
  const scope = Array.isArray(sourceIds) ? { sourceId: { $in: sourceIds } } : {};
  const cutoff = olderThan(days);
  return {
    hidden: { ...protectedByOwner, ...unpublished, ...scope, hidden: true },
    broken: { ...protectedByOwner, ...unpublished, ...scope, hidden: { $ne: true }, workingStatus: 'broken' },
    notSeen: { ...protectedByOwner, ...unpublished, ...scope, hidden: { $ne: true }, workingStatus: { $ne: 'broken' }, lastSeenAt: { $lt: cutoff } },
    unused: {
      ...protectedByOwner,
      ...unpublished,
      ...scope,
      hidden: { $ne: true },
      workingStatus: { $ne: 'broken' },
      // A channel that never carried a timestamp counts as never-seen-fresh, which is how the
      // classifier below reads it too (only a real value counts as "seen").
      $or: [{ lastSeenAt: { $gte: cutoff } }, { lastSeenAt: { $exists: false } }],
    },
  };
}

/** Groups rows that share a key which is supposed to be unique; keeps the freshest row. */
async function duplicateGroups(db, name, keyFields, { projection = {} } = {}) {
  const rows = await attempt(db.collection(name).find({}, { projection }).toArray(), []);
  const groups = new Map();
  for (const row of rows) {
    const key = keyFields.map((field) => String(row[field] ?? '')).join(' | ');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const duplicates = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => newestStamp(b) - newestStamp(a));
    duplicates.push({
      key,
      rows: members.length,
      keepId: sorted[0]._id,
      dropIds: sorted.slice(1).map((row) => row._id),
    });
  }
  return duplicates;
}

/**
 * Recomputes the denormalised counters on `livesources` from the channel rows themselves.
 * Mirrors `recalcSourceCounts()` in lib/liveService.js — same rule, no shared import (that
 * module pulls in Mongoose models and the app's import aliases, which this file must not use).
 */
async function recomputeCounters(db, sourceIds = null) {
  const sourceRows = await attempt(db.collection('livesources').find({}, { projection: { sourceId: 1 } }).toArray(), []);
  const channelRows = await attempt(
    db.collection('livechannels').find({}, { projection: { sourceId: 1, catalogs: 1, selected: 1, hidden: 1 } }).toArray(),
    [],
  );
  const wanted = sourceIds ? new Set(sourceIds.map(String)) : null;
  const updated = [];
  for (const source of sourceRows) {
    const id = String(source.sourceId ?? '');
    if (wanted && !wanted.has(id)) continue;
    const owned = channelRows.filter((row) => String(row.sourceId ?? '') === id);
    const mapped = owned.filter((row) => channelIsPublished(row) && row.selected === true && row.hidden !== true).length;
    await db.collection('livesources').updateOne(
      { sourceId: source.sourceId },
      { $set: { channelCount: owned.length, selectedCount: mapped, mappedCount: mapped } },
    );
    updated.push({ sourceId: id, channels: owned.length, mapped });
  }
  return updated;
}

// ── the audit (read-only) ────────────────────────────────────────────────────────────

async function auditDatabase(db, options = {}) {
  const { days = 30, samples = 3 } = options;
  const nameRows = await attempt(db.listCollections({}, { nameOnly: true }).toArray(), []);
  const present = (nameRows || []).map((row) => row.name).sort();
  const known = new Set(CORE_COLLECTIONS);

  // inventory ─────────────────────────────────────────────────────────────────────────
  const collections = [];
  for (const name of present) {
    const collection = db.collection(name);
    const count = await attempt(collection.countDocuments({}), 0);
    const stats = await attempt(db.command({ collStats: name }), null);
    let newest = null;
    let oldest = null;
    if (count > 0) {
      // Tolerant: a sort on an unindexed field can exceed MongoDB's memory limit on a
      // large collection, and that must not fail the audit.
      const latest = await attempt(collection.find({}, { projection: { refreshedAt: 1, updatedAt: 1, createdAt: 1 } }).sort({ updatedAt: -1 }).limit(1).toArray(), null);
      const earliest = await attempt(collection.find({}, { projection: { refreshedAt: 1, updatedAt: 1, createdAt: 1 } }).sort({ createdAt: 1 }).limit(1).toArray(), null);
      // A collection whose rows carry no timestamp reports nothing rather than 1970.
      const newestStampValue = latest?.[0] ? newestStamp(latest[0]) : 0;
      const oldestStampValue = earliest?.[0] ? newestStamp(earliest[0]) : 0;
      newest = newestStampValue ? new Date(newestStampValue).toISOString() : null;
      oldest = oldestStampValue ? new Date(oldestStampValue).toISOString() : null;
    }
    collections.push({
      name,
      known: known.has(name),
      legacy: Boolean(LEGACY_COLLECTIONS[name]),
      count,
      bytes: stats?.size || 0,
      avgObjSize: Math.round(stats?.avgObjSize || 0),
      storageBytes: stats?.storageSize || 0,
      newest,
      oldest,
    });
  }

  const unknown = collections.filter((row) => !row.known).map((row) => ({ name: row.name, count: row.count, bytes: row.bytes }));
  const legacy = collections.filter((row) => row.legacy).map((row) => ({ name: row.name, count: row.count, bytes: row.bytes, note: LEGACY_COLLECTIONS[row.name] }));

  // duplicates ─────────────────────────────────────────────────────────────────────────
  const duplicates = {
    tamilmv_scrapes: await duplicateGroups(db, 'tamilmv_scrapes', ['key'], { projection: { key: 1, refreshedAt: 1, updatedAt: 1, _id: 1 } }),
    title_matches: await duplicateGroups(db, 'title_matches', ['key'], { projection: { key: 1, updatedAt: 1, createdAt: 1, _id: 1 } }),
  };

  // live channels ─────────────────────────────────────────────────────────────────────
  const sourceRows = await attempt(
    db.collection('livesources').find({}, { projection: { sourceId: 1, label: 1, deleted: 1, enabled: 1, channelCount: 1, selectedCount: 1, mappedCount: 1 } }).toArray(),
    [],
  );
  const channelRows = await attempt(
    db.collection('livechannels')
      .find({}, { projection: { sourceId: 1, name: 1, catalogs: 1, favorite: 1, hidden: 1, mappingManaged: 1, epgOverride: 1, workingStatus: 1, lastSeenAt: 1, selected: 1 } })
      .toArray(),
    [],
  );

  const sourceIds = new Set(sourceRows.map((row) => String(row.sourceId ?? '')));
  const deletedSourceIds = new Set(sourceRows.filter((row) => row.deleted === true).map((row) => String(row.sourceId ?? '')));

  const buckets = { orphanSource: [], deletedSource: [], unused: [], broken: [], notSeen: [], hidden: [], published: 0, protectedCount: 0 };
  const seen = { orphanSource: 0, deletedSource: 0, deletedSourceRemovable: 0, unused: 0, broken: 0, notSeen: 0, hidden: 0 };
  const liveSourceIds = sourceRows.filter((row) => row.deleted !== true).map((row) => String(row.sourceId ?? ''));
  const filters = liveChannelFilters({ days, sourceIds: liveSourceIds });
  const cutoff = olderThan(days).getTime();

  for (const channel of channelRows) {
    const sourceId = String(channel.sourceId ?? '');
    if (channelIsProtected(channel)) buckets.protectedCount += 1;
    if (channelIsPublished(channel)) buckets.published += 1;

    const push = (bucket, label) => {
      seen[bucket] += 1;
      if (buckets[bucket].length < samples) buckets[bucket].push({ id: String(channel._id), sourceId, name: channel.name || '' , label });
    };

    if (!sourceIds.has(sourceId)) { push('orphanSource', 'source does not exist'); continue; }
    if (deletedSourceIds.has(sourceId)) {
      push('deletedSource', 'source is deleted');
      if (channel.favorite !== true) seen.deletedSourceRemovable += 1;
      continue;
    }
    if (channelIsProtected(channel) || channelIsPublished(channel)) continue;

    if (channel.hidden === true) push('hidden', 'hidden and in no catalogue');
    else if (channel.workingStatus === 'broken') push('broken', 'marked broken and in no catalogue');
    else if (channel.lastSeenAt && new Date(channel.lastSeenAt).getTime() < cutoff) push('notSeen', `not seen in ${days} days and in no catalogue`);
    else push('unused', 'never published to a catalogue');
  }

  // Denormalised counters on livesources, compared with the rows they claim to summarise.
  const counters = [];
  for (const source of sourceRows) {
    const owned = channelRows.filter((row) => String(row.sourceId ?? '') === String(source.sourceId ?? ''));
    const mapped = owned.filter((row) => channelIsPublished(row) && row.selected === true && row.hidden !== true).length;
    const expected = { channelCount: owned.length, selectedCount: mapped, mappedCount: mapped };
    const drift = {};
    for (const field of Object.keys(expected)) {
      const stored = Number(source[field] ?? 0);
      if (stored !== expected[field]) drift[field] = { stored, actual: expected[field] };
    }
    if (Object.keys(drift).length) counters.push({ sourceId: String(source.sourceId ?? ''), label: source.label || '', drift });
  }

  // vod items ──────────────────────────────────────────────────────────────────────────
  const vod = {
    total: await attempt(db.collection('voditems').countDocuments({}), 0),
    hidden: await attempt(db.collection('voditems').countDocuments({ hidden: true }), 0),
    unmatched: await attempt(db.collection('voditems').countDocuments({ tmdbMatched: { $ne: true } }), 0),
    noSources: await attempt(db.collection('voditems').countDocuments({ 'sources.0': { $exists: false } }), 0),
    noStreams: await attempt(db.collection('voditems').countDocuments({ 'streams.0': { $exists: false } }), 0),
    sampleNoStreams: await attempt(
      db.collection('voditems').find({ 'streams.0': { $exists: false } }, { projection: { title: 1, year: 1, sources: 1 } }).limit(samples).toArray(),
      [],
    ),
  };

  // indexes ────────────────────────────────────────────────────────────────────────────
  const indexInventory = [];
  const missingIndexes = [];
  const unusedIndexes = [];
  for (const name of present) {
    const collection = db.collection(name);
    const indexes = await attempt(collection.listIndexes().toArray(), []);
    const stats = await attempt(collection.aggregate([{ $indexStats: {} }]).toArray(), null);
    const opsByName = new Map((stats || []).map((row) => [row.name, row.accesses?.ops ?? 0]));

    for (const index of indexes || []) {
      indexInventory.push({ collection: name, name: index.name, keys: index.key, unique: Boolean(index.unique), ops: opsByName.has(index.name) ? opsByName.get(index.name) : null });
    }
    for (const expected of EXPECTED_INDEXES.filter((row) => row.collection === name)) {
      const wanted = Object.keys(expected.keys).join(',');
      const found = (indexes || []).some((index) => Object.keys(index.key || {}).join(',') === wanted);
      if (!found) missingIndexes.push({ collection: name, keys: expected.keys, options: expected.options, why: expected.why });
    }
    if (stats) {
      for (const index of indexes || []) {
        if (index.name === '_id_') continue;
        const known = LOW_VALUE_INDEXES.some((row) => row.collection === name && row.name === index.name);
        // Zero ops is evidence, not proof: these stats reset whenever mongod restarts, so a
        // genuinely useful index can read 0. Only the known low-value set is ever droppable.
        if ((opsByName.get(index.name) ?? 0) === 0) unusedIndexes.push({ collection: name, name: index.name, known, droppable: known });
      }
    }
  }

  // ── the plan ─────────────────────────────────────────────────────────────────────────
  const actions = [];
  const scrapes = duplicates.tamilmv_scrapes;
  if (scrapes.length) {
    actions.push({
      id: 'scrapes.dedupe',
      tier: 'safe',
      collection: 'tamilmv_scrapes',
      label: `remove ${scrapes.reduce((sum, group) => sum + group.dropIds.length, 0)} duplicate cache row(s), keeping the freshest`,
      count: scrapes.reduce((sum, group) => sum + group.dropIds.length, 0),
    });
  }
  const matches = duplicates.title_matches;
  if (matches.length) {
    actions.push({
      id: 'matches.dedupe',
      tier: 'safe',
      collection: 'title_matches',
      label: `remove ${matches.reduce((sum, group) => sum + group.dropIds.length, 0)} duplicate title match row(s), keeping the freshest`,
      count: matches.reduce((sum, group) => sum + group.dropIds.length, 0),
    });
  }
  if (seen.orphanSource) {
    actions.push({ id: 'live.orphan-source', tier: 'safe', collection: 'livechannels', label: `remove ${seen.orphanSource} channel(s) whose source no longer exists`, count: seen.orphanSource });
  }
  if (seen.deletedSourceRemovable) {
    const kept = seen.deletedSource - seen.deletedSourceRemovable;
    actions.push({
      id: 'live.deleted-source',
      tier: 'all',
      collection: 'livechannels',
      label: `remove ${seen.deletedSourceRemovable} channel(s) belonging to a deleted source${kept ? ` (keeping ${kept} favourited)` : ''}`,
      count: seen.deletedSourceRemovable,
    });
  }
  for (const mode of ['unused', 'broken', 'notSeen', 'hidden']) {
    if (seen[mode]) {
      actions.push({
        id: `live.${mode === 'notSeen' ? 'not-seen' : mode}`,
        tier: 'all',
        collection: 'livechannels',
        mode,
        label: `remove ${seen[mode]} channel(s) — ${mode === 'notSeen' ? `not seen in ${days} days` : mode} and in no catalogue (favourites protected)`,
        count: seen[mode],
        filter: filters[mode],
      });
    }
  }
  if (counters.length) {
    actions.push({ id: 'live.counters', tier: 'safe', collection: 'livesources', label: `recompute the counters on ${counters.length} source(s) from the actual channel rows`, count: counters.length, repair: true });
  }
  for (const missing of missingIndexes) {
    actions.push({ id: 'index.create', tier: 'safe', collection: missing.collection, label: `create ${missing.options.name || Object.keys(missing.keys).join('_')} — ${missing.why}`, count: 1, index: missing });
  }
  // The known low-value set is droppable by design (low-cardinality booleans, and a text index
  // nothing queries), so its presence decides — not its usage count. That matters: a cleanup
  // query can itself warm one of them (`hidden: true` uses hidden_1), and a decision that flips
  // depending on which pass ran first is not a decision. Ops are still reported as evidence.
  const droppableIndexes = LOW_VALUE_INDEXES
    .map((known) => ({
      collection: known.collection,
      name: known.name,
      why: known.why,
      ops: indexInventory.find((index) => index.collection === known.collection && index.name === known.name)?.ops ?? null,
    }))
    .filter((row) => indexInventory.some((index) => index.collection === row.collection && index.name === row.name));
  if (droppableIndexes.length) {
    actions.push({
      id: 'index.drop-unused',
      tier: 'explicit',
      collection: [...new Set(droppableIndexes.map((row) => row.collection))].join(', '),
      label: `drop ${droppableIndexes.length} known low-value index(es): ${droppableIndexes.map((row) => `${row.collection}.${row.name}`).join(', ')} (explicit flag only)`,
      count: droppableIndexes.length,
      indexes: droppableIndexes,
    });
  }
  for (const row of legacy) {
    actions.push({ id: `collection.drop:${row.name}`, tier: 'explicit', collection: row.name, label: `drop the legacy collection ${row.name} (${row.count} docs, ${row.bytes} bytes) — explicit flag only`, count: row.count, drop: row.name });
  }
  for (const row of unknown) {
    actions.push({ id: `collection.drop:${row.name}`, tier: 'explicit', collection: row.name, label: `drop the unknown collection ${row.name} (${row.count} docs) — the app never reads it`, count: row.count, drop: row.name });
  }

  const totalDocuments = collections.reduce((sum, row) => sum + row.count, 0);
  const totalBytes = collections.reduce((sum, row) => sum + row.bytes, 0);

  return {
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    options: { days, samples },
    summary: { collections: collections.length, documents: totalDocuments, bytes: totalBytes, unknown: unknown.length, legacy: legacy.length },
    collections,
    unknown,
    legacy,
    duplicates,
    live: { buckets, seen, counters, sources: sourceRows.length, channels: channelRows.length },
    vod,
    indexes: { inventory: indexInventory, missing: missingIndexes, unused: unusedIndexes },
    actions,
    notes: [
      'Nothing has been changed. This audit only reads.',
      'VodItem rows with no `sources` are still listed by /api/vod (it filters on `hidden` only), so they are reported here and never deleted automatically.',
      'Catalogue overrides and manual title matches are reported, never removed: they are work that cannot be regenerated.',
      'Live-channel deletions protect favourites in every mode — stricter than the in-app purge for its `broken`/`hidden` modes.',
      'Index usage stats reset when mongod restarts, so "no recorded use" is a hint. Only the known low-value indexes are ever dropped by the flag.',
    ],
  };
}

// ── applying the plan ────────────────────────────────────────────────────────────────

/**
 * Executes the plan from an audit. `tier` picks how much of it runs:
 *   'safe' — duplicates, channels whose source is gone, counter repairs, index creation.
 *   'all'  — adds the app's own unused/broken/not-seen/hidden channel rules.
 * Explicit actions (index drops, collection drops) additionally require their id/name.
 */
async function applyPlan(db, report, options = {}) {
  const { tier = 'safe', drops = [], dropIndexes = false, onLog = () => {} } = options;
  // 'none' means "explicit actions only" — asking to drop one collection should not also run
  // the safe tier behind your back.
  const allowed = tier === 'all' ? new Set(['safe', 'all']) : tier === 'safe' ? new Set(['safe']) : new Set();
  const applied = [];
  const skipped = [];
  let channelsDeleted = 0;

  const wantedDrops = new Set(drops);
  const plan = report.actions.filter((action) => {
    if (action.tier === 'explicit') {
      if (action.drop) return wantedDrops.has(action.drop);
      if (action.id === 'index.drop-unused') return dropIndexes;
      return false;
    }
    return allowed.has(action.tier);
  });

  for (const action of plan) {
    if (action.id === 'scrapes.dedupe' || action.id === 'matches.dedupe') {
      const name = action.id === 'scrapes.dedupe' ? 'tamilmv_scrapes' : 'title_matches';
      const duplicates = action.id === 'scrapes.dedupe' ? report.duplicates.tamilmv_scrapes : report.duplicates.title_matches;
      const dropIds = duplicates.flatMap((group) => group.dropIds);
      const result = await db.collection(name).deleteMany({ _id: { $in: dropIds } });
      applied.push({ id: action.id, collection: name, removed: result.deletedCount || 0, note: 'kept the freshest row in each duplicate group' });
      onLog(`  ✓ ${action.id}: removed ${result.deletedCount || 0}`);
      continue;
    }

    if (action.id === 'live.orphan-source') {
      const sourceRows = await attempt(db.collection('livesources').find({}, { projection: { sourceId: 1 } }).toArray(), []);
      const ids = sourceRows.map((row) => String(row.sourceId ?? ''));
      const result = await db.collection('livechannels').deleteMany({ sourceId: { $nin: ids } });
      applied.push({ id: action.id, collection: 'livechannels', removed: result.deletedCount || 0, note: 'no livesources row exists for their sourceId' });
      onLog(`  ✓ ${action.id}: removed ${result.deletedCount || 0}`);
      continue;
    }

    if (action.id === 'live.deleted-source') {
      const sourceRows = await attempt(db.collection('livesources').find({ deleted: true }, { projection: { sourceId: 1 } }).toArray(), []);
      const ids = sourceRows.map((row) => String(row.sourceId ?? ''));
      const result = await db.collection('livechannels').deleteMany({ sourceId: { $in: ids }, favorite: { $ne: true } });
      applied.push({ id: action.id, collection: 'livechannels', removed: result.deletedCount || 0, note: 'favourites were kept' });
      channelsDeleted += result.deletedCount || 0;
      onLog(`  ✓ ${action.id}: removed ${result.deletedCount || 0}`);
      continue;
    }

    if (action.id.startsWith('live.') && action.mode) {
      const sourceRows = await attempt(db.collection('livesources').find({ deleted: { $ne: true } }, { projection: { sourceId: 1 } }).toArray(), []);
      const sourceIds = sourceRows.map((row) => String(row.sourceId ?? ''));
      const filter = liveChannelFilters({ days: report.options?.days || 30, sourceIds })[action.mode];
      const result = await db.collection('livechannels').deleteMany(filter);
      applied.push({ id: action.id, collection: 'livechannels', removed: result.deletedCount || 0, note: 'favourites, manual maps and guide overrides protected' });
      channelsDeleted += result.deletedCount || 0;
      onLog(`  ✓ ${action.id}: removed ${result.deletedCount || 0}`);
      continue;
    }

    if (action.id === 'live.counters') {
      const updated = await recomputeCounters(db, report.live.counters.map((row) => row.sourceId));
      for (const row of updated) onLog(`  ✓ live.counters: ${row.sourceId} → ${row.channels} channels, ${row.mapped} mapped`);
      applied.push({ id: action.id, collection: 'livesources', removed: 0, repaired: updated.length, note: 'mirrors recalcSourceCounts() in lib/liveService.js' });
      continue;
    }

    if (action.id === 'index.create') {
      const { collection, keys, options: indexOptions } = action.index;
      try {
        await db.collection(collection).createIndex(keys, indexOptions);
        applied.push({ id: action.id, collection, removed: 0, created: indexOptions.name || Object.keys(keys).join('_') });
        onLog(`  ✓ index.create: ${collection}.${indexOptions.name || Object.keys(keys).join('_')}`);
      } catch (error) {
        skipped.push({ id: action.id, collection, error: error.message });
        onLog(`  ✗ index.create: ${collection}.${indexOptions.name || ''} — ${error.message}`);
      }
      continue;
    }

    if (action.id === 'index.drop-unused') {
      for (const index of action.indexes) {
        try {
          await db.collection(index.collection).dropIndex(index.name);
          applied.push({ id: action.id, collection: index.collection, removed: 0, dropped: index.name });
          onLog(`  ✓ index.drop-unused: ${index.collection}.${index.name}`);
        } catch (error) {
          skipped.push({ id: action.id, collection: index.collection, error: error.message });
          onLog(`  ✗ index.drop-unused: ${index.collection}.${index.name} — ${error.message}`);
        }
      }
      continue;
    }

    if (action.drop) {
      try {
        await db.dropCollection(action.drop);
        applied.push({ id: action.id, collection: action.drop, removed: action.count, note: 'collection dropped' });
        onLog(`  ✓ collection.drop: ${action.drop}`);
      } catch (error) {
        skipped.push({ id: action.id, collection: action.drop, error: error.message });
        onLog(`  ✗ collection.drop: ${action.drop} — ${error.message}`);
      }
      continue;
    }

    skipped.push({ id: action.id, reason: 'no executor' });
  }

  // Deleting channels invalidates the counters that summarise them. Without this, `--all` would
  // leave the database drifting by its own hand and the very next audit would ask for a repair.
  if (channelsDeleted && allowed.has('safe')) {
    const updated = await recomputeCounters(db);
    for (const row of updated) onLog(`  ✓ live.counters (after deletions): ${row.sourceId} → ${row.channels} channels, ${row.mapped} mapped`);
    applied.push({ id: 'live.counters.after-deletions', collection: 'livesources', removed: 0, repaired: updated.length, note: `${channelsDeleted} channel(s) removed in this run` });
  }

  const notSelected = report.actions.filter((action) => !plan.includes(action)).map((action) => ({ id: action.id, tier: action.tier, label: action.label }));
  return { applied, skipped, notSelected };
}


module.exports = {
  CORE_COLLECTIONS,
  LEGACY_COLLECTIONS,
  EXPECTED_INDEXES,
  LOW_VALUE_INDEXES,
  auditDatabase,
  applyPlan,
  channelIsProtected,
  channelIsPublished,
  duplicateGroups,
  liveChannelFilters,
  newestStamp,
};
