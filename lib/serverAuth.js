import crypto from 'crypto';
import { issueSession, verifySession, rejectCrossOriginMutation } from '@/lib/signedSession';
import { isValidAdminToken } from '@/lib/adminAuth';

export const SESSION_COOKIE = 'jash_access';

// Session lifetime. 180 days stays the default so existing deployments and
// long-lived `?token=` integrations (Stremio) don't silently break, but it is
// now tunable: SESSION_TTL_DAYS=30 shortens every newly issued cookie.
const configuredTtlDays = Math.min(180, Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30))) || 30;
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
  return issueSession(sessionSeed(password), 'theatre', SESSION_MAX_AGE_SECONDS);
}

/** Constant-time comparison of a presented token against the expected one. */
export function isValidAccessToken(presented) {
  const configuredPassword = getConfiguredPassword();
  if (!configuredPassword) return false;
  return verifySession(presented, sessionSeed(configuredPassword), 'theatre', SESSION_MAX_AGE_SECONDS);
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
  return isValidAccessToken(token);
}

export async function requireServiceAuth(request) {
  if (rejectCrossOriginMutation(request)) throw Object.assign(new Error('Cross-origin owner mutation refused'), { status: 403 });
  const cookie = request?.cookies?.get?.('jash_admin')?.value || '';
  const token = request?.headers?.get?.('x-admin-token') || '';
  if (await isValidAdminToken(cookie || token)) return;
  throw Object.assign(new Error('Owner authentication required for this action.'), { status: 401 });
}
