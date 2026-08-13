import crypto from 'crypto';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { getDefaultLiveSources, parseLiveSourceChannels, checkLiveChannelUrl } from '@/lib/liveTv';

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
    lastSyncedAt: obj.lastSyncedAt || null,
    lastError: obj.lastError || '',
  };
}

export async function ensureLiveServiceSeeded() {
  await dbConnect();
  const count = await LiveSource.countDocuments();
  if (count === 0) {
    const defaults = getDefaultLiveSources({ includePocket: true }).map((source, index) => ({
      sourceId: source.id,
      label: source.label,
      type: source.type,
      url: source.url,
      enabled: true,
      trustTamil: Boolean(source.trustTamil),
      priority: source.id === 'jio-tamil' ? -100 : source.priority ?? index,
    }));
    if (defaults.length) await LiveSource.insertMany(defaults, { ordered: false }).catch(() => {});
  }

  const defaultProfile = await LiveProfile.findOne({ profileId: 'default' });
  if (!defaultProfile) await LiveProfile.create({ profileId: 'default', name: 'Main', isDefault: true, order: 0 });
}

export async function recalcSourceCounts(sourceId = '') {
  const match = sourceId ? { sourceId } : {};
  const sources = sourceId ? await LiveSource.find({ sourceId }) : await LiveSource.find({});
  for (const source of sources) {
    const channelCount = await LiveChannel.countDocuments({ sourceId: source.sourceId });
    const selectedCount = await LiveChannel.countDocuments({ sourceId: source.sourceId, selected: true, hidden: { $ne: true } });
    await LiveSource.updateOne({ sourceId: source.sourceId }, { $set: { channelCount, selectedCount } });
  }
}

export async function syncLiveSource(sourceDoc, { includeAll = true, autoSelectPopular = false } = {}) {
  const source = toClientSource(sourceDoc);
  const parsed = await parseLiveSourceChannels(source, { includeAll });
  let stored = 0;
  for (const channel of parsed) {
    const doc = channelDocFromParsed(channel, source);
    const existing = await LiveChannel.findOne({ channelId: doc.channelId }).select('selected favorite hidden order profiles customName customLogo');
    const set = { ...doc };
    if (!existing && autoSelectPopular) {
      const key = normalizeLiveKey(doc.name);
      if (/star vijay|sun tv|zee tamil|ktv|vijay super|adithya|thanthi|news18 tamil|polimer|puthiya|jaya tv/.test(key)) set.selected = true;
    }
    await LiveChannel.updateOne(
      { channelId: doc.channelId },
      {
        $set: set,
        $setOnInsert: {
          selected: Boolean(set.selected),
          favorite: false,
          hidden: false,
          order: 9999,
          profiles: ['default'],
        },
      },
      { upsert: true },
    );
    stored += 1;
  }

  await LiveSource.updateOne(
    { sourceId: source.sourceId },
    { $set: { lastSyncedAt: new Date(), lastError: '', channelCount: stored } },
  );
  await recalcSourceCounts(source.sourceId);
  return { parsed: parsed.length, stored };
}

export async function getSelectedLiveChannels({ profileId = 'default' } = {}) {
  await ensureLiveServiceSeeded();
  const docs = await LiveChannel.find({
    selected: true,
    hidden: { $ne: true },
    profiles: profileId,
  }).sort({ order: 1, favorite: -1, name: 1 }).lean();
  return docs.map(toClientChannel);
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
