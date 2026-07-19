import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getSaavnApiBase() {
  return (process.env.SAAVN || process.env.SAAVN_API || 'https://saavnapi.onrender.com').replace(/\/+$/, '');
}

async function tryFetch(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; JaSH-ViBeS-Music/1.0)' },
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function extractLyrics(payload) {
  const data = payload?.data || payload;
  return data?.lyrics || data?.text || data?.snippet || data?.copyright_text || '';
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = String(searchParams.get('id') || '').trim();
  if (!id) return NextResponse.json({ lyrics: '', message: 'No song id supplied' });

  const base = getSaavnApiBase();
  const candidates = [
    `${base}/api/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/songs/${encodeURIComponent(id)}/lyrics`,
    `${base}/api/lyrics?id=${encodeURIComponent(id)}`,
  ];

  for (const url of candidates) {
    const payload = await tryFetch(url);
    const lyrics = extractLyrics(payload);
    if (lyrics) return NextResponse.json({ lyrics, source: url }, { headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json({ lyrics: 'Lyrics are not available from the current JioSaavn API for this song.' }, { headers: { 'Cache-Control': 'no-store' } });
}
