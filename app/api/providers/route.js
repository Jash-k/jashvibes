import { NextResponse } from 'next/server';
import { WATCH_PROVIDERS, providerOrder } from '@/lib/watch/policy';
import { isStremioEnabled } from '@/lib/stremioAccess';
export const dynamic = 'force-dynamic';
export async function GET() {
  const enabled = await isStremioEnabled();
  const order = origin => providerOrder(origin).filter(id => id !== 'stremio' || enabled);
  return NextResponse.json({ ok: true, success: true, providers: WATCH_PROVIDERS.map(p => ({ ...p, enabled: p.id !== 'stremio' || enabled, mode: ['vault','mirchi','viduki'].includes(p.id) ? 'embed' : 'direct' })), priority: order('home'), entryPriorities: { retro: order('retro'), stremio: order('stremio') } }, { headers: { 'Cache-Control': 'no-store' } });
}
