import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { selfApi } from '@/lib/selfApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/tv/sweep — health-check a batch of channels through the
 * existing /api/live-service/check endpoint (same probe, same writes to
 * workingStatus). Returns the dead ones for the admin's "Dead only" view.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const result = await selfApi(request, '/api/live-service/check', {
      method: 'POST',
      body: { sourceId: body?.sourceId || '', limit: Math.min(Number(body?.limit) || 120, 400) },
    });
    const results = Array.isArray(result?.results) ? result.results : [];
    const dead = results.filter((row) => row?.ok === false || String(row?.workingStatus || '').toLowerCase() === 'dead');
    return NextResponse.json(
      {
        ok: true,
        checked: result?.checked || results.length,
        deadCount: dead.length,
        dead: dead.slice(0, 80).map((row) => ({ id: row.channelId || row.id, name: row.name || '', error: row.error || '' })),
        message: `Checked ${result?.checked || results.length} channel(s) — ${dead.length} not answering.`,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Sweep failed' }, { status: 500 });
  }
}
