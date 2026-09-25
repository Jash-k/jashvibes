import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { seedStremioAddonsIfEmpty } from '@/lib/stremioSeed';
import StremioAddon from '@/models/StremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/stremio/addons — the registry (seeds from env on first call). */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    await seedStremioAddonsIfEmpty();
    const addons = await StremioAddon.find({}).sort({ sortOrder: 1, label: 1 }).lean();
    return NextResponse.json({ ok: true, addons }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Read failed' }, { status: 500 });
  }
}

/** POST — add {label, manifestUrl, kind}. */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const label = String(body?.label || '').trim();
    const manifestUrl = String(body?.manifestUrl || '').trim();
    const kind = body?.kind === 'watch' ? 'watch' : 'catalog';
    if (!label || !/^https?:\/\//i.test(manifestUrl)) {
      return NextResponse.json({ ok: false, error: 'Label and an http(s) manifest URL are required.' }, { status: 400 });
    }
    const doc = await StremioAddon.create({
      label,
      manifestUrl: manifestUrl.replace(/\/manifest\.json.*$/i, ''),
      kind,
      sortOrder: Number(body?.sortOrder) || 100,
    });
    return NextResponse.json({ ok: true, addon: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error?.code === 11000 ? 'That manifest is already registered for this kind.' : error.message || 'Save failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/** PATCH — {id, label?, manifestUrl?, kind?, enabled?, sortOrder?}. */
export async function PATCH(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
    const patch = {};
    for (const field of ['label', 'manifestUrl']) if (field in body) patch[field] = String(body[field]).trim();
    if ('kind' in body) patch.kind = body.kind === 'watch' ? 'watch' : 'catalog';
    if ('enabled' in body) patch.enabled = Boolean(body.enabled);
    if ('sortOrder' in body) patch.sortOrder = Number(body.sortOrder) || 100;
    const doc = await StremioAddon.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true }).lean();
    if (!doc) return NextResponse.json({ ok: false, error: 'Addon not found' }, { status: 404 });
    return NextResponse.json({ ok: true, addon: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Update failed' }, { status: 400 });
  }
}

/** DELETE ?id= */
export async function DELETE(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  await StremioAddon.findByIdAndDelete(id);
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
