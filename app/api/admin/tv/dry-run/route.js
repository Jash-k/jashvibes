import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import LiveSource from '@/models/LiveSource';
import { parseLiveSourceChannels } from '@/lib/liveTv';
import { normalizeLiveKey, toClientSource } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/admin/tv/dry-run — { sourceId? }
 *
 * Fetches each enabled source's playlist the way a real sync would, and compares the parsed
 * channels with what is stored — **without writing anything**. Answers the two questions a sync
 * raises: how many channels would arrive or vanish, and how many of the owner's own mappings
 * (catalog membership, EPG override, favourites) sit on channels that are about to disappear.
 *
 * A real 200-channel sync is not something you want to discover the shape of afterwards.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const wanted = String(body?.sourceId || '').trim();

    const sources = await LiveSource.find({ deleted: { $ne: true }, ...(wanted ? { sourceId: wanted } : {}) }).lean();
    const enabled = sources.filter((doc) => doc.enabled !== false);
    if (!enabled.length) return json({ ok: false, error: 'No enabled live sources to check.' }, 400);

    const results = [];
    let added = 0;
    let removed = 0;
    const wouldLoseMappings = [];

    for (const doc of enabled) {
      const source = toClientSource(doc);
      let parsed = [];
      let error = '';
      try {
        parsed = await parseLiveSourceChannels(source, { includeAll: true });
      } catch (err) {
        error = err.message || 'fetch failed';
      }
      const existing = await LiveChannel.find({ sourceId: source.sourceId })
        .select('channelId name tvgId sourceTvgId normalizedName catalogs epgOverride favorite hidden')
        .lean();

      const incomingIds = new Set(parsed.map((channel) => channel.channelId));
      const existingIds = new Set(existing.map((channel) => channel.channelId));
      const byName = new Map(existing.map((channel) => [normalise(channel.normalizedName || channel.name), channel]));

      const sourceAdded = parsed.filter((channel) => !existingIds.has(channel.channelId));
      // A channel counted as "gone" by id may simply be the same channel under a new id: the sync
      // re-links those by name or tvg-id, so they must not be reported as losses.
      const sourceRemoved = existing.filter((channel) => {
        if (incomingIds.has(channel.channelId)) return false;
        const key = normalise(channel.normalizedName || channel.name);
        const tvg = normalizeLiveKey(channel.sourceTvgId || channel.tvgId);
        const present = (tvg && parsed.some((item) => normalizeLiveKey(item.sourceTvgId || item.tvgId) === tvg)) || (key && byName.get(key) && parsed.some((item) => normalise(item.normalizedName || item.name) === key));
        return !present;
      });

      const atRisk = sourceRemoved.filter((channel) => (channel.catalogs || []).length || channel.epgOverride || channel.favorite);
      for (const channel of atRisk) {
        wouldLoseMappings.push({
          sourceId: source.sourceId,
          name: channel.name || channel.channelId,
          catalogs: (channel.catalogs || []).map((item) => item.catalogId),
          epg: Boolean(channel.epgOverride),
          favorite: Boolean(channel.favorite),
        });
      }
      added += sourceAdded.length;
      removed += sourceRemoved.length;
      results.push({
        sourceId: source.sourceId,
        label: source.label,
        error,
        parsed: parsed.length,
        stored: existing.length,
        added: sourceAdded.length,
        removed: sourceRemoved.length,
        atRisk: atRisk.length,
        samples: { added: sourceAdded.slice(0, 8).map((channel) => channel.name), removed: sourceRemoved.slice(0, 8).map((channel) => channel.name) },
      });
    }

    await recordAction({
      area: 'live', action: 'live.dryrun', reversible: false,
      summary: `Live dry run — ${results.length} source(s) checked, ${added} channel(s) would arrive, ${removed} would go, ${wouldLoseMappings.length} mapping(s) at risk`,
      target: { kind: 'live-sources', key: wanted || 'all', label: 'Live sources' },
    });

    return json({
      ok: true,
      dryRun: true,
      sources: results,
      totals: { added, removed, atRisk: wouldLoseMappings.length },
      wouldLoseMappings: wouldLoseMappings.slice(0, 40),
      message: `Nothing written. ${added} channel(s) would be added, ${removed} removed${wouldLoseMappings.length ? `, and ${wouldLoseMappings.length} channel with your own mapping, EPG or favourite would disappear` : ''}.`,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Dry run failed' }, error.status || 500);
  }
}

function normalise(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
