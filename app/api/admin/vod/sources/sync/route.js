import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { getVodSyncStatus, startVodSyncInBackground } from '@/lib/vodSync';
import { getActiveVodSources } from '@/lib/vodSources';
import VodSource from '@/models/VodSource';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET  /api/admin/vod/sources/sync — live sync status (the panel polls this).
 * POST {id?} — START the sync in the background and answer instantly; a full
 *              classics sync (M3U fetches + TMDB matching) runs minutes, so
 *              awaiting it inside one HTTP request was the timeout the panel
 *              kept hitting.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  return NextResponse.json({ ok: true, status: getVodSyncStatus() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const started = startVodSyncInBackground();

    // Stamp the sources bookkeeping in the background too (best-effort; the
    // engine result lands in the status the panel polls).
    if (started.started) {
      (async () => {
        try {
          const active = await getActiveVodSources();
          await Promise.allSettled(
            active.filter((source) => source.id).map((source) =>
              VodSource.findByIdAndUpdate(source._id || source.id, { $set: { lastSyncAt: new Date() } })),
          );
        } catch { /* status already reports the truth */ }
      })();
    }

    return NextResponse.json(
      {
        ok: true,
        message: started.started
          ? 'Sync started in the background — this tab polls until it finishes.'
          : 'A sync is already running.',
        ...started,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Could not start the sync' }, { status: 500 });
  }
}
