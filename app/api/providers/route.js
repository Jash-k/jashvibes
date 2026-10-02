import { NextResponse } from 'next/server';
import { WATCH_PROVIDERS, providerOrder } from '@/lib/watch/policy';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ ok: true, success: true, providers: WATCH_PROVIDERS.map((p) => ({ ...p, enabled: true, mode: ['vault', 'mirchi'].includes(p.id) ? 'embed' : 'direct' })), priority: providerOrder('home'), entryPriorities: { retro: providerOrder('retro'), stremio: providerOrder('stremio') } }); }
