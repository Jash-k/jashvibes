import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE,
  ADMIN_TTL_SECONDS,
  adminDeny,
  createAdminToken,
  isAdminConfigured,
  isAdminPassword,
  isValidAdminToken,
  rotateAdminEpoch,
} from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const buckets = (globalThis.__jashAdminAuthBuckets ||= new Map());

function rateLimited(request) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 5 * 60 * 1000 };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count > 8;
}

function withAdminCookie(response, token) {
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    path: '/',
    maxAge: ADMIN_TTL_SECONDS,
  });
  return response;
}

/** GET — is the admin cookie still valid? */
export async function GET(request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ success: false, configured: false, error: 'ADMIN_PASS is not set' }, { status: 503 });
  }
  const token = request.cookies.get(ADMIN_COOKIE)?.value || '';
  if (!(await isValidAdminToken(token))) {
    return NextResponse.json({ success: false, configured: true }, { status: 401 });
  }
  return NextResponse.json({ success: true, configured: true });
}

/** POST {password} — login. POST {action:'kill-all'} — revoke every admin session now. */
export async function POST(request) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ success: false, error: 'ADMIN_PASS is not set. Add it in the Render dashboard.' }, { status: 503 });
  }

  if (rateLimited(request)) {
    return NextResponse.json(
      { error: 'Too many admin attempts. Wait five minutes.' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  const body = await request.json().catch(() => ({}));

  if (body?.action === 'kill-all') {
    const deny = await adminDeny(request);
    if (deny) return deny;
    await rotateAdminEpoch();
    const response = NextResponse.json({ success: true, killed: true });
    response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  }

  const password = String(body?.password || '');
  if (!isAdminPassword(password)) {
    return NextResponse.json({ success: false, error: 'Wrong admin password.' }, { status: 401 });
  }

  const token = await createAdminToken();
  return withAdminCookie(NextResponse.json({ success: true }), token);
}

/** DELETE — logout (clears the cookie; the token itself dies with its 12 h TTL or kill-all). */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
