import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { liveHeroResponse, LIVE_HERO_NONE } from '@/lib/live/hero';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROJECTION = [
  'channelId', 'name', 'customName', 'logo', 'customLogo', 'hidden',
  'category', 'language', 'format', 'forceProxy',
].join(' ');

function noStore(payload, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * GET /api/live/hero — public (no admin auth) homepage hero takeover state.
 * At most one LiveChannel ever carries heroBanner (the admin PATCH 'hero'
 * action clears the others). Any failure degrades to the normal movie hero
 * rather than breaking the homepage.
 */
export async function GET() {
  try {
    await dbConnect();
    const doc = await LiveChannel.findOne({ heroBanner: true, hidden: { $ne: true } })
      .select(PROJECTION)
      .lean();
    if (!doc) return noStore(LIVE_HERO_NONE);
    return noStore(liveHeroResponse(doc));
  } catch (error) {
    console.error('[live-hero] read failed:', error?.message || error);
    return noStore(LIVE_HERO_NONE);
  }
}
