export const JIO_REFERER = 'https://www.jiotv.co/';
export const JIO_USER_AGENT = 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6';
export const JIO_COOKIE_OVERRIDE_KEY = 'jash_jio_cookie_override';

const JIO_STREAM_HOSTS = new Set([
  'jiotvmblive.cdn.jio.com',
  'jiotvpllive.cdn.jio.com',
  'nw18live.cdn.jio.com',
]);

export function normalizeJioCookie(value = '') {
  let text = String(value || '').trim();
  if (!text) return '';

  try {
    if (/%(?:2F|3D|7E)/i.test(text)) text = decodeURIComponent(text);
  } catch {}

  text = text
    .replace(/^cookie\s*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  const match = text.match(/(?:^|[;\s])((?:__hdnea__|hdnea)=st=[^&;"'`\s]+)/i)
    || text.match(/^((?:__hdnea__|hdnea)=st=[^&;"'`\s]+)/i)
    || text.match(/(?:^|[;\s])(st=\d+~exp=\d+~acl=[^~\s;]+~hmac=[a-f0-9]+)/i)
    || text.match(/^(st=\d+~exp=\d+~acl=[^~\s;]+~hmac=[a-f0-9]+)/i);
  if (!match?.[1]) return '';

  const token = match[1].replace(/^hdnea=/i, '').replace(/^__hdnea__=/i, '');
  return token ? `__hdnea__=${token}` : '';
}

export function getJioCookieExpiry(value = '') {
  const cookie = normalizeJioCookie(value);
  const match = cookie.match(/(?:^|~)exp=(\d+)(?:~|$)/i);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

export function isJioCookieValid(value = '', minValidityMs = 90_000) {
  const cookie = normalizeJioCookie(value);
  if (!cookie) return false;
  const expiresAt = getJioCookieExpiry(cookie);
  return expiresAt == null || expiresAt > Date.now() + Math.max(0, Number(minValidityMs) || 0);
}

export function appendJioCookieToUrl(uri = '', value = '') {
  const cookie = normalizeJioCookie(value);
  const input = String(uri || '').trim();
  if (!input || !cookie) return input;

  const hashAt = input.indexOf('#');
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
  const questionAt = withoutHash.indexOf('?');
  const path = questionAt >= 0 ? withoutHash.slice(0, questionAt) : withoutHash;
  const query = questionAt >= 0 ? withoutHash.slice(questionAt + 1) : '';
  const kept = query
    .split('&')
    .filter(Boolean)
    .filter((part) => !/^(?:__hdnea__|hdnea)=/i.test(part));
  kept.push(cookie);
  return `${path}?${kept.join('&')}`;
}

export function getJioStreamHost(value = '') {
  try {
    return new URL(String(value || '')).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isJioStreamUrl(value = '') {
  return JIO_STREAM_HOSTS.has(getJioStreamHost(value));
}

export function isJioChannel(channel = {}, uri = '') {
  const candidate = String(uri || channel.url || '').trim();
  if (candidate) return isJioStreamUrl(candidate);
  const source = `${channel.sourceId || ''} ${channel.source || ''}`.toLowerCase();
  return source.includes('jio');
}

export function buildJioProxyUrl(uri = '', cookie = '') {
  const params = new URLSearchParams({ u: String(uri || '') });
  const normalized = normalizeJioCookie(cookie);
  if (normalized) params.set('ck', normalized);
  return `/api/live-jio?${params.toString()}`;
}

export function restoreJioProxyUrl(uri = '', baseOrigin = '') {
  try {
    const parsed = new URL(String(uri || ''), baseOrigin || 'http://localhost');
    if (parsed.pathname === '/api/live-jio') return parsed.searchParams.get('u') || uri;
  } catch {}
  return uri;
}
