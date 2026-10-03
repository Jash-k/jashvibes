import { NextResponse } from 'next/server';
import { browserScore } from '@/lib/providers/stremioProvider';
import { getStremioStreams } from '@/lib/stremioAddon';
import { warmStremioRegistry } from '@/lib/stremioRegistry';
import { matchMoviesda } from '@/lib/moviesdaSource';
import { resolveMoviesdaMovie, sortByQuality } from '@/lib/moviesda/resolve';
import { resolveEmbedProvider } from '@/lib/providers/embedProviders';
import { normalizeCandidates } from '@/lib/watch/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  const p = new URL(request.url).searchParams;
  const provider = p.get('provider');
  const tmdbId = Number(p.get('tmdbId')) || 0;
  const imdbId = /^tt\d+$/i.test(p.get('imdbId') || '') ? p.get('imdbId') : '';
  const type = p.get('type') === 'series' ? 'series' : 'movie';
  const season = Math.max(1, Number(p.get('season')) || 1), episode = Math.max(1, Number(p.get('episode')) || 1);
  try {
    let candidates = [];
    let note = '';
    if (provider === 'stremio') {
      await warmStremioRegistry();
      const reference = p.get('reference') || imdbId || (tmdbId ? `tmdb:${tmdbId}` : '');
      if (!reference) return NextResponse.json({ candidates: [], needsIdentity: true }, { status: 422 });
      const payload = await getStremioStreams({ type, id: reference, source: 'watch', season, episode });
      candidates = normalizeCandidates(payload.streams || [], provider).sort((a, b) => browserScore(b) - browserScore(a) || parseInt(b.quality || 0, 10) - parseInt(a.quality || 0, 10));
    } else if (provider === 'mp4') {
      if (type !== 'movie') return NextResponse.json({ candidates: [], reason: 'Direct MP4 catalogue currently contains movies.' });
      const match = await matchMoviesda({ tmdbId, type, title: p.get('title') || '', year: Number(p.get('year')) || 0, allowSearch: true });
      if (match?.pageUrl) {
        /*
         * Budget: 28s, not the old 12s.
         *
         * Measured on the live chain: a complete walk of one moviesda item page is
         * ~25s, and at 12s it returned 1 candidate where 25s returns 7 — a truncated
         * prefix that, on the title tested, was entirely dead hosts. The client
         * (hooks/useWatch.js) allows a provider 35s, so the honest budget is the one
         * that lets the walk finish. Normal clicks never pay this: the watch page
         * warms the resolver on load, so this is usually a cache hit.
         */
        const result = await resolveMoviesdaMovie(match.pageUrl, { budgetMs: 28000 });
        candidates = normalizeCandidates(sortByQuality(result.mp4s || []), provider);
        if (candidates.length && !candidates.some((c) => c.health !== 'dead')) {
          // Every host refused this time. Reported as a note, not as an error: the
          // UI still lists them (retry can revive a per-request token) but must not
          // present a dead list as a working source.
          note = 'The hosts for this title all refused right now — retry in a moment, or try another source.';
        }
      }
    } else if (provider === 'mirchi') {
      if (!tmdbId) return NextResponse.json({ candidates: [], needsIdentity: true }, { status: 422 });
      const result = resolveEmbedProvider({ provider: 'mirchi', tmdbId, type, season, episode, language: 'tam' });
      const item = result?.providers?.find((v) => v.id === 'mirchi') || result?.selected;
      if (item?.streamUrl) candidates = normalizeCandidates([{ url: item.streamUrl, kind: 'embed', label: 'Mirchi · source-controlled quality' }], provider);
    } else return NextResponse.json({ error: 'Unknown provider' }, { status: 400 });
    return NextResponse.json({ provider, candidates, ...(note ? { note } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ provider, candidates: [], error: error.message || 'Source unavailable' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
