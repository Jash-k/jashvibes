import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { deleteImportedPlaylist, listImportedPlaylists, updateImportedPlaylist } from '@/lib/musicPlaylistStore';
import { searchPlaylists } from '@/lib/musicApi';
import { importSpotifyPlaylist } from '@/lib/spotifyPlaylistImport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function accessToken(password = '') {
  return crypto.createHash('sha256').update(`jash-theatre:${password}`).digest('hex');
}

function isAuthorized(request) {
  const configuredPassword = process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
  const adminToken = process.env.MUSIC_ADMIN_TOKEN || process.env.SYNC || '';
  if (!configuredPassword && !adminToken) return true;
  const token = request.headers.get('x-jash-token') || request.headers.get('x-music-admin-token') || new URL(request.url).searchParams.get('token') || '';
  if (adminToken && token === adminToken) return true;
  if (configuredPassword && token === accessToken(configuredPassword)) return true;
  return false;
}

function splitUrls(value = '') {
  return String(value || '')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || searchParams.get('query') || '').trim();
    const limit = Math.min(Number(searchParams.get('limit') || 20), 50);

    if (query) {
      const items = await searchPlaylists(query, limit);
      return NextResponse.json({ items, count: items.length, source: 'saavn' }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const items = await listImportedPlaylists({ includeHidden: searchParams.get('all') === '1' });
    return NextResponse.json({ items, count: items.length, source: 'imported' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/playlists] Error:', error);
    return NextResponse.json({ error: error.message || 'Playlist search failed', items: [] }, { status: 500 });
  }
}

export async function POST(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized playlist import' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const urls = Array.isArray(body.urls) ? body.urls : splitUrls(body.url || body.urlsText || body.playlists || '');
    if (!urls.length) return NextResponse.json({ error: 'Paste at least one public Spotify playlist URL.' }, { status: 400 });

    const max = Math.min(urls.length, Number(process.env.SPOTIFY_IMPORT_MAX_PLAYLISTS || 25));
    const results = [];
    for (let index = 0; index < max; index += 1) {
      const url = urls[index];
      try {
        results.push(await importSpotifyPlaylist(url, { sortOrder: index + 1 }));
      } catch (error) {
        results.push({ ok: false, url, error: error.message || 'Import failed' });
      }
    }

    const imported = results.filter((item) => item.ok).map((item) => item.playlist);
    return NextResponse.json({
      ok: imported.length > 0,
      imported,
      results,
      count: imported.length,
      failed: results.filter((item) => !item.ok).length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/playlists POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Spotify playlist import failed' }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized playlist update' }, { status: 401 });

  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body.id || new URL(request.url).searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'Playlist id is required' }, { status: 400 });
    const item = await updateImportedPlaylist(id, body);
    return NextResponse.json({ ok: true, item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Playlist update failed' }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized playlist delete' }, { status: 401 });

  try {
    const id = String(new URL(request.url).searchParams.get('id') || '').trim();
    if (!id) return NextResponse.json({ error: 'Playlist id is required' }, { status: 400 });
    const result = await deleteImportedPlaylist(id);
    return NextResponse.json({ ok: result.deleted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Playlist delete failed' }, { status: 500 });
  }
}
