import { NextResponse } from 'next/server';
import { loadTitle } from '@/lib/animeTamilFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/anime/tamil/title?u=/series/<slug>` — a title's seasons and every episode.
 *
 * `u` is a path on the catalogue's own origin and nothing else: `openPath` refuses an absolute URL on
 * another host, so this route cannot be pointed at an internal address. That is also why the client sends
 * back the path it was given instead of a URL it assembled itself.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = String(searchParams.get('u') || '').slice(0, 300);
  if (!path) return NextResponse.json({ ok: false, error: 'u required' }, { status: 400 });
  try {
    const feed = await loadTitle({ path, force: searchParams.get('force') === '1' });
    if (!feed?.ok) {
      return NextResponse.json(
        { ok: false, error: feed?.error || 'this title has no episode list on the source', url: feed?.url || '' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json({
      ok: true,
      title: feed.title,
      source: feed.source,
      cached: Boolean(feed.cached),
      generatedAt: feed.generatedAt || 0,
    }, { headers: { 'Cache-Control': 'public, max-age=1800' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || 'the title could not be read' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
