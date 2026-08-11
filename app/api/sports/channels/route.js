import { NextResponse } from 'next/server';
import { getLiveTVChannels } from '@/lib/liveTv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function detectFormat(url = '') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (/\.(mp4|webm|mkv)(\?|#|$)/i.test(lower)) return 'video';
  return 'unknown';
}

function envChannel(prefix, fallbackName) {
  const url = String(process.env[`${prefix}_URL`] || process.env[`${prefix}_STREAM`] || '').trim();
  if (!url) return null;
  return {
    id: `${prefix.toLowerCase()}-env`,
    tvgId: prefix.toLowerCase(),
    name: process.env[`${prefix}_NAME`] || fallbackName,
    url,
    logo: process.env[`${prefix}_LOGO`] || '',
    category: 'Sports',
    language: 'Tamil',
    region: '',
    sourceId: 'sports-env',
    source: prefix === 'SPORTS_FANCODE' ? 'FanCode' : 'Willow',
    format: detectFormat(url),
    keyId: process.env[`${prefix}_KEY_ID`] || process.env[`${prefix}_KID`] || '',
    key: process.env[`${prefix}_KEY`] || '',
    licenseKey: process.env[`${prefix}_LICENSE_KEY`] || '',
    cookie: process.env[`${prefix}_COOKIE`] || '',
    userAgent: process.env[`${prefix}_UA`] || process.env[`${prefix}_USER_AGENT`] || '',
    referer: process.env[`${prefix}_REFERER`] || '',
    playable: true,
    priority: prefix === 'SPORTS_FANCODE' ? -20 : -10,
  };
}

function isSportsChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.category || ''} ${channel.source || ''}`.toLowerCase();
  return /sports|cricket|fancode|willow|ten 4|star sports|sony sports/.test(text);
}

export async function GET() {
  try {
    const payload = await getLiveTVChannels({ playableOnly: true });
    const extra = [
      envChannel('SPORTS_FANCODE', 'FanCode'),
      envChannel('SPORTS_WILLOW', 'Willow by Cricbuzz'),
    ].filter(Boolean);

    const seen = new Set();
    const channels = [...extra, ...(payload.channels || []).filter(isSportsChannel)]
      .filter((channel) => {
        const key = `${channel.name}|${channel.url}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));

    return NextResponse.json({ ok: true, count: channels.length, channels, configuredExtras: extra.map((c) => c.source) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, count: 0, channels: [], error: error.message || 'Sports channels failed' }, { status: 500 });
  }
}
