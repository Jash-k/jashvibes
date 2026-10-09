import { NextResponse } from 'next/server';
import { getStremioManifest, getStremioManifestUrl, getTamilCatalogIds } from '@/lib/stremioAddon';
import { warmStremioRegistry } from '@/lib/stremioRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const source = new URL(request.url).searchParams.get('source') || 'catalog';
    const force = new URL(request.url).searchParams.get('fresh') === '1';
    await warmStremioRegistry({ force });
    const manifest = await getStremioManifest({ source, force });
    return NextResponse.json({
      ok: true,
      manifest,
      manifestUrl: getStremioManifestUrl({ source }),
      tamilCatalogs: getTamilCatalogIds(manifest),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Stremio manifest failed' }, { status: 500 });
  }
}
