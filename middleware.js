import { NextResponse } from 'next/server';

/**
 * JaSH ViBeS API firewall.
 *
 * Before this middleware existed, every /api/* route was publicly callable —
 * the password gate only hid the UI. Now every API request must present the
 * session token (SHA-256 of `jash-theatre:${PASS}`) via one of:
 *
 *   1. `jash_access` HttpOnly cookie  — set automatically by /api/auth on
 *      unlock, so all same-origin browser fetches just work with no client
 *      changes. This is the normal path for the web app.
 *   2. `x-jash-token` / `x-service-token` header — service panel & tools.
 *   3. `?token=` query param — escape hatch for external integrations
 *      (e.g. installing the Stremio addon in the real Stremio app).
 *
 * Exempt routes:
 *   - /api/auth          the login endpoint itself (rate limited instead)
 *   - /api/health        uptime probes; returns only ok/time
 *   - /api/cron/tamilmv  external schedulers; has its own CRON secret check
 *
 * Rate limits are per-IP fixed windows (in-memory; resets on restart — good
 * enough for a single free-tier container). Media proxy routes are excluded
 * on purpose: HLS/DASH playback generates many segment requests.
 */

const SESSION_COOKIE = 'jash_access';

const PUBLIC_PATHS = new Set(['/api/auth', '/api/health']);
const SELF_TOKENIZED_PREFIXES = ['/api/cron/tamilmv'];

const RATE_RULES = [
  // Brute-force protection for the password endpoint.
  { prefix: '/api/auth', limit: 12, windowMs: 5 * 60 * 1000 },
  // Expensive upstream-calling routes.
  { prefix: '/api/resolve', limit: 60, windowMs: 60 * 1000 },
  { prefix: '/api/v2/stream', limit: 60, windowMs: 60 * 1000 },
  { prefix: '/api/search', limit: 60, windowMs: 60 * 1000 },
  { prefix: '/api/match-resolve', limit: 60, windowMs: 60 * 1000 },
  { prefix: '/api/sports/dynamic', limit: 60, windowMs: 60 * 1000 },
  { prefix: '/api/stremio/stream', limit: 90, windowMs: 60 * 1000 },
];

const buckets = (globalThis.__jashRateBuckets ||= new Map());

function hitRateLimit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  // Opportunistic cleanup so the map can't grow unbounded.
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets) {
      if (now > value.resetAt) buckets.delete(bucketKey);
    }
  }
  return {
    limited: bucket.count > limit,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

// Edge-runtime-safe SHA-256 (must match lib/serverAuth.js exactly).
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0].trim() || 'unknown';
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  for (const rule of RATE_RULES) {
    if (pathname.startsWith(rule.prefix)) {
      const { limited, retryAfter } = hitRateLimit(`${rule.prefix}:${getClientIp(request)}`, rule.limit, rule.windowMs);
      if (limited) {
        return NextResponse.json(
          { error: 'Too many requests. Please slow down and try again shortly.' },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
      break;
    }
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (SELF_TOKENIZED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return NextResponse.next();

  const password = process.env.PASS || process.env.SPACE_PASSWORD || process.env.APP_PASSWORD || '';
  // When no password is configured the app is intentionally open (dev mode).
  if (!password) return NextResponse.next();

  const expected = await sha256Hex(`jash-theatre:${password}`);
  const presented =
    request.cookies.get(SESSION_COOKIE)?.value ||
    request.headers.get('x-jash-token') ||
    request.headers.get('x-service-token') ||
    request.nextUrl.searchParams.get('token') ||
    '';

  if (presented && safeEqual(presented, expected)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: 'Authentication required. Unlock JaSH ViBeS first.' },
    { status: 401 },
  );
}

export const config = {
  matcher: ['/api/:path*'],
};
