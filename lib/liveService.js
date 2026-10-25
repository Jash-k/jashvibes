import { getSetting } from '@/models/Setting';
import crypto from 'crypto';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import { isDeadSourceUrl } from '@/lib/liveTv';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { getDefaultLiveSources, parseLiveSourceChannels, checkLiveChannelUrl, isPreferredCricketChannel, isPocketWantedChannel, pocketKey, probeLiveSourceUrl } from '@/lib/liveTv';
import {
  buildCatalogSummary,
  isLiveCatalogId,
  normalizeCatalogMemberships,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';
import { isDummyVariant, logicalIdForChannel } from '@/lib/live/pipeline/deduplicate.js';
import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';
import { autoCatalogRank, classifyChannelCatalogs, isReligiousChannel } from '@/lib/live/catalogRules';

export function normalizeLiveKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(value = '') {
  return normalizeLiveKey(value).replace(/\s+/g, '-') || 'item';
}

function channelHash(channel = {}) {
  return crypto.createHash('sha1').update(`${channel.sourceId || ''}|${channel.name || ''}|${channel.url || ''}`).digest('hex').slice(0, 16);
}

function channelDocFromParsed(channel = {}, source = {}) {
  const sourceId = source.sourceId || source.id || channel.sourceId || 'source';
  const channelId = `${sourceId}-${channelHash({ ...channel, sourceId })}`;
  return {
    channelId,
    sourceId,
    source: source.label || source.name || channel.source || sourceId,
    tvgId: channel.tvgId || '',
    name: channel.name || 'Channel',
    normalizedName: normalizeLiveKey(channel.name || ''),
    url: channel.url || '',
    logo: channel.logo || '',
    category: channel.category || 'Live',
    language: channel.language || '',
    region: channel.region || '',
    format: channel.format || 'unknown',
    playable: channel.playable !== false,
    keyId: channel.keyId || '',
    key: channel.key || '',
    licenseKey: channel.licenseKey || '',
    licenseType: channel.licenseType || '',
    cookie: channel.cookie || '',
    userAgent: channel.userAgent || '',
    referer: channel.referer || '',
    headers: channel.headers || {},
    lastSeenAt: new Date(),
    importHash: channelHash({ ...channel, sourceId }),
  };
}

export function toClientChannel(doc = {}) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  const catalogs = normalizeCatalogMemberships(obj.catalogs || []);
  const catalogIds = catalogs.map((item) => item.catalogId);
  return {
    id: obj.channelId,
    channelId: obj.channelId,
    sourceId: obj.sourceId,
    source: obj.source,
    tvgId: obj.tvgId || '',
    epgOverride: obj.epgOverride ?? null,
    name: obj.customName || obj.name,
    originalName: obj.name,
    url: obj.url,
    logo: obj.customLogo || obj.logo || '',
    category: obj.category || 'Live',
    sourceCategory: obj.category || 'Live',
    catalogs,
    catalogIds,
    mapped: catalogIds.length > 0,
    mappingManaged: Boolean(obj.mappingManaged),
    logicalChannelId: obj.logicalChannelId || '',
    availability: obj.autoHidden ? 'unavailable' : obj.workingStatus || 'unknown',
    language: obj.language || '',
    region: obj.region || '',
    format: obj.format || 'unknown',
    playable: obj.playable !== false,
    selected: Boolean(obj.selected),
    favorite: Boolean(obj.favorite),
    hidden: Boolean(obj.hidden),
    order: obj.order ?? 9999,
    profiles: obj.profiles || ['default'],
    keyId: obj.keyId || '',
    key: obj.key || '',
    licenseKey: obj.licenseKey || '',
    licenseType: obj.licenseType || '',
    cookie: obj.cookie || '',
    userAgent: obj.userAgent || '',
    referer: obj.referer || '',
    headers: obj.headers || {},
    workingStatus: obj.workingStatus || 'unknown',
    lastCheckedAt: obj.lastCheckedAt || null,
    lastSeenAt: obj.lastSeenAt || null,
    religious: isReligiousChannel(obj),
    ladderOrder: Array.isArray(obj.ladderOrder) ? obj.ladderOrder.filter(Boolean) : [],
  };
}

/**
 * What a brand-new channel row starts life with.
 *
 * A source may nominate a catalog (autoMapCatalog) so a freshly synced feed is
 * visible straight away instead of waiting for a mapping session — the Sony
 * sports feed is configured this way. Anything else arrives unselected and
 * unmapped, which is what an administrator expects from every other source.
 *
 * This is only ever used as a $setOnInsert payload, so it can never touch an
 * existing row: an administrator's manual mapping always wins. Exported so the
 * contract is tested without a database.
 */
export function autoMapInsertDefaults(source = {}, index = 0) {
  const catalogId = isLiveCatalogId(source.autoMapCatalog)
    ? String(source.autoMapCatalog).trim().toLowerCase()
    : '';
  return {
    selected: Boolean(catalogId),
    favorite: false,
    hidden: false,
    order: 9999,
    profiles: ['default'],
    catalogs: catalogId ? [{ catalogId, position: (index + 1) * 100 }] : [],
  };
}

export function toClientSource(doc = {}) {
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    id: obj.sourceId || obj.id,
    sourceId: obj.sourceId || obj.id,
    label: obj.label || obj.name,
    type: obj.type || 'm3u',
    url: obj.url || '',
    enabled: obj.enabled !== false,
    trustTamil: Boolean(obj.trustTamil),
    priority: obj.priority ?? 99,
    autoPurge: Boolean(obj.autoPurge),
    deleted: Boolean(obj.deleted),
    headers: obj.headers || {},
    titleFilter: obj.titleFilter || '',
    autoMapCatalog: obj.autoMapCatalog || '',
    channelCount: obj.channelCount || 0,
    selectedCount: obj.selectedCount || 0,
    mappedCount: obj.mappedCount ?? obj.selectedCount ?? 0,
    lastSyncedAt: obj.lastSyncedAt || null,
    lastError: obj.lastError || '',
  };
}

let healPassDone = false;

/*
 * A2 — the seeding pass is gated to once per process.
 *
 * Everything inside is idempotent housekeeping: add default sources a newer release
 * introduced, repoint ones whose host died, retry ones sitting empty. It ran on
 * *every* catalogue read — twice per /api/live-tv call, because both
 * getLiveCatalogState() and getSelectedLiveChannels() called it — which measured at
 * 22 database round-trips per request. Locally that is ~40 ms; against a managed
 * cluster 10–30 ms away it is 220–660 ms of pure waiting on every page load.
 *
 * New sources only ever arrive with a deploy, and a deploy restarts the process, so
 * once per process is enough. It also stops a default source an administrator
 * deleted from being resurrected by the very next request.
 */
let seedPassDone = false;
let seedPassRunning = null;

export async function ensureLiveServiceSeeded() {
  await dbConnect();
  if (seedPassDone) return;
  // Concurrent callers share one pass instead of each issuing their own.
  if (seedPassRunning) return seedPassRunning;
  seedPassRunning = runSeedPass();
  try {
    await seedPassRunning;
    seedPassDone = true;
  } finally {
    seedPassRunning = null;
  }
}

async function runSeedPass() {
  // Preserve existing records. Source registry tombstones prevent reseeding deletions.
  const defaults = getDefaultLiveSources({ includePocket: true });

  // One query now serves both checks below: which defaults are still missing, and
  // which already-stored sources point at a dead host. The self-heal repoint loop
  // used to issue its own findOne per default on every single call.
  const existing = await LiveSource
    .find({ sourceId: { $in: defaults.map((item) => item.id) } })
    .select('sourceId url')
    .lean();
  const knownIds = new Set(existing.map((doc) => doc.sourceId));
  const urlById = new Map(existing.map((doc) => [doc.sourceId, doc.url]));

  for (const [index, source] of defaults.entries()) {
    if (knownIds.has(source.id)) continue;
    const doc = {
      sourceId: source.id,
      label: source.label,
      type: source.type,
      url: source.url,
      enabled: true,
      trustTamil: Boolean(source.trustTamil),
      priority: source.id === 'jio-tamil' ? -100 : source.priority ?? index,
      autoPurge: Boolean(source.autoPurge),
      titleFilter: String(source.titleFilter || ''),
      autoMapCatalog: String(source.autoMapCatalog || ''),
    };
    try {
      await LiveSource.create(doc);
    } catch {
      continue; // raced with a concurrent seed — already created elsewhere
    }
    // One-time onboarding fetch in the background so the new source has
    // channels ready to map without waiting for a manual first sync.
    syncInBackground(doc, 'Onboarding');
  }

/**
 * Fire-and-forget sync for a source document. Never awaited: seeding, healing
 * and repointing all happen while a request is in flight, and none of them may
 * block it. A failure lands in lastError where the Admin panel shows it.
 */
function syncInBackground(doc, reason = '') {
  void (async () => {
    try {
      await syncLiveSource(doc, { includeAll: true });
    } catch (error) {
      console.error(`[live-service] ${reason || 'background'} sync failed for ${doc?.sourceId}:`, error?.message || error);
      await LiveSource.updateOne(
        { sourceId: doc?.sourceId },
        { $set: { lastError: error?.message || 'Sync failed' } },
      ).catch(() => {});
    }
  })();
}

  // v11 self-heal: a database seeded by an older release can still hold a
  // default source whose URL points at a host that no longer resolves — the
  // Sony feed moved hosts entirely, so that document would fail every sync
  // forever while looking healthy in the Admin list. Repoint it at the current
  // default. Only URLs we know are dead are touched; a URL an administrator
  // typed themselves is left alone.
  for (const source of defaults) {
    if (isDeadSourceUrl(source.url)) continue;
    // Only a source the query above already flagged as dead costs a query here, so a
    // healthy registry issues none at all.
    if (!isDeadSourceUrl(urlById.get(source.id) || '')) continue;
    try {
      const doc = await LiveSource.findOne({ sourceId: source.id }).lean();
      if (!doc) continue;
      await LiveSource.updateOne(
        { sourceId: source.id },
        { $set: {
          url: source.url,
          label: source.label,
          type: source.type,
          titleFilter: String(source.titleFilter || ''),
          autoMapCatalog: String(source.autoMapCatalog || ''),
          lastError: '',
          // lastSyncedAt must go too. The heal pass below skips any source that
          // has synced before without error, and this one has: the old release
          // "synced" it into zero channels. Left alone, the row would look
          // healthy and stay empty until the next hourly pass.
          lastSyncedAt: null,
        } },
      );
      console.log(`[live-service] self-heal: repointed dead source '${source.id}' to ${source.url}`);
      // And fetch it now — clearing the timestamp only helps a heal pass that
      // has not already run this process.
      syncInBackground({ ...doc, ...source, sourceId: source.id }, 'repoint');
    } catch { /* best-effort: never block boot on housekeeping */ }
  }
  // v12 id alignment: the v12 registry called the iptv-org Tamil feed
  // 'tamil-iptv' while the sync pipeline/DEFAULT_SOURCES writes
  // 'iptv-org-tamil'. Rows synced under the registry id were invisible to the
  // /live source tabs. Repoint any leftovers once; the unique channelId also
  // embeds the sourceId, so rewrite both fields together.
  try {
    const legacyChannels = await LiveChannel.find({ sourceId: 'tamil-iptv' }).select('channelId').lean();
    if (legacyChannels.length) {
      const ops = legacyChannels
        .filter((doc) => String(doc.channelId || '').startsWith('tamil-iptv-'))
        .map((doc) => ({
          updateOne: {
            filter: { channelId: doc.channelId },
            update: { $set: { sourceId: 'iptv-org-tamil', channelId: `iptv-org-tamil-${doc.channelId.slice('tamil-iptv-'.length)}` } },
          },
        }));
      if (ops.length) await LiveChannel.bulkWrite(ops, { ordered: false });
      await LiveChannel.updateMany({ sourceId: 'tamil-iptv' }, { $set: { sourceId: 'iptv-org-tamil' } });
      await LiveSource.updateMany({ sourceId: 'tamil-iptv' }, { $set: { sourceId: 'iptv-org-tamil' } });
      console.log(`[live-service] migrated ${legacyChannels.length} channel(s) from tamil-iptv -> iptv-org-tamil`);
    }
  } catch { /* best-effort */ }

  // Fix old custom sources that pasted github.com/blob HTML view — those never parse (0 EXTINF)
  try{
    const blobFix = await LiveSource.find({ url: /github\.com\/.*\/blob\// }).lean();
    for(const doc of blobFix){
      const fixed = String(doc.url).replace('github.com','raw.githubusercontent.com').replace('/blob/','/');
      await LiveSource.updateOne({ sourceId: doc.sourceId }, { $set: { url: fixed, lastError: '' } });
      console.log(`[live-service] fixed github blob URL for '${doc.sourceId}' → ${fixed}`);
      syncInBackground({ ...doc, url: fixed }, 'blob-fix');
    }
  }catch{}

  const defaultProfile = await LiveProfile.findOne({ profileId: 'default' });
  if (!defaultProfile) await LiveProfile.create({ profileId: 'default', name: 'Main', isDefault: true, order: 0 });

  // v10.8.1 self-heal: a default source whose onboarding sync failed (or that
  // otherwise sits at zero channels and never completed a sync) is retried on
  // the next boot. A half-seeded database — source doc without channels — must
  // never stay stuck: this is what restored Pocket Tamil automatically.
  if (!healPassDone) {
    healPassDone = true;
    for (const source of defaults) {
      try {
        const doc = await LiveSource.findOne({ sourceId: source.id }).lean();
        if (!doc) continue; // created above; onboarding sync already queued
        const channelCount = await LiveChannel.countDocuments({ sourceId: source.id });
        if (channelCount > 0) continue;
        // v11: a default source sitting at zero channels is retried on every
        // boot, even when its last sync reported no error. "Synced cleanly into
        // nothing" is precisely what a dead host or a feed the parser could not
        // read looks like — both are cured by new code, not by another sync
        // being impossible. Every Sony channel was lost this way: the feed was
        // fine, the field name was not, and the row looked healthy.
        // Custom sources are left alone; an administrator's own feed may be
        // legitimately empty.
        console.log(`[live-service] self-heal: resyncing '${source.id}' (0 channels)`);
        syncInBackground(doc, 'self-heal');
      } catch { /* heal pass is best-effort */ }
    }
  }
}

export async function recalcSourceCounts(sourceId = '') {
  const sources = sourceId ? await LiveSource.find({ sourceId }) : await LiveSource.find({});
  for (const source of sources) {
    const channelCount = await LiveChannel.countDocuments({ sourceId: source.sourceId });
    const mappedFilter = {
      sourceId: source.sourceId,
      'catalogs.0': { $exists: true },
      selected: true,
      hidden: { $ne: true },
    };
    const mappedCount = await LiveChannel.countDocuments(mappedFilter);
    await LiveSource.updateOne(
      { sourceId: source.sourceId },
      { $set: { channelCount, selectedCount: mappedCount, mappedCount } },
    );
  }
}

/**
 * Sync every enabled source (or one sourceId) sequentially. This is the body
 * of POST /api/live-service/sync, extracted so the hourly auto-sync scheduler
 * runs byte-identical logic without an HTTP hop.
 */
export async function syncAllLiveSources({ sourceId = '', includeAll = true } = {}) {
  await ensureLiveServiceSeeded();
  const sources = sourceId
    ? await LiveSource.find({ sourceId })
    : await LiveSource.find({ enabled: { $ne: false } }).sort({ priority: 1 });
  if (!sources.length) {
    throw Object.assign(new Error('No source found'), { status: 404 });
  }
  const results = [];
  for (const source of sources) {
    try {
      const syncStartedAt = new Date();
      const result = await syncLiveSource(source, { includeAll });

      if (source.autoPurge) {
        // Remove only stale candidates not present in this sync. Deleting every
        // unmapped row here would erase the fresh catalog before it can be mapped.
        await LiveChannel.deleteMany({
          sourceId: source.sourceId,
          'catalogs.0': { $exists: false },
          favorite: { $ne: true },
          mappingManaged: { $ne: true },
          epgOverride: null,
          $or: [
            { lastSeenAt: { $lt: syncStartedAt } },
            { lastSeenAt: { $exists: false } },
          ],
        });
        await recalcSourceCounts(source.sourceId);
      }
      results.push({ sourceId: source.sourceId, ok: true, ...result });
    } catch (error) {
      await LiveSource.updateOne(
        { sourceId: source.sourceId },
        { $set: { lastError: error.message || 'Sync failed' } },
      ).catch(() => {});
      results.push({ sourceId: source.sourceId, ok: false, error: error.message || 'Sync failed' });
    }
  }
  // Keep the persisted logical grouping and auto catalog mapping in step with
  // the fresh rows. Never fatal — a mapping failure must not mark a successful
  // sync as failed.
  try {
    await rebuildLiveGroupingAndCatalogs();
  } catch (error) {
    console.error('[live-service] grouping/catalog rebuild failed:', error?.message || error);
  }
  return results;
}

/**
 * Pure planning half of the background grouping pass. Given the full set of
 * channel documents, returns the two bulk-write operation sets needed:
 *
 *   groupOps   — logicalChannelId refreshes (same id the in-memory dedup uses)
 *   catalogOps — catalog memberships for eligible, still-unmapped Tamil rows
 *
 * Eligibility: playable, URL present, not hidden, not a dummy licence row,
 * passes the Tamil mainstream filter, never manually mapped and not already
 * mapped. Owners' rows (mappingManaged) and existing positions are never
 * included, so the plan is safe to apply after every sync. Kept side-effect
 * free so the whole decision is unit-testable without a database.
 */
export function planLiveGroupingAndCatalogs(docs = []) {
  const groupOps = [];
  for (const doc of docs) {
    const logicalId = logicalIdForChannel({
      name: doc.customName || doc.name,
      originalName: doc.name,
      category: doc.category,
      groupTitle: doc.category,
    });
    if (logicalId && doc.logicalChannelId !== logicalId) {
      groupOps.push({
        channelId: doc.channelId,
        logicalId,
        updateOne: {
          filter: { channelId: doc.channelId, logicalChannelId: { $ne: logicalId } },
          update: { $set: { logicalChannelId: logicalId } },
        },
      });
    }
  }

  const maxPosition = new Map();
  for (const doc of docs) {
    for (const membership of normalizeCatalogMemberships(doc.catalogs || [])) {
      const current = maxPosition.get(membership.catalogId) || 0;
      maxPosition.set(membership.catalogId, Math.max(current, membership.position));
    }
  }
  const nextPosition = (catalogId) => {
    const value = Math.max(100, ((maxPosition.get(catalogId) || 0) + 100));
    maxPosition.set(catalogId, value);
    return value;
  };

  const candidates = docs
    .filter((doc) => {
      if (doc.mappingManaged) return false;
      if (normalizeCatalogMemberships(doc.catalogs || []).length) return false;
      if (doc.hidden || doc.playable === false || !doc.url) return false;
      if (isDummyVariant(doc)) return false;
      return isMainstreamTamilChannel(doc, doc.sourceId);
    })
    .sort((a, b) => autoCatalogRank(a).localeCompare(autoCatalogRank(b)));

  const catalogOps = [];
  for (const doc of candidates) {
    const catalogIds = classifyChannelCatalogs(doc).filter(isLiveCatalogId);
    if (!catalogIds.length) continue;
    const memberships = catalogIds.map((catalogId) => ({ catalogId, position: nextPosition(catalogId) }));
    catalogOps.push({
      channelId: doc.channelId,
      memberships,
      updateOne: {
        filter: {
          channelId: doc.channelId,
          mappingManaged: { $ne: true },
          'catalogs.0': { $exists: false },
        },
        update: { $set: { catalogs: memberships, selected: true } },
      },
    });
  }

  return { groupOps, catalogOps, mapped: catalogOps.length };
}

/**
 * Background grouping + catalog auto-mapping.
 *
 * 1. Persists the same logical id the in-memory dedup would compute, so every
 *    reader (public /live, Admin, Stremio) groups variants identically without
 *    re-deriving the map on every request.
 * 2. Auto-maps every eligible, still-unmapped Tamil channel into the fixed
 *    catalogs (Main/Music/Sports/Kids/News/LocalCH/Others) using
 *    lib/live/catalogRules. Eligible = playable, has a URL, passes the Tamil
 *    mainstream filter, and has never been manually mapped. Rows an owner
 *    touched (mappingManaged) or already mapped are never rewritten, and
 *    existing catalog positions are kept.
 *
 * Safe to run repeatedly: every write is conditional on the row still being
 * unmapped, so re-syncs cannot move owner-curated channels.
 */
export async function rebuildLiveGroupingAndCatalogs() {
  await dbConnect();
  const docs = await LiveChannel.find({}).lean();
  if (!docs.length) return { grouped: 0, mapped: 0 };
  const { groupOps, catalogOps, mapped } = planLiveGroupingAndCatalogs(docs);
  if (groupOps.length) await LiveChannel.bulkWrite(groupOps.map((op) => ({ updateOne: op.updateOne })), { ordered: false });
  if (catalogOps.length) await LiveChannel.bulkWrite(catalogOps.map((op) => ({ updateOne: op.updateOne })), { ordered: false });
  return { grouped: groupOps.length, mapped };
}

async function syncLiveSource(sourceDoc, { includeAll = true } = {}) {
  const source = toClientSource(sourceDoc);
  const parsed = await parseLiveSourceChannels(source, { includeAll });
  const existingDocs = await LiveChannel.find({ sourceId: source.sourceId })
    .select('channelId tvgId sourceTvgId epgOverride normalizedName category')
    .lean();
  const exactIds = new Set(existingDocs.map((item) => item.channelId));

  function uniqueExistingMap(keyFor) {
    const map = new Map();
    for (const item of existingDocs) {
      const key = keyFor(item);
      if (!key) continue;
      map.set(key, map.has(key) ? null : item.channelId);
    }
    return map;
  }

  // URL-based legacy IDs are retained when a source provides a stable tvg-id,
  // or an unambiguous name/group identity. This lets sync refresh expiring URLs
  // without creating a duplicate or detaching the administrator's mappings.
  const existingByTvgId = uniqueExistingMap((item) => normalizeLiveKey(item.sourceTvgId || item.tvgId));
  const existingByNameGroup = uniqueExistingMap((item) => {
    const name = normalizeLiveKey(item.normalizedName);
    return name ? `${name}|${normalizeLiveKey(item.category)}` : '';
  });
  const existingByName = uniqueExistingMap((item) => normalizeLiveKey(item.normalizedName));

  // Source sync only refreshes upstream metadata. Manual catalog memberships,
  // selection, positions, favorites, profile membership, and custom labels are
  // intentionally omitted from $set so a later sync can never publish or remap
  // a channel automatically.
  const operations = parsed.map((channel, index) => {
    const doc = channelDocFromParsed(channel, source);
    const stableExistingId = exactIds.has(doc.channelId)
      ? doc.channelId
      : (normalizeLiveKey(doc.tvgId) && existingByTvgId.get(normalizeLiveKey(doc.tvgId)))
        || existingByNameGroup.get(`${doc.normalizedName}|${normalizeLiveKey(doc.category)}`)
        || existingByName.get(doc.normalizedName)
        || '';
    if (stableExistingId) doc.channelId = stableExistingId;
    const previous = existingDocs.find((item) => item.channelId === doc.channelId);
    const upstream = { ...doc, sourceTvgId: doc.tvgId };
    // Existing guide choices, including explicit empty, are authoritative.
    if (previous?.epgOverride != null) upstream.tvgId = previous.epgOverride;
    else if (previous && !previous.sourceTvgId && previous.tvgId) upstream.tvgId = previous.tvgId;
    delete upstream.selected;
    delete upstream.favorite;
    delete upstream.hidden;
    delete upstream.order;
    delete upstream.profiles;
    return {
      updateOne: {
        filter: { channelId: doc.channelId },
        update: {
          $set: upstream,
          $setOnInsert: autoMapInsertDefaults(source, index),
        },
        upsert: true,
      },
    };
  });

  if (operations.length) {
    await LiveChannel.bulkWrite(operations, { ordered: false });
  }

  await LiveSource.updateOne(
    { sourceId: source.sourceId },
    { $set: { lastSyncedAt: new Date(), lastError: '', channelCount: operations.length } },
  );
  await recalcSourceCounts(source.sourceId);
  return { parsed: parsed.length, stored: operations.length };
}

/*
 * A3 — short-lived catalogue cache.
 *
 * /api/live-tv is the only reader of this state, and a navigation or a double render
 * re-ran four database queries for an answer that cannot have changed in the
 * intervening milliseconds. Five seconds absorbs that and nothing more. Every Admin
 * write calls bumpLiveCatalog(), so a mapping change shows up on the next read
 * instead of after the TTL expires.
 */
const LIVE_CATALOG_CACHE_TTL_MS = Number(process.env.LIVE_CATALOG_CACHE_TTL_MS || 5_000);
const liveCatalogCache = globalThis.__jashLiveCatalogCache || { entries: new Map(), version: 0 };
globalThis.__jashLiveCatalogCache = liveCatalogCache;

// Re-exported so callers have one import site; the model files import it directly
// from lib/catalogVersion to avoid a require cycle.
export { bumpLiveCatalog } from '@/lib/catalogVersion';

async function getSelectedLiveChannels({ profileId = 'default', catalogId = '', playableOnly = false } = {}) {
  await ensureLiveServiceSeeded();
  const activeSources = await LiveSource.find({ enabled: { $ne: false }, deleted: { $ne: true } }).select('sourceId').lean();
  const filter = {
    sourceId: { $in: activeSources.map((s) => s.sourceId) },
    selected: true,
    hidden: { $ne: true },
    profiles: profileId,
    'catalogs.0': { $exists: true },
  };
  if (catalogId) filter['catalogs.catalogId'] = catalogId;
  if (playableOnly) filter.playable = { $ne: false };

  const docs = await LiveChannel.find(filter).lean();
  const channels = docs.map(toClientChannel);
  return sortChannelsForCatalog(channels, catalogId || 'all');
}

export async function getLiveCatalogState({ profileId = 'default', playableOnly = false } = {}) {
  const cacheKey = `${profileId}|${playableOnly ? 1 : 0}`;
  const cached = liveCatalogCache.entries.get(cacheKey);
  if (cached && cached.version === liveCatalogCache.version
    && Date.now() - cached.at < LIVE_CATALOG_CACHE_TTL_MS) {
    return cached.value;
  }

  const value = await loadLiveCatalogState({ profileId, playableOnly });
  liveCatalogCache.entries.set(cacheKey, { version: liveCatalogCache.version, at: Date.now(), value });
  return value;
}

async function loadLiveCatalogState({ profileId, playableOnly }) {
  await ensureLiveServiceSeeded();
  const configuredCount = await LiveChannel.countDocuments({ 'catalogs.0': { $exists: true } });
  const stored = await getSetting('live_catalog_initialized', false);
  const initialized = Boolean(stored?.initialized ?? stored);
  const channels = configuredCount > 0
    ? await getSelectedLiveChannels({ profileId, playableOnly })
    : [];
  return {
    configured: initialized || configuredCount > 0,
    configuredCount,
    channels,
    catalogs: buildCatalogSummary(channels),
  };
}

export async function checkAndUpdateChannel(channelDoc) {
  const channel = toClientChannel(channelDoc);
  const ok = await checkLiveChannelUrl(channel);
  await LiveChannel.updateOne({ channelId: channel.channelId }, {
    $set: { workingStatus: ok ? 'working' : 'broken', lastCheckedAt: new Date() },
  });
  return ok;
}

export function sourceIdFromLabel(label = '') {
  return slugify(label).slice(0, 60);
}
