import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import {
  getLiveAutoSyncConfig,
  getLiveAutoSyncStatus,
  setLiveAutoSyncEnabled,
  startLiveAutoSync,
} from '@/lib/liveAutoSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/tv/auto-sync — scheduler config + last/next run status.
 * POST /api/admin/tv/auto-sync — { enabled: bool } pauses/resumes,
 *                               { runNow: true } kicks a background pass.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const config = await getLiveAutoSyncConfig();
    return NextResponse.json(
      { ok: true, config, status: getLiveAutoSyncStatus() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'status failed' }, { status: 500 });
  }
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.runNow) {
      const outcome = startLiveAutoSync({ trigger: 'manual' });
      return NextResponse.json(
        { ok: true, ...outcome, status: getLiveAutoSyncStatus() },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (body.enabled !== undefined) await setLiveAutoSyncEnabled(Boolean(body.enabled));
    const config = await getLiveAutoSyncConfig();
    return NextResponse.json(
      { ok: true, config, status: getLiveAutoSyncStatus() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'update failed' }, { status: 500 });
  }
}
