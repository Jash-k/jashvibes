import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import StremioAddon from '@/models/StremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 12000;

/** POST /api/admin/stremio/addons/check {id?} — fetch the manifest, record health. */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const query = body?.id ? { _id: body.id } : {};
    const addons = await StremioAddon.find(query).lean();
    if (!addons.length) return NextResponse.json({ ok: false, error: 'No addons to check' }, { status: 404 });

    const results = [];
    for (const addon of addons) {
      const patch = { lastCheckedAt: new Date() };
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const url = `${String(addon.manifestUrl).replace(/\/+$/, '')}/manifest.json`;
        const response = await fetch(url, {
          signal: controller.signal,
          cache: 'no-store',
          headers: { Accept: 'application/json', 'User-Agent': 'JaSH-ViBeS-Admin/1.0' },
        });
        clearTimeout(timer);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.name) throw new Error(`HTTP ${response.status}`);
        patch.addonName = String(payload.name || '');
        patch.catalogCount = Array.isArray(payload.catalogs) ? payload.catalogs.length : 0;
        patch.lastStatus = 'ok';
        patch.lastError = '';
      } catch (error) {
        patch.lastStatus = 'error';
        patch.lastError = error?.name === 'AbortError' ? 'Timed out' : String(error?.message || 'Unreachable');
      }
      await StremioAddon.updateOne({ _id: addon._id }, { $set: patch });
      results.push({ id: String(addon._id), label: addon.label, ...patch });
    }

    return NextResponse.json(
      { ok: true, results, message: `Checked ${results.length} addon(s).` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Check failed' }, { status: 500 });
  }
}
