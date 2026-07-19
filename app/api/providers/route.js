import { NextResponse } from 'next/server';
import { SCRAPER_PROVIDERS } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    success: true,
    ok: true,
    providers: SCRAPER_PROVIDERS.map((provider) => ({
      ...provider,
      enabled: true,
      mode: 'embed',
    })),
    priority: (process.env.PROVIDERS || process.env.EMBED_PROVIDER_PRIORITY || 'tamilott,screenscape,vidlink,vidnest,videasy,vidzee,vidrock,vixsrc,oneembed,vidsrcsbs,vidsrc')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  });
}
