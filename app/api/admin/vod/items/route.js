import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import dbConnect from '@/lib/db';
import VodItem from '@/models/VodItem';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/vod/items?q=&page= — the ReTro titles manager listing.
 * PATCH {id, title?, year?} — manual metadata correction (survives syncs for
 *                             as long as the item is not overwritten by a new
 *                             sync batch — the raw source stays the truth).
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const q = String(searchParams.get('q') || '').trim();
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const pageSize = Math.min(Number(searchParams.get('pageSize') || 25), 100);

    const filter = q
      ? { $or: [{ title: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { originalTitle: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
      : {};

    const total = await VodItem.countDocuments(filter);
    const docs = await VodItem.find(filter)
      .sort({ title: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('title year posterUrl tmdbId tmdbMatched sources rating updatedAt')
      .lean();

    return NextResponse.json(
      {
        ok: true,
        items: docs.map((doc) => ({
          _id: String(doc._id),
          title: doc.title,
          year: doc.year || null,
          posterUrl: doc.posterUrl || '',
          tmdbId: doc.tmdbId || null,
          tmdbMatched: Boolean(doc.tmdbMatched),
          sources: doc.sources || [],
          rating: doc.rating || 0,
          updatedAt: doc.updatedAt,
        })),
        total,
        page,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Read failed' }, { status: 500 });
  }
}

export async function PATCH(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    const patch = {};
    if ('title' in body) {
      const title = String(body.title || '').trim();
      if (!title) return NextResponse.json({ ok: false, error: 'Title cannot be empty' }, { status: 400 });
      patch.title = title;
      patch.normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    }
    if ('year' in body) {
      const year = Number(body.year);
      patch.year = Number.isFinite(year) && year > 1900 && year < 2100 ? year : undefined;
    }

    const doc = await VodItem.findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .select('title year tmdbMatched sources posterUrl')
      .lean();
    if (!doc) return NextResponse.json({ ok: false, error: 'Title not found' }, { status: 404 });
    return NextResponse.json({ ok: true, item: { ...doc, _id: String(doc._id) } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Update failed' }, { status: 400 });
  }
}

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
