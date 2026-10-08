/** Pure header normalization shared by the importer and custom Live relay. */
const BLOCKED = /^(?:host|connection|content-length|transfer-encoding|upgrade|keep-alive|proxy-connection|te|trailer|sec-.*|proxy-.*)$/i;
const ALIASES = { useragent: 'user-agent', ua: 'user-agent', referrer: 'referer', cookies: 'cookie' };

export function normalizeLiveHeaders(value = {}) {
  const headers = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return headers;
  for (const [rawName, rawValue] of Object.entries(value).slice(0, 40)) {
    const name = ALIASES[rawName.toLowerCase()] || rawName.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || BLOCKED.test(name)) continue;
    if (typeof rawValue !== 'string' && typeof rawValue !== 'number') continue;
    if (/[\r\n\0]/.test(String(rawValue))) continue;
    const text = String(rawValue).trim();
    if (!text || text.length > 8192) continue;
    headers[name] = text;
  }
  return headers;
}

/** Decode values separately; decoding the entire query first splits encoded &. */
export function parseLiveHeaderOptions(text = '') {
  const headers = {};
  const decode = (v) => { try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch { return v; } };
  for (const part of String(text).replace(/&quot;/g, '"').split('&')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    headers[decode(part.slice(0, at)).trim()] = decode(part.slice(at + 1)).trim();
  }
  return normalizeLiveHeaders(headers);
}

export function liveSourceHeaders(channel = {}) {
  return normalizeLiveHeaders({
    ...normalizeLiveHeaders(channel.headers),
    ...(channel.userAgent ? { 'user-agent': channel.userAgent } : {}),
    ...(channel.referer ? { referer: channel.referer } : {}),
    ...(channel.cookie ? { cookie: channel.cookie } : {}),
  });
}
