import crypto from 'crypto';

export const SESSION_COOKIE = 'jash_access';
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60; // 180 days

function getConfiguredPassword() {
  return process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createAccessToken(password = getConfiguredPassword()) {
  return crypto.createHash('sha256').update(`jash-theatre:${password}`).digest('hex');
}

/** Constant-time comparison of a presented token against the expected one. */
export function isValidAccessToken(presented) {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return false;
  return Boolean(presented && safeEqual(presented, createAccessToken(configuredPassword)));
}

export function verifyRequestToken(request) {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return false;
  const cookieToken = typeof request?.cookies?.get === 'function'
    ? request.cookies.get(SESSION_COOKIE)?.value
    : '';
  const token =
    cookieToken ||
    request.headers.get('x-jash-token') ||
    request.headers.get('x-service-token') ||
    new URL(request.url).searchParams.get('token') ||
    '';
  return Boolean(token && safeEqual(token, createAccessToken(configuredPassword)));
}

export function requireServiceAuth(request) {
  if (!verifyRequestToken(request)) {
    const error = new Error('Service panel password required');
    error.status = 401;
    throw error;
  }
}
