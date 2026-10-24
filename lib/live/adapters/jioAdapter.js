/**
 * lib/live/adapters/jioAdapter.js — Jio JSON (jstr4web.json, sony jio)
 * URL has no token; token injected at PLAY time via getFreshJioCookie()
 */
import { BaseAdapter } from './base.js';

export class JioAdapter extends BaseAdapter {
  async parse(text, sourceDef) {
    let arr;
    try { arr = JSON.parse(text); } catch { throw new Error('Jio JSON invalid'); }
    if (!Array.isArray(arr)) throw new Error('Jio JSON not array');

    const out = [];
    for (const item of arr) {
      if (!item?.url) continue;
      const name = String(item.name||item.title||'').trim() || 'Jio Channel';
      const url = String(item.url).trim();
      const format = url.includes('.mpd') ? 'dash' : url.includes('.m3u8') ? 'hls' : 'dash';
      out.push({
        name,
        url,
        logo: String(item.logo||''),
        category: String(item.category||'Entertainment'),
        language: '', // Jio category holds language
        tvgId: String(item.id||''),
        format,
        playable: true,
        keyId: String(item.keyId||''),
        key: String(item.key||''),
        licenseKey: '',
        licenseType: 'clearkey',
        cookie: '',
        userAgent: '',
        referer: '',
        headers: {},
        source: sourceDef.label,
      });
    }
    return out;
  }
}
