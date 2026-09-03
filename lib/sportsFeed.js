'use client';

/**
 * Sports & Match Center helpers
 */

export const FANCODE_FEED = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';
const M3U8_PLAYER = 'https://m3u8-player-ashen.vercel.app/';

export function encodeMatchHash(payload) {
  try {
    const json = JSON.stringify(payload);
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(json, 'utf-8').toString('base64url');
    }
    const utf8Bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < utf8Bytes.length; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function decodeMatchHash(hash = '') {
  if (!hash) return null;
  const raw = Array.isArray(hash) ? hash.join('/') : String(hash);
  try {
    let clean = decodeURIComponent(raw.trim());
    const padded = clean.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(clean.length / 4) * 4, '=');
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    try {
      let clean = decodeURIComponent(raw.trim());
      const padded = clean.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(clean.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch {
      try { return JSON.parse(atob(decodeURIComponent(raw))); } catch { return null; }
    }
  }
}

export function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (!matches.length) return text.match(/https?:\/\/[^\r\n]+\.m3u8[^\r\n]*/i)?.[0] || '';
  return matches.map((match) => ({ width: Number(match[1]), height: Number(match[2]), url: match[3].trim() })).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url || '';
}

export function playerUrlFromHls(url = '', title = 'Live') {
  return `${M3U8_PLAYER}?${new URLSearchParams({ src: url, title }).toString()}`;
}

export function normalizeFancodeEvent(row = {}) {
  const stream = bestFancodeVariant(row.auto_streams?.[0]?.auto || '') || row.STREAMING_CDN?.Primary_Playback_URL || '';
  const category = String(row.category || row.sport || 'Other').trim();
  const status = String(row.status || '').toUpperCase();
  return {
    id: String(row.match_id || row.title || ''),
    provider: 'FanCode',
    type: 'fancode',
    status: status === 'LIVE' ? 'live' : status === 'COMPLETED' ? 'completed' : 'upcoming',
    title: row.title || 'FanCode Event',
    subtitle: row.tournament || category,
    competition: row.tournament || 'FanCode',
    category: category.toLowerCase(),
    venue: '',
    date: row.start_time || row.date || '',
    score1: '',
    score2: '',
    result: '',
    href: stream ? playerUrlFromHls(stream, row.title || 'FanCode') : '',
  };
}

export function isCricketFeedItem(item = {}) {
  const text = `${item.provider || ''} ${item.type || ''} ${item.category || ''} ${item.competition || ''} ${item.title || ''}`.toLowerCase();
  return item.type === 'bcci' || item.type === 'wt20' || item.type === 'ipl' || text.includes('cricket') || text.includes('t20') || text.includes('odi') || text.includes('ipl');
}
