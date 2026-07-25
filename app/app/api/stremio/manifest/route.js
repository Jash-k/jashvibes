import { NextResponse } from 'next/server';
import { getStremioManifest, getTamilCatalogIds } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const manifest = await getStremioManifest();
    return NextResponse.json({
      ok: true,
      manifest,
      tamilCatalogs: getTamilCatalogIds(manifest),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Stremio manifest failed' }, { status: 500 });
  }
}
