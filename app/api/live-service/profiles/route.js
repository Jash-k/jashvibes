import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveProfile from '@/models/LiveProfile';
import LiveChannel from '@/models/LiveChannel';
import { ensureLiveServiceSeeded } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const profiles = await LiveProfile.find({}).sort({ order: 1, name: 1 }).lean();
    return json({ ok: true, profiles });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return json({ ok: false, error: 'Profile name required' }, 400);
    const profileId = String(body.profileId || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-+|-+$/g, '') || `profile-${Date.now()}`;
    const doc = await LiveProfile.findOneAndUpdate({ profileId }, { $set: { profileId, name, isDefault: Boolean(body.isDefault), order: Number(body.order || 0) } }, { upsert: true, new: true });
    return json({ ok: true, profile: doc });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function PATCH(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const profileId = body.profileId || body.id;
    if (!profileId) return json({ ok: false, error: 'profileId required' }, 400);
    const doc = await LiveProfile.findOneAndUpdate({ profileId }, { $set: body }, { new: true });
    return json({ ok: true, profile: doc });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function DELETE(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId') || searchParams.get('id') || '';
    if (!profileId || profileId === 'default') return json({ ok: false, error: 'Cannot delete this profile' }, 400);
    await LiveProfile.deleteOne({ profileId });
    await LiveChannel.updateMany({ profiles: profileId }, { $pull: { profiles: profileId } });
    return json({ ok: true, removed: true });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
