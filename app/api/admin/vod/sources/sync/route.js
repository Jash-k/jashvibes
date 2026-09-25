import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { selfApi } from '@/lib/selfApi';
import { getActiveVodSources } from '@/lib/vodSources';
import VodSource from '@/models/VodSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/vod/sources/sync — run the full ReTro import through the
 * existing (tested) /api/vod/sync endpoint, then stamp per-source status.
 * {id?} — a single source id is recorded; omit to sync everything.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await selfApi(request, '/api/vod/sync', { method: 'POST' });

    const active = await getActiveVodSources();
    const now = new Date();
    const stamp = {
      lastSyncAt: now,
      lastError: (result?.errors || [])[0] || '',
      itemCount: Number(result?.stored) || 0,
    };
    if (body?.id) {
      await VodSource.findByIdAndUpdate(body.id, { $set: stamp });
    } else {
      await Promise.allSettled(
        active.filter((source) => source.id).map((source) => VodSource.findByIdAndUpdate(source.id, { $set: stamp })),
      );
    }

    return NextResponse.json(
      { ok: true, message: result?.message || 'Classics synced.', ...result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'VOD sync failed' }, { status: 500 });
  }
}
