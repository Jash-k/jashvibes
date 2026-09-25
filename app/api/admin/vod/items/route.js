import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import dbConnect from '@/lib/db';
import VodItem from '@/models/VodItem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** DELETE /api/admin/vod/items?id= — remove one synced ReTro title. */
export async function DELETE(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });
  await dbConnect();
  const result = await VodItem.findByIdAndDelete(id);
  if (!result) return NextResponse.json({ ok: false, error: 'Title not found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
