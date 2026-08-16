'use client';

/**
 * FanCode live-stream helpers used by the /sports page.
 * (Cricket feed normalizers were revoked — the app no longer pulls
 * BCCI/WT20/IPL match feeds so the free-tier host sees no recurring traffic.)
 */

export const FANCODE_FEED = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';
const M3U8_PLAYER = 'https://m3u8-player-ashen.vercel.app/';

export function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (!matches.length) return text.match(/https?:\/\/[^\r\n]+\.m3u8[^\r\n]*/i)?.[0] || '';
  return matches.map((match) => ({ width: Number(match[1]), height: Number(match[2]), url: match[3].trim() })).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url || '';
}

export function playerUrlFromHls(url = '', title = 'Live') {
  return `${M3U8_PLAYER}?${new URLSearchParams({ src: url, title }).toString()}`;
}

/** FanCode live event rows (mixed sports — football, kabaddi, …). */
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
