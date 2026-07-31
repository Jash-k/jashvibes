import { NextResponse } from 'next/server';
import { getLiveTVChannels } from '@/lib/liveTv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'all';
    const playableOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('playable') || '').toLowerCase());
    const workingOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('working') || searchParams.get('ok') || '').toLowerCase());
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
