import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { recalcSourceCounts } from '@/lib/liveService';
import { normalizeCatalogMemberships } from '@/lib/liveCatalogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    let sources = Array.isArray(body.sources) ? body.sources : [];
    let channels = Array.isArray(body.channels) ? body.channels : [];
    let profiles = Array.isArray(body.profiles) ? body.profiles : [];
    for (const source of sources) {
      const sourceId = source.sourceId || source.id;
      if (!sourceId || !source.url) continue;
      await LiveSource.updateOne({ sourceId }, { $set: { sourceId, label: source.label || source.name || sourceId, type: source.type || 'm3u', url: source.url, enabled: source.enabled !== false, trustTamil: Boolean(source.trustTamil), priority: Number(source.priority ?? 99), autoPurge: Boolean(source.autoPurge) } }, { upsert: true });
    }
    for (const profile of profiles) {
      const profileId = profile.profileId || profile.id;
      if (!profileId) continue;
      await LiveProfile.updateOne({ profileId }, { $set: { profileId, name: profile.name || profileId, isDefault: Boolean(profile.isDefault), order: Number(profile.order || 0) } }, { upsert: true });
    }
    for (const channel of channels) {
      const channelId = channel.channelId || channel.id;
      if (!channelId || !channel.url) continue;
      const normalizedCatalogs = normalizeCatalogMemberships(channel.catalogs || []);
      // Version-1 backups predate canonical catalogs. Preserve their explicit
      // selected list by restoring those channels into MainCH at the old order.
      const catalogs = normalizedCatalogs.length || Number(body.version || 1) >= 2 || !channel.selected
        ? normalizedCatalogs
        : normalizeCatalogMemberships([{ catalogId: 'main', position: channel.order ?? 9999 }]);
      await LiveChannel.updateOne(
        { channelId },
        {
          $set: {
            ...channel,
            channelId,
            catalogs,
            selected: catalogs.length > 0,
            hidden: Boolean(channel.hidden),
            favorite: Boolean(channel.favorite),
            profiles: channel.profiles?.length ? channel.profiles : ['default'],
          },
        },
        { upsert: true },
      );
    }
    await recalcSourceCounts();
    return json({ ok: true, sources: sources.length, channels: channels.length, profiles: profiles.length });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
