import crypto from 'crypto';
import { setSetting } from '@/models/Setting';
import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import { recordAction } from '@/lib/adminAudit';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import {
  ensureLiveServiceSeeded,
  normalizeLiveKey,
  toClientChannel,
  recalcSourceCounts,
} from '@/lib/liveService';
import {
  LIVE_CATALOGS,
  isLiveCatalogId,
  normalizeCatalogMemberships,
  sortChannelsForCatalog,
} from '@/lib/liveCatalogs';
import { cleanHttpUrl, detectManualFormat } from '@/lib/live/manualChannel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function nextCatalogPosition(catalogId, increment = 100) {
  const rows = await LiveChannel.aggregate([
    { $match: { 'catalogs.catalogId': catalogId } },
    { $unwind: '$catalogs' },
    { $match: { 'catalogs.catalogId': catalogId } },
    { $group: { _id: null, maxPosition: { $max: '$catalogs.position' } } },
  ]);
  const current = Number(rows[0]?.maxPosition || 0);
  return Math.max(increment, Math.ceil(current / increment) * increment + increment);
}

/**
 * POST /api/live-service/channels
 * Owner-authored channel (not attached to a synced source). It is born
 * mappingManaged so no sync can ever overwrite or remove it, and it carries
 * the same catalog/position contract as synced rows.
 */
export async function POST(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim().slice(0, 120);
    const url = cleanHttpUrl(body.url || '');
    if (!name) return json({ ok: false, error: 'name is required' }, 400);
    if (!url) return json({ ok: false, error: 'a valid http(s) stream URL is required' }, 400);

    const catalogIds = [...new Set((body.catalogIds || []).map((item) => String(item || '').toLowerCase()).filter(isLiveCatalogId))];
    const catalogs = [];
    for (const catalogId of catalogIds) {
      catalogs.push({ catalogId, position: await nextCatalogPosition(catalogId) });
    }

    const channelId = `manual-${crypto.createHash('sha1').update(`${name}|${url}|${Date.now()}`).digest('hex').slice(0, 16)}`;
    const doc = await LiveChannel.create({
      channelId,
      sourceId: 'manual',
      source: 'Manual',
      tvgId: String(body.tvgId || '').trim().slice(0, 120),
      name,
      normalizedName: normalizeLiveKey(name),
      customName: name,
      url,
      logo: cleanHttpUrl(body.logo || '') || String(body.logo || '').trim().slice(0, 1024),
      category: String(body.category || 'Live').trim().slice(0, 80) || 'Live',
      catalogs,
      language: String(body.language || 'Tamil').trim().slice(0, 40),
      format: detectManualFormat(url, body.format),
      playable: true,
      selected: catalogs.length > 0,
      mappingManaged: true,
      profiles: ['default'],
      keyId: String(body.keyId || '').trim(),
      key: String(body.key || '').trim(),
      licenseKey: String(body.licenseKey || '').trim(),
      licenseType: String(body.licenseType || '').trim().slice(0, 60),
      cookie: String(body.cookie || '').trim(),
      userAgent: String(body.userAgent || '').trim(),
      referer: String(body.referer || '').trim(),
      headers: (body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) ? body.headers : {},
      workingStatus: 'unknown',
      lastSeenAt: new Date(),
    });

    await recalcSourceCounts('manual');
    await recordAction({
      area: 'live', action: 'live.channel.create', targetModel: 'LiveChannel',
      summary: `Created manual channel “${name}”`,
      target: { kind: 'live-channel', key: channelId, label: name },
      before: null,
      after: channelSnapshot(doc.toObject ? doc.toObject() : doc),
    });
    return json({ ok: true, channel: toClientChannel(doc) }, 201);
  } catch (error) {
    if (error?.code === 11000) return json({ ok: false, error: 'A channel with this id already exists' }, 409);
    return json({ ok: false, error: error.message }, error.status || 500);
  }
}


/** The snapshot undo restores for one channel: the owner-touched fields only. */
function channelSnapshot(doc = {}) {
  return {
    channelId: doc.channelId, name: doc.name, hidden: Boolean(doc.hidden),
    favorite: Boolean(doc.favorite), epgOverride: doc.epgOverride ?? null,
    tvgId: doc.tvgId || '', url: doc.url || '',
    catalogs: (doc.catalogs || []).map((item) => ({ catalogId: item.catalogId, position: item.position })),
  };
}

/*
 * D1 — fetch only the fields a row actually renders.
 *
 * A stored channel carries ~40 properties and every one of them was being sent to
 * the admin panel. Six are never read by `toClientChannel` at all: normalizedName is
 * a lowercased duplicate of name, createdAt/updatedAt/__v are Mongoose bookkeeping,
 * failStreak and sourceTvgId belong to the health sweep and the importer. Dropping
 * them is invisible to every caller and trims both the database transfer and the
 * memory held per page.
 */
const LIST_PROJECTION = [
  'channelId', 'sourceId', 'source', 'tvgId', 'epgOverride', 'mappingManaged',
  'logicalChannelId', 'name', 'customName', 'url', 'logo', 'customLogo', 'category',
  'catalogs', 'language', 'region', 'format', 'playable', 'selected', 'favorite',
  'hidden', 'order', 'profiles', 'keyId', 'key', 'licenseKey', 'licenseType',
  'cookie', 'userAgent', 'referer', 'headers', 'workingStatus', 'autoHidden',
  'lastCheckedAt', 'lastSeenAt', 'ladderOrder',
].join(' ');

export async function GET(request) {
  try {
    await requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId') || '';
    const selected = searchParams.get('selected');
    const mapped = searchParams.get('mapped');
    const hidden = searchParams.get('hidden');
    // v13 religious exclusion console: ?religious=1 lists only auto-tagged
    // devotional rows (hidden from /live until an owner maps one manually).
    const religious = searchParams.get('religious') || '';
    const q = normalizeLiveKey(searchParams.get('q') || '');
    const category = searchParams.get('category') || '';
    const requestedCatalog = String(searchParams.get('catalog') || '').toLowerCase();
    const catalogId = isLiveCatalogId(requestedCatalog) ? requestedCatalog : '';
    const profileId = searchParams.get('profile') || 'default';
    const parsedLimit = Number(searchParams.get('limit') || 500);
    const parsedPage = Number(searchParams.get('page') || 1);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(5000, Math.floor(parsedLimit))) : 500;
    const page = Number.isFinite(parsedPage) ? Math.max(1, Math.floor(parsedPage)) : 1;

    const filter = {};
    if (sourceId) filter.sourceId = sourceId;
    if (selected === '1') filter.selected = true;
    if (selected === '0') filter.selected = { $ne: true };
    if (mapped === '1') filter['catalogs.0'] = { $exists: true };
    if (mapped === '0') filter['catalogs.0'] = { $exists: false };
    if (catalogId) filter['catalogs.catalogId'] = catalogId;
    if (hidden === '0') filter.hidden = { $ne: true };
    if (hidden === '1') filter.hidden = true;
    if (category) filter.category = category;
    if (profileId && (selected === '1' || mapped === '1')) filter.profiles = profileId;
    if (q) {
      const safe = escapeRegex(q);
      filter.$or = [
        { normalizedName: { $regex: safe, $options: 'i' } },
        { name: { $regex: safe, $options: 'i' } },
      ];
    }

    const sourceScope = sourceId ? { sourceId } : {};
    const [total, mappedTotal, categories] = await Promise.all([
      LiveChannel.countDocuments(filter),
      LiveChannel.countDocuments({ ...sourceScope, 'catalogs.0': { $exists: true } }),
      LiveChannel.distinct('category', sourceScope),
    ]);
    const sourceTotal = sourceId ? await LiveChannel.countDocuments(sourceScope) : total;

    let docs;
    if (mapped === '1' || catalogId) {
      // The mapped set is intentionally small. Sort after loading so each catalog
      // uses its own embedded position rather than Mongo's minimum array value.
      // The mapped set is sorted by each channel's own embedded catalog position,
      // which MongoDB cannot do in one pass, so it is sorted here and sliced — but
      // it is still capped, and now projected like the other branch.
      docs = await LiveChannel.find(filter).select(LIST_PROJECTION).limit(5000).lean();
      docs = sortChannelsForCatalog(docs.map(toClientChannel), catalogId || 'all')
        .slice((page - 1) * limit, page * limit);
    } else {
      docs = await LiveChannel.find(filter)
        .select(LIST_PROJECTION)
        .sort({ selected: -1, favorite: -1, name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
      docs = docs.map(toClientChannel);
    }

    if (religious === '1' || religious === 'true') docs = docs.filter((doc) => doc.religious);
    if (religious === '0' || religious === 'false') docs = docs.filter((doc) => !doc.religious);

    return json({
      ok: true,
      total,
      sourceTotal,
      mappedTotal,
      unmappedTotal: Math.max(0, sourceTotal - mappedTotal),
      page,
      limit,
      hasMore: page * limit < total,
      categories: categories.filter(Boolean).sort(),
      catalogs: LIVE_CATALOGS,
      channels: docs,
    });
  } catch (error) {
    return json({ ok: false, error: error.name === 'VersionError' ? 'This channel changed concurrently. Refresh and retry.' : error.message }, error.name === 'VersionError' ? 409 : error.status || 500);
  }
}

export async function PATCH(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [body.channelId || body.id].filter(Boolean);
    if (!ids.length) return json({ ok: false, error: 'channel id is required' }, 400);

    await LiveChannel.updateMany({ channelId: { $in: ids }, __v: { $exists: false } }, { $set: { __v: 0 } });
    const docs = await LiveChannel.find({ channelId: { $in: ids } });
    if (!docs.length) return json({ ok: false, error: 'Channel not found' }, 404);

    const action = String(body.action || '').trim();
    // Snapshot before any mutation, so one Undo returns the channel to its previous mapping,
    // EPG override, hidden and favourite state. Bulk actions record one entry per channel so a
    // per-channel undo stays possible instead of an all-or-nothing guess.
    const beforeDocs = docs.map((doc) => channelSnapshot(doc.toObject ? doc.toObject() : doc));
    const requestedCatalog = String(body.catalogId || '').trim().toLowerCase();
    const catalogId = isLiveCatalogId(requestedCatalog) ? requestedCatalog : '';

    if (action === 'swapCatalogPosition') {
      if (docs.length !== 1 || !catalogId || !body.otherChannelId) {
        return json({ ok: false, error: 'channelId, otherChannelId, and valid catalogId are required' }, 400);
      }
      const first = docs[0];
      const second = await LiveChannel.findOne({ channelId: body.otherChannelId });
      if (!second) return json({ ok: false, error: 'Adjacent channel not found' }, 404);
      const firstCatalogs = normalizeCatalogMemberships(first.catalogs || []);
      const secondCatalogs = normalizeCatalogMemberships(second.catalogs || []);
      const firstMembership = firstCatalogs.find((item) => item.catalogId === catalogId);
      const secondMembership = secondCatalogs.find((item) => item.catalogId === catalogId);
      if (!firstMembership || !secondMembership) return json({ ok: false, error: 'Both channels must belong to this catalog' }, 400);
      const firstPosition = firstMembership.position;
      if (firstPosition === secondMembership.position) {
        firstMembership.position = Number(body.direction) < 0
          ? Math.max(0, secondMembership.position - 1)
          : secondMembership.position + 1;
      } else {
        firstMembership.position = secondMembership.position;
        secondMembership.position = firstPosition;
      }
      first.catalogs = firstCatalogs;
      second.catalogs = secondCatalogs;
      await Promise.all([first.save(), second.save()]);
      const swapped = await LiveChannel.find({ channelId: { $in: [first.channelId, second.channelId] } }).lean();
      return json({ ok: true, modified: 2, catalogs: LIVE_CATALOGS, channels: swapped.map(toClientChannel) });
    }

    // Drag-and-drop reorder: rewrite every membership position in one catalog
    // to match the exact order the manager sent. Positions stay on the 100-step
    // grid so single up/down swaps remain meaningful afterwards.
    if (action === 'reorderCatalog') {
      if (!catalogId) return json({ ok: false, error: 'Valid catalogId is required' }, 400);
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.filter(Boolean) : [];
      if (orderedIds.length < 2) return json({ ok: false, error: 'orderedIds must list at least two channels' }, 400);
      const targetDocs = await LiveChannel.find({ channelId: { $in: orderedIds } });
      const byId = new Map(targetDocs.map((doc) => [doc.channelId, doc]));
      let changed = 0;
      for (const [index, id] of orderedIds.entries()) {
        const doc = byId.get(id);
        if (!doc) continue;
        const memberships = normalizeCatalogMemberships(doc.catalogs || []);
        const membership = memberships.find((item) => item.catalogId === catalogId);
        if (!membership) continue;
        membership.position = (index + 1) * 100;
        doc.catalogs = memberships;
        doc.mappingManaged = true;
        await doc.save();
        changed += 1;
      }
      const reordered = await LiveChannel.find({ channelId: { $in: orderedIds } }).lean();
      return json({ ok: true, modified: changed, catalogs: LIVE_CATALOGS, channels: reordered.map(toClientChannel) });
    }

    const nextPositions = new Map();
    let modified = 0;

    async function allocatePosition(id) {
      if (!nextPositions.has(id)) nextPositions.set(id, await nextCatalogPosition(id));
      const value = nextPositions.get(id);
      nextPositions.set(id, value + 100);
      return value;
    }

    for (const doc of docs) {
      let memberships = normalizeCatalogMemberships(doc.catalogs || []);
      let catalogMutation = false;

      if (action === 'setCatalog' || action === 'toggleCatalog') {
        if (!catalogId) return json({ ok: false, error: 'Valid catalogId is required' }, 400);
        const exists = memberships.some((item) => item.catalogId === catalogId);
        const enabled = action === 'setCatalog' ? body.enabled === true : !exists;
        if (!enabled) memberships = memberships.filter((item) => item.catalogId !== catalogId);
        else if (!exists) memberships.push({ catalogId, position: await allocatePosition(catalogId) });
        catalogMutation = true;
      } else if (action === 'setCatalogs' || Array.isArray(body.catalogIds)) {
        const wanted = [...new Set((body.catalogIds || []).map((item) => String(item || '').toLowerCase()).filter(isLiveCatalogId))];
        const existing = new Map(memberships.map((item) => [item.catalogId, item]));
        memberships = [];
        for (const id of wanted) {
          memberships.push(existing.get(id) || { catalogId: id, position: await allocatePosition(id) });
        }
        catalogMutation = true;
      } else if (action === 'catalogPosition') {
        if (!catalogId) return json({ ok: false, error: 'Valid catalogId is required' }, 400);
        const position = Math.max(0, Math.round(Number(body.position)));
        if (!Number.isFinite(position)) return json({ ok: false, error: 'Valid position is required' }, 400);
        const membership = memberships.find((item) => item.catalogId === catalogId);
        if (!membership) return json({ ok: false, error: 'Channel is not mapped to this catalog' }, 400);
        membership.position = position;
        catalogMutation = true;
      } else if (action === 'add') {
        if (!memberships.some((item) => item.catalogId === 'main')) {
          memberships.push({ catalogId: 'main', position: await allocatePosition('main') });
        }
        catalogMutation = true;
      } else if (action === 'remove' || action === 'unmap') {
        memberships = [];
        catalogMutation = true;
      }

      if (catalogMutation) {
        doc.catalogs = normalizeCatalogMemberships(memberships);
        // Mapping is the publish action. Removing the final mapping unpublishes it.
        doc.selected = doc.catalogs.length > 0;
        doc.mappingManaged = true;
        await setSetting('live_catalog_initialized', { initialized: true });
      }

      if (body.selected !== undefined && !catalogMutation) doc.selected = Boolean(body.selected);
      // The guide binding is a user decision, so it must survive whatever the next source sync writes:
      // tvgId is only re-derived when the field is empty (see lib/liveTv). An empty epgId is a real
      // state — "no guide for this channel" — not a missing field, hence the explicit action check.
      if (action === 'setEpg' || body.epgId !== undefined) {
        doc.epgOverride = String(body.epgId || '').trim().slice(0, 120);
        doc.tvgId = doc.epgOverride;
      }
      if (action === 'resetEpg') { doc.epgOverride = null; doc.tvgId = doc.sourceTvgId || ''; }

      if (action === 'hide') doc.hidden = true;
      if (action === 'unhide') doc.hidden = false;
      if (action === 'favorite') doc.favorite = true;
      if (action === 'unfavorite') doc.favorite = false;

      ['customName', 'category', 'profiles', 'workingStatus', 'logicalChannelId'].forEach((key) => {
        if (body[key] !== undefined) doc[key] = body[key];
      });
      // Owner-facing aliases: a name/logo edit must survive the next sync, so
      // it lands in the custom fields the sync's $set deliberately omits.
      if (body.name !== undefined) doc.customName = String(body.name).trim().slice(0, 120);
      if (body.logo !== undefined) doc.customLogo = String(body.logo).trim().slice(0, 1024);
      if (body.customLogo !== undefined) doc.customLogo = String(body.customLogo).trim().slice(0, 1024);
      if (body.url !== undefined) {
        const nextUrl = cleanHttpUrl(body.url);
        if (!nextUrl) return json({ ok: false, error: 'a valid http(s) stream URL is required' }, 400);
        doc.url = nextUrl;
      }
      if (body.tvgId !== undefined) doc.tvgId = String(body.tvgId).trim().slice(0, 120);
      if (body.format !== undefined) {
        const nextFormat = String(body.format).toLowerCase();
        if (['hls', 'dash', 'video', 'unknown'].includes(nextFormat)) doc.format = nextFormat;
      }
      ['keyId', 'key', 'licenseKey', 'licenseType', 'cookie', 'userAgent', 'referer'].forEach((key) => {
        if (body[key] !== undefined) doc[key] = String(body[key] ?? '').trim();
      });
      if (body.headers !== undefined) {
        doc.headers = (body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)) ? body.headers : {};
      }
      if (body.order !== undefined && Number.isFinite(Number(body.order))) doc.order = Math.max(0, Number(body.order));
      // v13 per-channel source ladder: a sanitized sourceId order applied by
      // the public channel route when sorting the group's variants.
      if (body.ladderOrder !== undefined) {
        const ladder = Array.isArray(body.ladderOrder) ? body.ladderOrder : [];
        doc.ladderOrder = [...new Set(ladder.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean))].slice(0, 20);
      }

      await doc.save();
      modified += 1;
    }

    await recalcSourceCounts();
    const updated = await LiveChannel.find({ channelId: { $in: ids } }).lean();
    // One history entry per channel: undoing "hide" on one channel must not also undo the
    // favourite you set on its neighbour in the same bulk request.
    for (const before of beforeDocs) {
      const after = updated.find((doc) => doc.channelId === before.channelId);
      if (!after) continue;
      await recordAction({
        area: 'live', action: `live.channel.${action || 'update'}`, targetModel: 'LiveChannel',
        summary: `${action ? `${action} — ` : ''}“${after.name || before.channelId}”`,
        target: { kind: 'live-channel', key: before.channelId, label: after.name || before.channelId },
        before,
        after: channelSnapshot(after),
      });
    }
    return json({
      ok: true,
      modified,
      catalogs: LIVE_CATALOGS,
      channels: updated.map(toClientChannel),
    });
  } catch (error) {
    return json({ ok: false, error: error.name === 'VersionError' ? 'This channel changed concurrently. Refresh and retry.' : error.message }, error.name === 'VersionError' ? 409 : error.status || 500);
  }
}

export async function DELETE(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('channelId') || searchParams.get('id') || '';
    if (!id) return json({ ok: false, error: 'channelId is required' }, 400);
    const doc = await LiveChannel.findOne({ channelId: id }).lean();
    await LiveChannel.deleteOne({ channelId: id });
    if (doc?.sourceId) await recalcSourceCounts(doc.sourceId);
    await recordAction({
      area: 'live', action: 'live.channel.remove', targetModel: 'LiveChannel',
      summary: `Deleted the live channel “${doc?.name || id}”`,
      target: { kind: 'live-channel', key: id, label: doc?.name || id },
      // The full document, because undo has to put the row back exactly as it was.
      before: doc ? { ...doc, _id: undefined, __v: undefined } : null,
      after: null,
    });
    return json({ ok: true, removed: true });
  } catch (error) {
    return json({ ok: false, error: error.name === 'VersionError' ? 'This channel changed concurrently. Refresh and retry.' : error.message }, error.name === 'VersionError' ? 409 : error.status || 500);
  }
}
