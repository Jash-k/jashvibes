import { NextResponse } from 'next/server';
import { SCRAPER_PROVIDERS } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_PRIORITY = 'mirchi,vidlink,videasy,vidzee,vidrock';

export async function GET() {
  const valid = new Set(SCRAPER_PROVIDERS.map((provider) => provider.id));
  const envPriority = (process.env.PROVIDERS || process.EMBED_PROVIDER_PRIORITY || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => valid.has(item));

  // Fixed chain for every auto flow: Global Mirchi first, then the rest of
  // the providers (stale PROVIDERS env values cannot pull anything ahead of
  // Mirchi; they may only re-order the tail).
  const tail = (envPriority.length ? envPriority : DEFAULT_PRIORITY.split(','))
    .filter((id) => id !== 'mirchi');
  const priority = ['mirchi', ...tail];

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
