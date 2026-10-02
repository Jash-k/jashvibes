import { requireServiceAuth } from '@/lib/serverAuth';
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { searchSongs } from '@/lib/musicApi';
import {
  addImportedPlaylistTrack,
  getImportedPlaylistDetails,
  removeImportedPlaylistTrack,
  replaceImportedPlaylistTrack,
} from '@/lib/musicPlaylistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function pickBestTrack(items = []) {
  const safe = (items || []).filter(Boolean);
  return safe.find((item) => String(item.language || '').toLowerCase() === 'tamil' && item.hasStreams) ||
    safe.find((item) => String(item.language || '').toLowerCase() === 'tamil') ||
    safe.find((item) => item.hasStreams) ||
    safe[0] || null;
}

async function findSaavnTrack(query = '') {
  const clean = String(query || '').trim();
  if (!clean) throw new Error('Search query is required');
  const items = await searchSongs(clean, 10);
  const best = pickBestTrack(items);
  if (!best) throw new Error(`No JioSaavn match found for “${clean}”`);
  return best;
}

export async function PATCH(request) {
  try { await requireServiceAuth(request); } catch (e) { return NextResponse.json({ error: e.message }, { status: e.status || 401 }); }

  try {
    const body = await request.json().catch(() => ({}));
    const playlistId = String(body.playlistId || body.id || '').trim();
    const action = String(body.action || '').trim().toLowerCase();
    const trackKey = String(body.trackKey || body.seokey || '').trim();
    const query = String(body.query || '').trim();
    if (!playlistId) return NextResponse.json({ error: 'playlistId is required' }, { status: 400 });

    let item;
    if (action === 'remove' || action === 'delete') {
      if (!trackKey) return NextResponse.json({ error: 'trackKey is required' }, { status: 400 });
      item = await removeImportedPlaylistTrack(playlistId, trackKey);
    } else if (action === 'replace') {
      if (!trackKey) return NextResponse.json({ error: 'trackKey is required' }, { status: 400 });
      const saavnTrack = await findSaavnTrack(query);
      item = await replaceImportedPlaylistTrack(playlistId, trackKey, saavnTrack, { title: query }, 999);
    } else if (action === 'add' || action === 'create') {
      const saavnTrack = await findSaavnTrack(query);
      item = await addImportedPlaylistTrack(playlistId, saavnTrack, { title: query }, 999);
    } else {
      return NextResponse.json({ error: 'action must be add, replace, or remove' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/playlist/tracks PATCH] Error:', error);
    return NextResponse.json({ error: error.message || 'Playlist track update failed' }, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const playlistId = String(new URL(request.url).searchParams.get('playlistId') || '').trim();
    if (!playlistId) return NextResponse.json({ error: 'playlistId is required' }, { status: 400 });
    const item = await getImportedPlaylistDetails(playlistId);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Playlist not found' }, { status: 500 });
  }
}
