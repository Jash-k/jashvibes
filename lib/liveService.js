import crypto from 'crypto';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { getDefaultLiveSources, parseLiveSourceChannels, checkLiveChannelUrl, isPreferredCricketChannel } from '@/lib/liveTv';
import {
  buildCatalogSummary,
  normalizeCatalogMemberships,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';

export function normalizeLiveKey(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugify(value = '') {
  return normalizeLiveKey(value).replace(/\s+/g, '-') || 'item';
}

function channelHash(channel = {}) {
  return crypto.createHash('sha1').update(`${channel.sourceId || ''}|${channel.name || ''}|${channel.url || ''}`).digest('hex').slice(0, 16);
}

export function channelDocFromParsed(channel = {}, source = {}) {
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
    name: obj.customName || obj.name,
    originalName: obj.name,
    url: obj.url,
    logo: obj.customLogo || obj.logo || '',
    category: obj.category || 'Live',
    sourceCategory: obj.category || 'Live',
    catalogs,
    catalogIds,
    mapped: catalogIds.length > 0,
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
    channelCount: obj.channelCount || 0,
    selectedCount: obj.selectedCount || 0,
    mappedCount: obj.mappedCount ?? obj.selectedCount ?? 0,
    lastSyncedAt: obj.lastSyncedAt || null,
    lastError: obj.lastError || '',
  };
}

// Onboarding for a newly introduced default source: publish only the curated
// Tamil cricket feeds (Star Sports Tamil, Sony Ten 4 Tamil…) so the headline
// sports channels work immediately after the source appears. Every other
// channel from the source still stays unmapped until the administrator maps
// it manually — source syncs can never bulk-publish channels.
async function autoMapNewSourceCricketChannels(sourceId) {
  const docs = await LiveChannel.find({ sourceId, 'catalogs.0': { $exists: false } }).lean();
  const cricketDocs = docs.filter((doc) => isPreferredCricketChannel(toClientChannel(doc)));
  if (!cricketDocs.length) return;

  const sportsDocs = await LiveChannel.find({ 'catalogs.catalogId': 'sports' }).select('catalogs').lean();
  let nextPosition = sportsDocs.reduce((max, doc) => {
    const membership = (doc.catalogs || []).find((item) => item.catalogId === 'sports');
    return membership ? Math.max(max, membership.position) : max;
  }, 0) + 100;

  for (const doc of cricketDocs) {
    await LiveChannel.updateOne(
      { channelId: doc.channelId },
      { $set: { catalogs: [{ catalogId: 'sports', position: nextPosition }], selected: true } },
    );
    nextPosition += 100;
  }
  await recalcSourceCounts(sourceId).catch(() => {});
}

export async function ensureLiveServiceSeeded() {
  await dbConnect();
  const defaults = getDefaultLiveSources({ includePocket: true });

  // Idempotent per-source seeding: sources added to the codebase later (e.g.
  // the Sony Ten/Sports feed) must also appear in databases that were seeded
  // by an older release. Existing records are never touched.
  const knownIds = new Set(
    (await LiveSource.find({ sourceId: { $in: defaults.map((item) => item.id) } }).select('sourceId').lean())
      .map((doc) => doc.sourceId),
  );

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
    };
    try {
      await LiveSource.create(doc);
    } catch {
      continue; // raced with a concurrent seed — already created elsewhere
    }
    // One-time onboarding fetch in the background so the new source has
    // channels ready to map without waiting for a manual first sync.
    void (async () => {
      try {
        await syncLiveSource(doc, { includeAll: true });
        await autoMapNewSourceCricketChannels(source.id);
      } catch (error) {
        console.error(`[live-service] Onboarding sync failed for ${source.id}:`, error?.message || error);
        await LiveSource.updateOne(
          { sourceId: source.id },
          { $set: { lastError: error?.message || 'Initial sync failed' } },
        ).catch(() => {});
      }
    })();
  }

  const defaultProfile = await LiveProfile.findOne({ profileId: 'default' });
  if (!defaultProfile) await LiveProfile.create({ profileId: 'default', name: 'Main', isDefault: true, order: 0 });
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

export async function syncLiveSource(sourceDoc, { includeAll = true } = {}) {
  const source = toClientSource(sourceDoc);
  const parsed = await parseLiveSourceChannels(source, { includeAll });
  const existingDocs = await LiveChannel.find({ sourceId: source.sourceId })
    .select('channelId tvgId normalizedName category')
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
  const existingByTvgId = uniqueExistingMap((item) => normalizeLiveKey(item.tvgId));
  const existingByNameGroup = uniqueExistingMap((item) => {
    const name = normalizeLiveKey(item.normalizedName);
    return name ? `${name}|${normalizeLiveKey(item.category)}` : '';
  });
  const existingByName = uniqueExistingMap((item) => normalizeLiveKey(item.normalizedName));

  // Source sync only refreshes upstream metadata. Manual catalog memberships,
  // selection, positions, favorites, profile membership, and custom labels are
  // intentionally omitted from $set so a later sync can never publish or remap
  // a channel automatically.
  const operations = parsed.map((channel) => {
    const doc = channelDocFromParsed(channel, source);
    const stableExistingId = exactIds.has(doc.channelId)
      ? doc.channelId
      : (normalizeLiveKey(doc.tvgId) && existingByTvgId.get(normalizeLiveKey(doc.tvgId)))
        || existingByNameGroup.get(`${doc.normalizedName}|${normalizeLiveKey(doc.category)}`)
        || existingByName.get(doc.normalizedName)
        || '';
    if (stableExistingId) doc.channelId = stableExistingId;
    const upstream = { ...doc };
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
          $setOnInsert: {
            selected: false,
            favorite: false,
            hidden: false,
            order: 9999,
            profiles: ['default'],
            catalogs: [],
          },
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

export async function getSelectedLiveChannels({ profileId = 'default', catalogId = '', playableOnly = false } = {}) {
  await ensureLiveServiceSeeded();
  const filter = {
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
  await ensureLiveServiceSeeded();
  const configuredCount = await LiveChannel.countDocuments({ 'catalogs.0': { $exists: true } });
  const channels = configuredCount > 0
    ? await getSelectedLiveChannels({ profileId, playableOnly })
    : [];
  return {
    configured: configuredCount > 0,
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
