import { NextResponse } from 'next/server';
import { summarizeVault } from '@/lib/vaultSummary';
import { loadVault } from '@/lib/vault';

/**
 * GET /api/vault — the Movie Vault catalogue.
 *
 * Serves the mv_vault GitHub catalogue through the app so the browser talks to
 * same-origin (session-gated by middleware like every other catalogue API) and
 * the GitHub raw fetch happens server-side at most once per ~30 min
 * (see lib/vault.js). The short browser max-age keeps rail↔page hops cheap
 * without ever serving a frozen list for a whole session.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    // `?force=1` bypasses the server memory cache — the vault page's
    // "Sync now" uses it after a scrape letter finishes and you want it now.
    const force = new URL(request.url).searchParams.has('force');
    const payload = await loadVault({ force });
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const movie = payload.movies.find((item) => item.id === id);
      return NextResponse.json({ movie: movie || null }, { status: movie ? 200 : 404, headers: { 'Cache-Control': 'private, max-age=60' } });
    }
    const summary = new URL(request.url).searchParams.get('view') === 'summary';
    return NextResponse.json(summary ? summarizeVault(payload) : payload, {
      headers: {
        'Cache-Control': force ? 'private, no-store' : 'private, max-age=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'The vault is unreachable right now.', detail: String(error?.message || error) },
      { status: 502 },
    );
  }
}
