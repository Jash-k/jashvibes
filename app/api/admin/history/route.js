import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { listActions, undoAction } from '@/lib/adminAudit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET  /api/admin/history?area=&key=&limit=   — the panel's change log, newest first.
 * POST /api/admin/history { id }              — undo one action.
 *
 * The snapshots behind each entry stay server-side; this returns the list the UI needs and
 * whether Undo may be offered, so the button can never promise something the server refuses.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const { searchParams } = new URL(request.url);
    const actions = await listActions({
      area: searchParams.get('area') || '',
      targetKey: searchParams.get('key') || '',
      limit: Number(searchParams.get('limit') || 60),
    });
    return json({ ok: true, actions, areas: [...new Set(actions.map((row) => row.area))].sort() });
  } catch (error) {
    return json({ ok: false, error: error.message || 'History read failed' }, 500);
  }
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!id) return json({ ok: false, error: 'Missing action id' }, 400);
    const result = await undoAction(id);
    if (!result.ok) return json(result, result.error?.startsWith('No restore path') ? 501 : 409);
    return json(result);
  } catch (error) {
    return json({ ok: false, error: error.message || 'Undo failed' }, 500);
  }
}
