import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { seedVodSourcesIfEmpty } from '@/lib/vodSources';
import VodSource from '@/models/VodSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/vod/sources — ReTro source list (seeds on first call). */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    await seedVodSourcesIfEmpty();
    const sources = await VodSource.find({}).sort({ sortOrder: 1, name: 1 }).lean();
    return NextResponse.json({ ok: true, sources }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Read failed' }, { status: 500 });
  }
}

/** POST — add a source {name, url, sortOrder?}. */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || '').trim();
    const url = String(body?.url || '').trim();
    if (!name || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'Name and an http(s) M3U URL are required.' }, { status: 400 });
    }
    const doc = await VodSource.create({
      name,
      url,
      sortOrder: Number(body?.sortOrder) || 100,
      enabled: body?.enabled !== false,
    });
    return NextResponse.json({ ok: true, source: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error?.code === 11000 ? 'That URL is already a source.' : error.message || 'Save failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/** PATCH — edit {id, name?, url?, enabled?, sortOrder?}. */
export async function PATCH(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
    const patch = {};
    for (const field of ['name', 'url']) if (field in body) patch[field] = String(body[field]).trim();
    if ('enabled' in body) patch.enabled = Boolean(body.enabled);
    if ('sortOrder' in body) patch.sortOrder = Number(body.sortOrder) || 100;
    const doc = await VodSource.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    if (!doc) return NextResponse.json({ ok: false, error: 'Source not found' }, { status: 404 });
    return NextResponse.json({ ok: true, source: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Update failed' }, { status: 400 });
  }
}

/** DELETE ?id= — remove a source (its already-synced items stay until the next sync). */
export async function DELETE(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  await VodSource.findByIdAndDelete(id);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
