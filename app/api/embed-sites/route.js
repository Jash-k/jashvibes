import { NextResponse } from 'next/server';
import { getConfiguredEmbedSites } from '@/lib/embedSites';
import { readExtras } from '@/lib/extrasStore';
import { legacyExtras } from '@/lib/extrasRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const origin = new URL(request.url).origin;
  let registry, source, degraded = false;
  try {
    const data = await readExtras(origin);
    registry = data.registry; source = data.source;
  } catch {
    // A DB outage must not resurrect websites hidden or deleted by the admin.
    if (process.env.DB || process.env.DB_URI || process.env.MONGODB_URI) return NextResponse.json({ ok: false, error: 'Website collection unavailable. Please retry shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const sites = legacyExtras(getConfiguredEmbedSites(), origin);
    if (!sites.length) return NextResponse.json({ ok: false, error: 'Website collection unavailable. Please retry shortly.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    registry = { sites }; source = 'environment'; degraded = true;
  }
  const sites = registry.sites.filter(s => s.enabled);
  return NextResponse.json({ ok: true, enabled: sites.length > 0, sites, primary: sites[0] || null, source, degraded }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
