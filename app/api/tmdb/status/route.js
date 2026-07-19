import { NextResponse } from 'next/server';
import { fetchTMDB } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function configuredEnvNames() {
  return [
    'TMDB',
    'TMDB_KEYS',
    'TMDB_API_KEYS',
    'TMDB_API_KEY',
    'TMDB_KEY',
    'TMDB_TOKEN',
    'TMDB_TOKENS',
    'TMDB_BEARER_TOKEN',
    'TMDB_BEARER_TOKENS',
  ].filter((name) => Boolean(process.env[name]));
}

export async function GET() {
  const envNames = configuredEnvNames();
  try {
    const payload = await fetchTMDB('configuration');
    return NextResponse.json(
      {
        ok: true,
        configured: envNames.length > 0,
        envNames,
        imagesBaseUrl: payload?.images?.secure_base_url || '',
        posterSizes: payload?.images?.poster_sizes || [],
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        configured: envNames.length > 0,
        envNames,
        error: error.message || 'TMDB check failed',
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
