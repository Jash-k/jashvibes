import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import { recordAction } from '@/lib/adminAudit';
import { rebuildLiveGroupingAndCatalogs } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

/**
 * POST /api/live-service/rebuild
 * Re-runs the background pass: persists logical channel ids and auto-maps
 * eligible unmapped Tamil channels into the fixed catalogs. Manual mappings
 * (mappingManaged) and existing positions are never touched.
 */
export async function POST(request) {
  try {
    await requireServiceAuth(request);
    const stats = await rebuildLiveGroupingAndCatalogs();
    await recordAction({
      area: 'live',
      action: 'live.grouping.rebuild',
      reversible: false,
      summary: `Rebuilt live grouping (${stats.grouped} groups refreshed, ${stats.mapped} channels auto-mapped)`,
      target: { kind: 'live-sources', key: 'grouping', label: 'Live grouping' },
    });
    return json({ ok: true, ...stats });
  } catch (error) {
    return json({ ok: false, error: error.message }, error.status || 500);
  }
}
