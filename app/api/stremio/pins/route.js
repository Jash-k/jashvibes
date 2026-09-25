import { NextResponse } from 'next/server';
import { verifyRequestToken } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import StremioPin from '@/models/StremioPin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Global Stremio shelf pins. Session-gated (not admin-gated): the /stremio
 * page reads the shelf order for the signed-in owner and writes pin toggles
 * straight through, so every device sees the same shelf. The admin panel can
 * reset it with DELETE.
 *
 * GET            → [{catalogKey, sortOrder}] in shelf order
 * PUT {keys:[]}  → replace the whole shelf order
 * DELETE ?key=   → remove one pin (no key = reset all)
 */
export async function GET(request) {
  if (!verifyRequestToken(request)) {
    return NextResponse.json({ error: 'Unlock JaSH ViBeS first.' }, { status: 401 });
  }
  await dbConnect();
  const pins = await StremioPin.find({}).sort({ sortOrder: 1 }).lean();
  return NextResponse.json({ ok: true, pins: pins.map((pin) => pin.catalogKey) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request) {
  if (!verifyRequestToken(request)) {
    return NextResponse.json({ error: 'Unlock JaSH ViBeS first.' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const keys = (Array.isArray(body?.keys) ? body.keys : []).map((key) => String(key)).filter(Boolean).slice(0, 40);
  await dbConnect();
  await StremioPin.deleteMany({});
  if (keys.length) {
    await StremioPin.insertMany(keys.map((key, index) => ({ catalogKey: key, sortOrder: (index + 1) * 10 }))).catch(() => {});
  }
  return NextResponse.json({ ok: true, pins: keys }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request) {
  if (!verifyRequestToken(request)) {
    return NextResponse.json({ error: 'Unlock JaSH ViBeS first.' }, { status: 401 });
  }
  const key = new URL(request.url).searchParams.get('key') || '';
  await dbConnect();
  if (key) await StremioPin.deleteOne({ catalogKey: key });
  else await StremioPin.deleteMany({});
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
