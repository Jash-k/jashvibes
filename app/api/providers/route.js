import { NextResponse } from 'next/server';
import { SCRAPER_PROVIDERS } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PRIORITY = 'tamilott,omega,vidlink,videasy,vidzee,vidrock';

export async function GET() {
  const valid = new Set(SCRAPER_PROVIDERS.map((provider) => provider.id));
  const priority = (process.env.PROVIDERS || process.env.EMBED_PROVIDER_PRIORITY || DEFAULT_PRIORITY)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => valid.has(item));

  return NextResponse.json({
    success: true,
    ok: true,
    providers: SCRAPER_PROVIDERS.map((provider) => ({
      ...provider,
      enabled: true,
      mode: 'embed',
    })),
    priority,
  });
}
