import { NextResponse } from 'next/server';
import { getLiveTVChannels } from '@/lib/liveTv';
import { getSelectedLiveChannels } from '@/lib/liveService';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const playableOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('playable') || '').toLowerCase());
    const workingOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('working') || searchParams.get('ok') || '').toLowerCase());
    const profileId = searchParams.get('profile') || 'default';
    if (source === 'all' && !workingOnly) {
      try {
        const selectedChannels = await getSelectedLiveChannels({ profileId });
        const sources = await LiveSource.find({}).sort({ priority: 1 }).lean().catch(() => []);
        if (selectedChannels.length) {
          return NextResponse.json({
            updatedAt: new Date().toISOString(),
            source: 'db-selected',
            profile: profileId,
            count: selectedChannels.length,
            channels: playableOnly ? selectedChannels.filter((channel) => channel.playable) : selectedChannels,
            sources: sources.map((item) => ({ id: item.sourceId, label: item.label, url: item.url, type: item.type })),
            fromDb: true,
          }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
        }
        const dbChannelCount = await LiveChannel.countDocuments({ hidden: { $ne: true } }).catch(() => 0);
        if (dbChannelCount > 0) {
          return NextResponse.json({
            updatedAt: new Date().toISOString(),
            source: 'db-selected-empty',
            profile: profileId,
            count: 0,
            channels: [],
            sources: sources.map((item) => ({ id: item.sourceId, label: item.label, url: item.url, type: item.type })),
            fromDb: true,
          }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
        }
      } catch (dbError) {
        console.warn('[api/live-tv] DB selected fallback:', dbError.message);
      }
    }

    const payload = await getLiveTVChannels({ source, playableOnly, workingOnly });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/live-tv] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unable to load Live TV channels', channels: [], count: 0 },
      { status: 500 },
    );
  }
}
