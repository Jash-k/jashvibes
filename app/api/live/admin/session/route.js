import { NextResponse } from 'next/server';
import { ADMIN_COOKIE, isAdminConfigured, isValidAdminToken } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/admin/session
 * Non-throwing probe the public /live page uses to decide whether owner-only
 * controls (the per-card hide button) may render. Never leaks why a token is
 * invalid — the answer is one boolean, and no mutation is possible here.
 */
export async function GET(request) {
  if (!isAdminConfigured()) return NextResponse.json({ admin: false });
  const token = request.cookies.get(ADMIN_COOKIE)?.value || request.headers.get('x-admin-token') || '';
  const admin = await isValidAdminToken(token);
  return NextResponse.json({ admin }, { headers: { 'Cache-Control': 'no-store' } });
}
