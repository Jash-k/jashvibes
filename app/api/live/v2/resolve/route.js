import { NextResponse } from 'next/server';
import { V2_FEED_URL, normalizeV2Rows, appendHdnea } from '@/lib/live/v2/feed';
import { getV2Token, readHarvest } from '@/lib/live/v2/tokenStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/v2/resolve?id=<feed channel id>
 * One-shot playback contract for the V2 player: manifest URL with the
 * pre-baked token attached when the harvest is fresh, ClearKey pair, and
 * token freshness. Mirrors the v1 resolve response fields the player knows.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 });

    const feedRes = await fetch(V2_FEED_URL, { next: { revalidate: 1800 } });
    if (!feedRes.ok) throw new Error(`upstream feed responded ${feedRes.status}`);
    const records = normalizeV2Rows(await feedRes.json());

    const harvest = await readHarvest().catch(() => null);
    const rotated = harvest?.keyMap?.[id];
    let channel = records.find((r) => r.id === id || r.v2Id === id)
      || (harvest?.extras || []).find((r) => r.id === id)
      || null;
    if (!channel) {
      return NextResponse.json({ ok: false, error: `V2 channel ${id} not found` }, { status: 404 });
    }
    if (rotated) channel = { ...channel, keyId: rotated.keyId, key: rotated.key };

    const { token, expiry, source } = await getV2Token();
    const clearKeys = channel.keyId && channel.key ? { [channel.keyId]: channel.key } : {};

    return NextResponse.json({
      ok: true,
      channel: {
        id: channel.v2Id,
        feedId: channel.id,
        name: channel.name,
        logo: channel.logo,
        category: channel.category,
        source: 'Jio V2',
      },
      originUrl: channel.url,
      playUrl: appendHdnea(channel.url, token),
      cookie: token,
      tokenSource: source,
      format: channel.format,
      drm: Object.keys(clearKeys).length ? { clearKeys } : null,
      clearKeys,
      expiresAt: expiry || null,
      freshness: expiry ? `${Math.max(0, Math.round((expiry - Date.now()) / 60000))}m left` : 'no expiry',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
