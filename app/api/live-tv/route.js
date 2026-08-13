import { NextResponse } from 'next/server';
import { getLiveTVChannels } from '@/lib/liveTv';
import { getSelectedLiveChannels } from '@/lib/liveService';
import LiveSource from '@/models/LiveSource';

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
        if (selectedChannels.length) {
          const sources = await LiveSource.find({}).sort({ priority: 1 }).lean().catch(() => []);
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
