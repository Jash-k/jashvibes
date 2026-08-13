import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
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

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId') || '';
    const selected = searchParams.get('selected');
    const mapped = searchParams.get('mapped');
    const hidden = searchParams.get('hidden');
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
      docs = await LiveChannel.find(filter).limit(5000).lean();
      docs = sortChannelsForCatalog(docs.map(toClientChannel), catalogId || 'all')
        .slice((page - 1) * limit, page * limit);
    } else {
      docs = await LiveChannel.find(filter)
        .sort({ selected: -1, favorite: -1, name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();
      docs = docs.map(toClientChannel);
    }

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
    return json({ ok: false, error: error.message }, error.status || 500);
  }
}

export async function PATCH(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [body.channelId || body.id].filter(Boolean);
    if (!ids.length) return json({ ok: false, error: 'channel id is required' }, 400);

    const docs = await LiveChannel.find({ channelId: { $in: ids } });
    if (!docs.length) return json({ ok: false, error: 'Channel not found' }, 404);

    const action = String(body.action || '').trim();
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

      if (action === 'toggleCatalog') {
        if (!catalogId) return json({ ok: false, error: 'Valid catalogId is required' }, 400);
        const exists = memberships.some((item) => item.catalogId === catalogId);
        if (exists) memberships = memberships.filter((item) => item.catalogId !== catalogId);
        else memberships.push({ catalogId, position: await allocatePosition(catalogId) });
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
      }

      if (body.selected !== undefined && !catalogMutation) doc.selected = Boolean(body.selected);
      if (action === 'hide') doc.hidden = true;
      if (action === 'unhide') doc.hidden = false;
      if (action === 'favorite') doc.favorite = true;
      if (action === 'unfavorite') doc.favorite = false;

      ['customName', 'customLogo', 'category', 'profiles', 'workingStatus'].forEach((key) => {
        if (body[key] !== undefined) doc[key] = body[key];
      });
      if (body.order !== undefined && Number.isFinite(Number(body.order))) doc.order = Math.max(0, Number(body.order));

      await doc.save();
      modified += 1;
    }

    await recalcSourceCounts();
    const updated = await LiveChannel.find({ channelId: { $in: ids } }).lean();
    return json({
      ok: true,
      modified,
      catalogs: LIVE_CATALOGS,
      channels: updated.map(toClientChannel),
    });
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 500);
  }
}

export async function DELETE(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('channelId') || searchParams.get('id') || '';
    if (!id) return json({ ok: false, error: 'channelId is required' }, 400);
    const doc = await LiveChannel.findOne({ channelId: id });
    await LiveChannel.deleteOne({ channelId: id });
    if (doc?.sourceId) await recalcSourceCounts(doc.sourceId);
    return json({ ok: true, removed: true });
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 500);
  }
}
