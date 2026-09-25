import crypto from 'crypto';
import dbConnect from '@/lib/db';
import { getSetting, setSetting } from '@/models/Setting';

export const ADMIN_COOKIE = 'jash_admin';

/**
 * Admin sessions live 12 h — an owner panel should not carry a 180-day cookie.
 */
export const ADMIN_TTL_SECONDS = 12 * 60 * 60;

function getConfiguredAdminPassword() {
  return String(process.env.ADMIN_PASS || '').trim();
}

export function isAdminConfigured() {
  return Boolean(getConfiguredAdminPassword());
}

/**
 * Token = SHA-256("jash-admin:" + ADMIN_PASS + [:EPOCH_ENV] + [:DB_EPOCH]).
 *
 * The DB epoch is the "Kill all admin sessions" button: bumping the stored
 * value invalidates every issued admin cookie instantly, without a redeploy.
 * (The main app's revocation knob stays the SESSION_EPOCH env — the edge
 * middleware that guards /api/* cannot read MongoDB.)
 */
export async function createAdminToken() {
  const password = getConfiguredAdminPassword();
  if (!password) return '';
  const envEpoch = String(process.env.SESSION_EPOCH || '').trim();
  let dbEpoch = '';
  try {
    await dbConnect();
    dbEpoch = String((await getSetting('admin_epoch', '')) || '');
  } catch {
    dbEpoch = ''; // DB unreachable: tokens still derive, kill-all just cannot have happened
  }
  const seed = `jash-admin:${password}${envEpoch ? `:${envEpoch}` : ''}${dbEpoch ? `:${dbEpoch}` : ''}`;
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** Verify a presented admin token against the configured password + epochs. */
export async function isValidAdminToken(presented) {
  if (!isAdminConfigured()) return false;
  if (!presented) return false;
  return safeEqual(String(presented), await createAdminToken());
}

/** Constant-time password check for the login endpoint. */
export function isAdminPassword(password) {
  const expected = getConfiguredAdminPassword();
  if (!expected) return false;
  const value = String(password || '');
  if (value.length !== expected.length) return false;
  return safeEqual(value, expected);
}

/**
 * Guard for every /api/admin/* handler. Returns a NextResponse on failure
 * (callers `return deny(request)`), or null when the request may proceed.
 */
export async function adminDeny(request) {
  if (!isAdminConfigured()) {
    return Response.json(
      { error: 'Admin panel is not configured. Set ADMIN_PASS in the environment.' },
      { status: 503 },
    );
  }
  const cookieToken = request?.cookies?.get?.(ADMIN_COOKIE)?.value || '';
  const headerToken = request?.headers?.get?.('x-admin-token') || '';
  if (await isValidAdminToken(cookieToken || headerToken)) return null;
  return Response.json({ error: 'Admin authentication required.' }, { status: 401 });
}

/** Bump the stored admin epoch — every issued admin cookie dies immediately. */
export async function rotateAdminEpoch() {
  await dbConnect();
  await setSetting('admin_epoch', `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`);
}
