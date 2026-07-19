import { NextResponse } from 'next/server';
import { getCharts } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 16);
    const items = await getCharts(limit);
    return NextResponse.json({ items, count: items.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/charts] Error:', error);
    return NextResponse.json({ error: error.message || 'Music charts failed', items: [] }, { status: 500 });
  }
}
