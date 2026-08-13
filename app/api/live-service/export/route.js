import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { toClientSource, toClientChannel } from '@/lib/liveService';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const [sources, channels, profiles] = await Promise.all([
      LiveSource.find({}).sort({ priority: 1 }).lean(),
      LiveChannel.find({ 'catalogs.0': { $exists: true } }).sort({ name: 1 }).lean(),
      LiveProfile.find({}).sort({ order: 1 }).lean(),
    ]);
    return NextResponse.json({ ok: true, version: 2, exportedAt: new Date().toISOString(), catalogs: LIVE_CATALOGS, sources: sources.map(toClientSource), channels: channels.map(toClientChannel), profiles }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ ok: false, error: error.message }, { status: error.status || 500 }); }
}
