import crypto from 'node:crypto';

export function issueSession(secret, realm, ttlSeconds, now = Date.now()) {
  if (!secret) return '';
  const issued = Math.floor(now / 1000), expiry = issued + Math.max(60, Number(ttlSeconds) || 3600);
  const body = `v1.${issued}.${expiry}`;
  const signature = crypto.createHmac('sha256', secret).update(`${realm}:${body}`).digest('hex');
  return `${body}.${signature}`;
}
export function verifySession(token, secret, realm, ttlSeconds, now = Date.now()) {
  if (!secret || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1]) || !/^\d+$/.test(parts[2]) || !/^[a-f0-9]{64}$/.test(parts[3])) return false;
  const issued = Number(parts[1]), expiry = Number(parts[2]), seconds = Math.floor(now / 1000);
  if (issued > seconds + 60 || expiry <= seconds || expiry <= issued || expiry - issued > Number(ttlSeconds) + 1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${realm}:${parts.slice(0, 3).join('.')}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(parts[3]), Buffer.from(expected));
}
export function rejectCrossOriginMutation(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request?.method)) return false;
  const origin = request.headers?.get?.('origin');
  if (!origin) return false; // non-browser integrations still require a signed owner token
  try {
    const host = new URL(origin).host;
    const allowed = [new URL(request.url).host, request.headers.get('host'), request.headers.get('x-forwarded-host'), process.env.SITE_URL ? new URL(process.env.SITE_URL).host : ''].filter(Boolean);
    return !allowed.includes(host);
  } catch { return true; }
}
