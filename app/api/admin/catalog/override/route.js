import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import dbConnect from '@/lib/db';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUALITY_TIERS = new Set(['', '4k', '1080p', '720p', 'hdrip', 'dvdscr', 'cam', 'tv']);

/**
 * POST /api/admin/catalog/override
 * {key, rawTitle?, type?, hidden?, pinned?, titleOverride?, yearOverride?, qualityOverride?}
 *
 * One upsert powers hide / unhide, pin / unpin, and the manual corrections.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const key = String(body?.key || '').trim();
    if (!key) return NextResponse.json({ ok: false, error: 'Missing row key' }, { status: 400 });

    await dbConnect();
    const patch = {};
    for (const field of ['hidden', 'pinned']) {
      if (field in body) patch[field] = Boolean(body[field]);
    }
    for (const field of ['titleOverride', 'yearOverride', 'rawTitle', 'type', 'note']) {
      if (field in body) patch[field] = String(body[field] || '').trim();
    }
    if ('qualityOverride' in body) {
      const tier = String(body.qualityOverride || '').trim().toLowerCase();
      patch.qualityOverride = QUALITY_TIERS.has(tier) ? tier : '';
    }

    const doc = await CatalogOverride.findOneAndUpdate(
      { key },
      { $set: patch, $setOnInsert: { key } },
      { upsert: true, new: true, runValidators: true },
    ).lean();

    return NextResponse.json({ ok: true, override: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Override failed' }, { status: 500 });
  }
}
