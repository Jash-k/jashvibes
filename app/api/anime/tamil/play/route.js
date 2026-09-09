import { NextResponse } from 'next/server';
import { loadEpisode } from '@/lib/animeTamilFeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `GET /api/anime/tamil/play?u=/episode/<slug>` — the servers on that episode, and for each one either a
 * fetchable `.m3u8` or the reason there is none.
 *
 * The bounded host list is the whole surface: this route reads the episode page and at most
 * `MAX_SOURCE_LOOKUPS` host pages, a few kilobytes of HTML each, never video. Playable manifests answer
 * with `access-control-allow-origin: *`, so the browser fetches the stream itself and this server carries
 * no media bytes — the reason a 512 MB free instance can offer an anime page at all.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const path = String(searchParams.get('u') || '').slice(0, 300);
  if (!path) return NextResponse.json({ ok: false, error: 'u required' }, { status: 400 });
  try {
    const feed = await loadEpisode({ path, force: searchParams.get('force') === '1' });
    if (!feed?.ok) {
      return NextResponse.json(
        { ok: false, error: feed?.error || 'this episode page could not be read', open: feed?.url || path },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const seconds = feed.episode?.playable?.length ? 1800 : 120;
    return NextResponse.json({
      ok: true,
      episode: feed.episode,
      source: feed.source,
      cached: Boolean(feed.cached),
      generatedAt: feed.generatedAt || 0,
    }, { headers: { 'Cache-Control': `public, max-age=${seconds}` } });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'the servers on this episode could not be read', open: path },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
