import { NextResponse } from 'next/server';
import { getSongInfo } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const seokey = String(searchParams.get('seokey') || '').trim();
    if (!seokey) return NextResponse.json({ error: 'seokey is required' }, { status: 400 });
    const item = await getSongInfo(seokey);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/song] Error:', error);
    return NextResponse.json({ error: error.message || 'Music song info failed' }, { status: 500 });
  }
}
