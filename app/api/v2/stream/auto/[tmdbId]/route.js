import { NextResponse } from 'next/server';
import { resolveEmbedProvider } from '@/lib/providers/embedProviders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type) {
  return type === 'tv' || type === 'series' ? 'tv' : 'movie';
}

export async function GET(request, { params }) {
  try {
    const tmdbId = Number(params.tmdbId);
    const { searchParams } = new URL(request.url);
    const type = normalizeType(searchParams.get('type'));
    const season = Number(searchParams.get('season') || searchParams.get('s') || 1);
    const episode = Number(searchParams.get('episode') || searchParams.get('e') || 1);
    const language = searchParams.get('lan') || searchParams.get('language') || 'tam';
    const provider = searchParams.get('provider') || 'auto';

    if (!tmdbId || Number.isNaN(tmdbId)) {
      return NextResponse.json({ ok: false, error: 'Invalid TMDB ID' }, { status: 400 });
    }

    const resolved = resolveEmbedProvider({
      tmdbId,
      type,
      season,
      episode,
      language,
      provider,
    });

    return NextResponse.json({
      ok: true,
      success: true,
      available: true,
      provider: resolved.selected.providerId,
      selectedProvider: resolved.selected.provider,
      fallbackTriggered: false,
      subjectId: String(tmdbId),
      streamType: resolved.selected.streamType,
      embedUrl: resolved.selected.streamUrl,
      streamUrl: resolved.selected.streamUrl,
      embedFallbacks: resolved.providers.map((provider) => provider.streamUrl),
      providers: resolved.attempts,
    });
  } catch (error) {
    console.error('[api/v2/stream/auto] Error:', error);
    return NextResponse.json(
      { ok: false, success: false, available: false, error: 'Unable to resolve stream' },
      { status: 500 }
    );
  }
}
