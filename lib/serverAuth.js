import crypto from 'crypto';

export const SESSION_COOKIE = 'jash_access';

// Session lifetime. 180 days stays the default so existing deployments and
// long-lived `?token=` integrations (Stremio) don't silently break, but it is
// now tunable: SESSION_TTL_DAYS=30 shortens every newly issued cookie.
const configuredTtlDays = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 180)) || 180;
export const SESSION_MAX_AGE_SECONDS = configuredTtlDays * 24 * 60 * 60;

/*
 * The token is a hash of the password plus an optional epoch. The epoch is the
 * revocation knob: setting SESSION_EPOCH (any string — "2026-09", a random
 * blob) changes every token at once, so a leaked cookie / `?token=` link /
 * header stops working everywhere without touching the password. Unset keeps
 * the historical seed so existing sessions survive deploys.
 *
 * KEEP IN SYNC with middleware.js — it recomputes the same hash in the edge
 * runtime and cannot import this module.
 */
function sessionSeed(password) {
  const epoch = String(process.env.SESSION_EPOCH || process.env.SESSION_SECRET || '').trim();
  const base = `jash-theatre:${password}`;
  return epoch ? `${base}:${epoch}` : base;
}

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
  return crypto.createHash('sha256').update(sessionSeed(password)).digest('hex');
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
