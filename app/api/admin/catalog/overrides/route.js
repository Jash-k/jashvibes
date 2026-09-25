import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import dbConnect from '@/lib/db';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/catalog/overrides — every touched row (the exclusions/overrides browser). */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  await dbConnect();
  const overrides = await CatalogOverride.find({}).sort({ updatedAt: -1 }).limit(1000).lean();
  return NextResponse.json({ ok: true, overrides }, { headers: { 'Cache-Control': 'no-store' } });
}

/** DELETE ?key= — forget an override entirely (row returns to its scraped state). */
export async function DELETE(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key) return NextResponse.json({ ok: false, error: 'Missing key' }, { status: 400 });
  await dbConnect();
  await CatalogOverride.deleteOne({ key });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
