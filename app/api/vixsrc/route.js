import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VIXSRC_BASE_URL = 'https://vixsrc.to';

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

function isSafeEmbedPath(value = '') {
  return typeof value === 'string' && value.startsWith('/embed/') && !value.startsWith('//');
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tmdbId = Number(searchParams.get('tmdbId') || searchParams.get('tmdb'));
    const type = normalizeType(searchParams.get('type'));
    const season = Number(searchParams.get('season') || searchParams.get('s') || 1);
    const episode = Number(searchParams.get('episode') || searchParams.get('e') || 1);

    if (!tmdbId || Number.isNaN(tmdbId)) {
      return NextResponse.json({ error: 'A valid tmdbId is required' }, { status: 400 });
    }

    const apiUrl = type === 'tv'
      ? `${VIXSRC_BASE_URL}/api/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `${VIXSRC_BASE_URL}/api/movie/${tmdbId}`;

    const response = await fetch(apiUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: VIXSRC_BASE_URL,
        Referer: `${VIXSRC_BASE_URL}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `VixSrc API returned HTTP ${response.status}` }, { status: 502 });
    }

    const data = await response.json().catch(() => ({}));
    if (!isSafeEmbedPath(data?.src)) {
      return NextResponse.json({ error: 'VixSrc did not return an embed URL for this title' }, { status: 404 });
    }

    const embedUrl = new URL(data.src, VIXSRC_BASE_URL).toString();
    return NextResponse.redirect(embedUrl, 302);
  } catch (error) {
    console.error('[api/vixsrc] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Unable to resolve VixSrc embed' },
      { status: 500 },
    );
  }
}
