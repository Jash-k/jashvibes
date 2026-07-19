import { NextResponse } from 'next/server';
import { getLiveTVChannels } from '@/lib/liveTv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const playableOnly = searchParams.get('playable') === '1';
    const payload = await getLiveTVChannels({ source, playableOnly });

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
