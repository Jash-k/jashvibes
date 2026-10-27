import { NextResponse } from 'next/server';
import { verifyRequestToken } from '@/lib/serverAuth';
import { harvestFromPlugx, readHarvest } from '@/lib/live/v2/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/v2/harvest            — session owner, force refresh
 * GET /api/live/v2/harvest?token=CRON — external scheduler (CRON/CRON_SECRET)
 *
 * Fails closed exactly like /api/cron/tamilmv: the middleware skips this
 * path (SELF_TOKENIZED_PREFIXES), so its own authorization must never allow
 * an unauthenticated refresh when no secret is configured.
 */
function isAuthorized(request) {
  if (verifyRequestToken(request)) return true;
  const token = new URL(request.url).searchParams.get('token')
    || request.headers.get('x-cron-token') || '';
  const expected = process.env.CRON || process.env.CRON_SECRET
    || process.env.SCRAPE || process.env.SCRAPE_TOKEN || '';
  if (!expected) return false;
  return Boolean(token) && token === expected;
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized cron token' }, { status: 401 });
  }
  const force = new URL(request.url).searchParams.get('force') !== '0';
  try {
    const before = await readHarvest().catch(() => null);
    const harvest = force
      ? await harvestFromPlugx({ force: true })
      : (await readHarvest().catch(() => null)) || await harvestFromPlugx({ force: true });
    return NextResponse.json({
      ok: true,
      forced: force,
      tokenSource: 'plugx-harvest',
      tokenExpiry: harvest?.tokenExpiry || 0,
      minutesLeft: harvest?.tokenExpiry ? Math.round((harvest.tokenExpiry - Date.now()) / 60000) : 0,
      keyCount: Object.keys(harvest?.keyMap || {}).length,
      extraCount: (harvest?.extras || []).length,
      changed: before?.token !== harvest?.token,
    });
  } catch (e) {
    // Keep the previous harvest usable; report the failure for the scheduler log.
    const existing = await readHarvest().catch(() => null);
    return NextResponse.json({
      ok: false,
      error: e.message,
      retainedToken: Boolean(existing?.token),
      retainedExpiry: existing?.tokenExpiry || 0,
    }, { status: 502 });
  }
}
