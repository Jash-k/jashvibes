import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import LiveProfile from '@/models/LiveProfile';
import { toClientSource, toClientChannel } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const [sources, channels, profiles] = await Promise.all([
      LiveSource.find({}).sort({ priority: 1 }).lean(),
      LiveChannel.find({ selected: true }).sort({ order: 1, name: 1 }).lean(),
      LiveProfile.find({}).sort({ order: 1 }).lean(),
    ]);
    return NextResponse.json({ ok: true, exportedAt: new Date().toISOString(), sources: sources.map(toClientSource), channels: channels.map(toClientChannel), profiles }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ ok: false, error: error.message }, { status: error.status || 500 }); }
}
