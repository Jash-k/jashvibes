import { NextResponse } from 'next/server';
import { V2_FEED_URL, normalizeV2Rows, groupV2Channels } from '@/lib/live/v2/feed';
import { readHarvest } from '@/lib/live/v2/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/v2/channels
 * The V2 catalogue: the upstream Jio JSON feed normalized server-side and
 * grouped by its own categories, enriched with harvested key rotations and
 * any reference-only channels. Auth is the standard jash_access cookie via
 * proxy.js — the V2 routes sit under /api/live like every other live route.
 */
export async function GET() {
  try {
    const feedRes = await fetch(V2_FEED_URL, { next: { revalidate: 1800 } });
    if (!feedRes.ok) throw new Error(`upstream feed responded ${feedRes.status}`);
    const rows = await feedRes.json();
    let records = normalizeV2Rows(rows);

    let harvest = null;
    try { harvest = await readHarvest(); } catch { /* optional enrichment */ }

    if (harvest?.keyMap) {
      records = records.map((record) => {
        const rotated = harvest.keyMap[record.id];
        return rotated ? { ...record, keyId: rotated.keyId, key: rotated.key } : record;
      });
    }
    if (Array.isArray(harvest?.extras) && harvest.extras.length) {
      const known = new Set(records.map((r) => r.id));
      records = [...records, ...harvest.extras.filter((extra) => !known.has(extra.id))];
    }

    const groups = groupV2Channels(records);
    return NextResponse.json({
      ok: true,
      source: 'jio-v2',
      total: records.length,
      groups,
      flat: records,
      tokenState: {
        hasToken: Boolean(harvest?.token),
        tokenExpiry: harvest?.tokenExpiry || 0,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `V2 catalogue unavailable: ${e.message}` },
      { status: 502 },
    );
  }
}
