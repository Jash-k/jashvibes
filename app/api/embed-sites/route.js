import { NextResponse } from 'next/server';
import { getConfiguredEmbedSites } from '@/lib/embedSites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const sites = getConfiguredEmbedSites();

  return NextResponse.json(
    {
      ok: true,
      enabled: sites.length > 0,
      sites,
      primary: sites[0] || null,
    },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
