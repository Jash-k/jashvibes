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
    const message = error.message || 'Music song info failed';
    const isClientInputError = /Only JioSaavn|Song id is required|Song not found/i.test(message);
    if (isClientInputError) console.warn('[api/music/song] Skipped:', message);
    else console.error('[api/music/song] Error:', error);
    return NextResponse.json({ error: message }, { status: isClientInputError ? 400 : 500 });
  }
}
