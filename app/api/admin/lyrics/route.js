import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { listLyricsOverrides, saveLyricsOverride, deleteLyricsOverride, listLyricsMisses, lyricsSongKey } from '@/lib/lyricsStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * /api/admin/lyrics — the owner's floor under the lyrics provider.
 *
 *   GET  ?view=overrides&q=&page=   saved lyrics
 *   GET  ?view=missing              songs LRCLIB had nothing for (from the cache)
 *   POST { action:'save',   title, artist, album, plainLyrics, syncedLyrics, note }
 *   POST { action:'delete', key }
 *
 * Saving here is what makes the lyrics section able to "never fail": a song
 * LRCLIB does not carry is filled in once and is served from the database
 * before any provider is asked. Admin-gated like every other owner endpoint.
 */
async function handle(request) {
  try {
    const deny = await adminDeny(request); if (deny) return deny;
    const url = new URL(request.url);

    if (request.method === 'GET') {
      const view = url.searchParams.get('view') || 'overrides';
      if (view === 'missing') return json({ ok: true, items: await listLyricsMisses({ limit: 100 }) });
      const { items, total, page, pages } = await listLyricsOverrides({
        q: String(url.searchParams.get('q') || '').slice(0, 200),
        page: Number.parseInt(url.searchParams.get('page') || '1', 10) || 1,
      });
      return json({ ok: true, items, total, page, pages });
    }

    if (Number(request.headers.get('content-length')) > 600_000) return json({ error: 'Lyrics are too large to save.' }, 413);
    const raw = await request.text();
    if (raw.length > 600_000) return json({ error: 'Lyrics are too large to save.' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request.' }, 400);

    if (body.action === 'delete') {
      const removed = await deleteLyricsOverride(String(body.key || '').slice(0, 400));
      return json({ ok: true, removed });
    }
    if (body.action !== 'save') return json({ error: 'Unknown lyrics action.' }, 400);
    for (const field of ['plainLyrics', 'syncedLyrics']) {
      if (body[field] != null && typeof body[field] !== 'string') return json({ error: 'Lyrics must be plain text.' }, 400);
    }
    if (!String(body.plainLyrics || '').trim() && !String(body.syncedLyrics || '').trim()) {
      return json({ error: 'Paste the lyrics text before saving.' }, 400);
    }
    const key = await saveLyricsOverride(
      { title: String(body.title || ''), artist: String(body.artist || ''), album: String(body.album || ''), duration: Number(body.duration) || 0, id: String(body.id || '') },
      { plainLyrics: body.plainLyrics, syncedLyrics: body.syncedLyrics, note: body.note, origin: 'admin' },
    );
    return json({ ok: true, key });
  } catch (error) {
    const status = [400, 404, 409].includes(error?.status) ? error.status : 503;
    return json({ ok: false, error: status === 503 ? 'Lyrics storage is unavailable. Check the database connection.' : error.message }, status);
  }
}

export const GET = handle;
export const POST = handle;
