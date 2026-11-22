import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { isStremioEnabled } from '@/lib/stremioAccess';
import dbConnect from '@/lib/db';
import { setSetting } from '@/models/Setting';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request) {
  const deny = await adminDeny(request); if (deny) return deny;
  return NextResponse.json({ ok: true, enabled: await isStremioEnabled(), hardOff: process.env.STREMIO_ENABLED?.toLowerCase() === 'false' }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function PATCH(request) {
  const deny = await adminDeny(request); if (deny) return deny;
  const body = await request.json().catch(() => ({}));
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ ok: false, error: 'enabled must be a boolean' }, { status: 400 });
  try {
    await dbConnect(); await setSetting('stremio_source_enabled', body.enabled);
    globalThis.__jashStremioRegistry = { at: 0, map: {} };
    return NextResponse.json({ ok: true, enabled: await isStremioEnabled() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ ok: false, error: 'Setting could not be saved' }, { status: 503 }); }
}
