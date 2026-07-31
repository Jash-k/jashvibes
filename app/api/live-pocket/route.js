import { NextResponse } from 'next/server';
import { getPocketLiveTVChannels } from '@/lib/liveTv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const playableOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('playable') || '').toLowerCase());
    const workingOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('working') || searchParams.get('ok') || '').toLowerCase());
    const payload = await getPocketLiveTVChannels({ playableOnly, workingOnly });

    return NextResponse.json(
      { ...payload, source: 'pocket-tamil' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } catch (error) {
    console.error('[api/live-pocket] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unable to load Pocket Live channels', channels: [], count: 0, sources: [] },
      { status: 500 },
    );
  }
}
