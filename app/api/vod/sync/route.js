import { NextResponse } from 'next/server';
import { getVodSyncStatus, runVodSync } from '@/lib/vodSync';
import { verifyRequestToken } from '@/lib/serverAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request) {
  // A logged-in owner (valid app session) may always sync.
  if (verifyRequestToken(request)) return true;

  const token = new URL(request.url).searchParams.get('token') || request.headers.get('x-sync-token') || '';
  const expected = process.env.SYNC || process.env.VOD_SYNC || process.env.VOD_SYNC_TOKEN || '';

  // Fail CLOSED: previously allowed everyone when no sync token was set.
  if (!expected) return false;
  return Boolean(token) && token === expected;
}

/**
 * The awaited form of the classics sync, for token/cron callers. If a sync is
 * already running, the live status is returned instead of stacking a second.
 */
async function handle(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized VOD sync token' }, { status: 401 });
  }
  try {
    const status = getVodSyncStatus();
    if (status.running) {
      return NextResponse.json(
        { ok: false, alreadyRunning: true, ...status, message: 'A sync is already running.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const result = await runVodSync();
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/vod/sync] Error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'VOD sync failed' }, { status: 500 });
  }
}

export async function GET(request) {
  return handle(request);
}

export const POST = GET;
