import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MOVIES1_BACKEND = (process.env.MOVIES1_BACKEND || process.env.SPORTS_BACKEND || 'https://movies1-backend.onrender.com').replace(/\/+$/, '');

const BCCI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,*/*',
  Referer: 'https://www.bcci.tv/',
};

function isAllowedSportsUrl(value = '') {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (host === 'www.bcci.tv' || host.endsWith('.bcci.tv'));
  } catch {
    return false;
  }
}

async function resolveWithMovies1(pageUrl) {
  const url = new URL('/api/get-stream', MOVIES1_BACKEND);
  url.searchParams.set('url', pageUrl);
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success || !data?.url) throw new Error(data?.error || `movies1 dynamic returned HTTP ${response.status}`);
  return data.url;
}

async function extractBcciDirectMp4(pageUrl) {
  const response = await fetch(pageUrl, { headers: BCCI_HEADERS, redirect: 'follow', cache: 'no-store' });
  if (!response.ok) throw new Error(`BCCI page returned HTTP ${response.status}`);
  const html = await response.text();

  const playerIndex = html.indexOf('id="mypagePlayers"');
  if (playerIndex !== -1) {
    const match = html.slice(playerIndex).match(/<source\s+src="([^"]+\.mp4[^"]*)"/i);
    if (match?.[1]) return match[1].replace(/&amp;/g, '&');
  }

  const anyMp4 = html.match(/https:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/i)?.[0];
  if (anyMp4) return anyMp4.replace(/&amp;/g, '&');

  const poster = html.match(/poster="[^"]*\/(\d{10,})-\d+\.jpg"/i);
  if (poster?.[1]) return `https://brightcove-videos-bcci-ipl.s3.ap-south-1.amazonaws.com/videos-BCCI/${poster[1]}.mp4`;

  return '';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url') || '';
    if (!url) return NextResponse.json({ ok: false, error: 'url is required' }, { status: 400 });
    if (!isAllowedSportsUrl(url)) return NextResponse.json({ ok: false, error: 'Dynamic sports resolver only allows public BCCI video pages' }, { status: 400 });

    let streamUrl = '';
    let source = 'dynamic-bcci-local';
    try {
      streamUrl = await resolveWithMovies1(url);
      source = 'movies1-backend-dynamic';
    } catch {
      streamUrl = await extractBcciDirectMp4(url);
    }
    if (!streamUrl) return NextResponse.json({ ok: false, error: 'No direct public video found on BCCI page' }, { status: 404 });

    return NextResponse.json({ ok: true, url: streamUrl, source }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Dynamic sports resolver failed' }, { status: 502 });
  }
}
