import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Media from '@/models/Media';
import { fetchTMDB } from '@/lib/tmdb';
import {
  buildStoredSource,
  resolveEmbedProvider,
} from '@/lib/providers/embedProviders';
import {
  createStremioAttempt,
  resolveStremioProvider,
} from '@/lib/providers/stremioProvider';
import { matchMoviesda } from '@/lib/moviesdaSource';
import { resolveMoviesdaMovie, sortByQuality } from '@/lib/moviesda/resolve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'series' : 'movie';
}

function uniqueList(items) {
  return [...new Set((items || []).filter(Boolean))];
}

async function getImdbIdForProvider({ tmdbId, type }) {
  if (!tmdbId) return '';
  const mediaType = normalizeType(type) === 'series' ? 'tv' : 'movie';
  try {
    const external = await fetchTMDB(`/${mediaType}/${tmdbId}/external_ids`);
    if (external?.imdb_id) return external.imdb_id;
  } catch {}

  try {
    const base = String(process.env.MOVIES1_BACKEND || process.env.ANCHORHD_BACKEND || 'https://movies1-backend.onrender.com').replace(/\/+$/, '');
    const url = new URL('/api/tmdb-details', base);
    url.searchParams.set('tmdbId', String(tmdbId));
    url.searchParams.set('contentType', mediaType === 'tv' ? 'tv' : 'movie');
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    return data?.data?.imdb_id || '';
  } catch {
    return '';
  }
}

async function checkEmbedUrl(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    return {
      ok: response.ok && contentType.includes('text/html'),
      status: response.status,
      finalUrl: response.url || url,
      contentType,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      error: error.name === 'AbortError' ? 'Timed out checking embed URL' : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function chooseHealthyVidSrcMirror(provider) {
  if (provider?.id !== 'vidsrc') return provider;

  const candidates = uniqueList([provider.streamUrl, ...(provider.fallbacks || [])]);
  const checked = await Promise.all(
    candidates.slice(0, 6).map(async (candidate) => ({
      url: candidate,
      ...(await checkEmbedUrl(candidate)),
    })),
  );

  const healthy = checked.find((item) => item.ok);
  if (healthy) {
    const chosenUrl = healthy.finalUrl || healthy.url;
    return {
      ...provider,
      streamUrl: chosenUrl,
      fallbacks: uniqueList(candidates.filter((item) => item !== healthy.url && item !== chosenUrl)),
      health: {
        ok: true,
        status: healthy.status,
        checkedUrl: healthy.url,
        finalUrl: chosenUrl,
      },
    };
  }

  return {
    ...provider,
    health: {
      ok: false,
      checked,
      reason: 'No VidSrc mirror returned a healthy HTML embed during the quick API check.',
    },
  };
}

async function saveEmbedSources({ tmdbId, type, sources }) {
  if (!tmdbId || !sources?.length) return { saved: false };

  const mongoSources = sources.map(buildStoredSource);

  await Media.updateOne(
    { tmdbId, type },
    {
      $setOnInsert: {
        title: `TMDB ${tmdbId}`,
        category: 'Tamil',
        type,
        tmdbId,
        synopsis: '',
        posterUrl: '',
      },
      $addToSet: {
        sources: { $each: mongoSources },
      },
    },
    { upsert: true }
  );

  return { saved: true, sources: mongoSources };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawTmdbId = searchParams.get('tmdbId');
    const parsedTmdbId = Number(rawTmdbId);
    const hasValidTmdbId = Boolean(parsedTmdbId && !Number.isNaN(parsedTmdbId));
    const tmdbId = hasValidTmdbId ? parsedTmdbId : null;
    const type = normalizeType(searchParams.get('type'));
    const season = Number(searchParams.get('season') || searchParams.get('s') || 1);
    const episode = Number(searchParams.get('episode') || searchParams.get('e') || 1);
    const language = searchParams.get('lan') || searchParams.get('language') || 'tam';
    const provider = searchParams.get('provider') || 'auto';
    const stremioStreamId = searchParams.get('stremioStreamId') || '';
    const quality = (searchParams.get('quality') || '').toLowerCase();
    const rawRequestedProvider = String(provider || 'auto').toLowerCase();
    const paramTitle = String(searchParams.get('title') || '');
    const paramYear = Number(searchParams.get('year')) || 0;
    // TamilOTT was removed; stale client/bookmarked requests fold into auto.
    const requestedProvider = rawRequestedProvider === 'tamilott' ? 'auto' : rawRequestedProvider;
    if (!hasValidTmdbId) {
      return NextResponse.json(
        { error: 'A valid tmdbId is required. Use the Match button on an unmatched homepage poster to bind a TMDB/IMDb id first.' },
        { status: 400 },
      );
    }

    let resolved = { selected: null, providers: [], attempts: [] };
    let selected = null;
    let attempts = [];
    let sourcesToSave = [];

    if (hasValidTmdbId) {
      const imdbId = await getImdbIdForProvider({ tmdbId, type });
      resolved = resolveEmbedProvider({
        tmdbId,
        imdbId,
        type,
        season,
        episode,
        language,
        // Force Mirchi-only embed catalogue — third-party embeds are retired.
        provider: requestedProvider === 'auto' || requestedProvider === 'stremio' || requestedProvider === 'mp4' || requestedProvider === 'iframe'
          ? 'mirchi'
          : provider,
      });
      // Keep only Mirchi in the embed provider list (drop VidLink/VidEasy/…).
      resolved.providers = (resolved.providers || []).filter((entry) => entry.id === 'mirchi');
      resolved.attempts = (resolved.attempts || []).filter((entry) => entry.providerId === 'mirchi');
      if (resolved.selected && resolved.selected.id !== 'mirchi') {
        resolved.selected = resolved.providers[0] || null;
      }

      selected = resolved.selected;
      attempts = resolved.attempts.map((attempt) => {
        if (attempt.providerId !== selected.id) return attempt;
        return {
          ...attempt,
          streamUrl: selected.streamUrl,
          fallbacks: selected.fallbacks || attempt.fallbacks || [],
          health: selected.health || null,
          reason: selected.health?.ok
            ? `Selected manually or by priority. VidSrc API check returned ${selected.health.status} and chose the reachable mirror.`
            : attempt.reason,
        };
      });
      sourcesToSave = resolved.providers;
    }

    // v10.6.0: does the moviesda scraper data know this title? Index lookup
    // only (cached raw GitHub files) — playable links are minted fresh when a
    // tier is actually picked.
    let moviesdaMatch = null;
    if (hasValidTmdbId) {
      moviesdaMatch = await matchMoviesda({ tmdbId, title: paramTitle, year: paramYear }).catch(() => null);
    }

    // Auto chain (locked): Stremio → Direct MP4 (moviesda) → Global Mirchi.
    // Onestream / moviesda iframe / VidLink / VidEasy / VidZee / VidRock are removed.
    if (requestedProvider === 'auto' && hasValidTmdbId) {
      let stremioSucceeded = false;
      try {
        const stremioResult = await resolveStremioProvider({
          tmdbId,
          type,
          season,
          episode,
          streamId: stremioStreamId,
          mode: 'auto',
        });
        selected = stremioResult;
        sourcesToSave = [];
        stremioSucceeded = true;
        const stremioAttempt = createStremioAttempt(
          stremioResult,
          'available',
          `Auto Priority selected Stremio first. ${stremioResult.count} addon stream(s) found; picked ${stremioResult.label}.`,
        );
        attempts = [
          stremioAttempt,
          ...attempts.map((attempt) => ({
            ...attempt,
            status: 'configured',
            reason: 'Available fallback provider. Stremio direct file stream is currently playing.',
          })),
        ];
      } catch (error) {
        const failedStremioAttempt = createStremioAttempt(
          null,
          'failed',
          `${error.message || 'No Stremio stream for this title.'}`,
        );
        attempts = [failedStremioAttempt, ...attempts];
      }

      // If Stremio had no stream, fall back to Global Mirchi probe
      if (!stremioSucceeded) {
        // v10.6.0 locked priority — when the moviesda data knows this title,
        // mint fresh direct links (walks the hop chain, ~seconds) and play the
        // best MP4 before any embed provider. Best-effort: no match or an
        // empty walk falls through to Mirchi unchanged.
        if (moviesdaMatch) {
          try {
            // AUTO never stalls playback long: a tight budget (default 12s)
            // returns whatever direct MP4s the walk found; empty → Mirchi.
            const fresh = await resolveMoviesdaMovie(moviesdaMatch.pageUrl, {
              budgetMs: Number(process.env.MOVIESDA_AUTO_BUDGET_MS || 12000),
            });
            // Direct MP4 only — ignore any embeds the walker still returns.
            const mp4s = sortByQuality((fresh.mp4s || []).filter((q) => q?.url && !/onestream/i.test(q.url)));
            if (mp4s.length) {
              const pick = mp4s[0];
              const rest = mp4s
                .filter((q) => q !== pick)
                .map((q) => ({ url: q.url, type: 'direct', label: `Direct MP4 • moviesda • ${q.quality}` }));
              // Mirchi stays available as a manual/auto fallback after the MP4 list.
              const mirchi = (resolved.providers || []).find((provider) => provider.id === 'mirchi');
              if (mirchi?.streamUrl) {
                rest.push({ url: mirchi.streamUrl, type: 'embed', label: 'Global Mirchi embed' });
              }
              selected = {
                id: 'vod-mp4',
                provider: 'moviesda',
                label: `Direct MP4 • moviesda • ${pick.quality || 'HD'}`,
                streamUrl: pick.url,
                streamType: 'direct',
                fallbacks: rest.map((entry) => entry.url),
                fallbackTypes: rest.map((entry) => entry.type),
                fallbackLabels: rest.map((entry) => entry.label),
                selectedStreamId: '',
                availableStreams: [],
                health: null,
              };
              attempts = [
                {
                  providerId: selected.id,
                  provider: 'moviesda',
                  label: selected.label,
                  status: 'available',
                  streamUrl: selected.streamUrl,
                  reason: 'Stremio had no stream; Auto Priority resolved a fresh moviesda direct MP4.',
                },
                ...attempts,
              ];
            }
          } catch { /* moviesda tier is best-effort */ }
        }

        let mirchiUsable = false;
        const mirchiAttemptIndex = attempts.findIndex((attempt) => attempt.providerId === 'mirchi');
        if (mirchiAttemptIndex !== -1 && !selected) {
          const probe = await checkEmbedUrl(attempts[mirchiAttemptIndex].streamUrl, 4200);
          const softBlocked = !probe.ok && probe.status === 403;
          mirchiUsable = probe.ok || softBlocked;
          attempts[mirchiAttemptIndex] = {
            ...attempts[mirchiAttemptIndex],
            health: { ok: mirchiUsable, status: probe.status, finalUrl: probe.finalUrl, softBlocked },
            status: mirchiUsable ? 'available' : 'failed',
            reason: probe.ok
              ? 'Stremio had no stream, so Auto Priority fell back to Global Mirchi (embed probe passed).'
              : softBlocked
                ? 'Stremio had no stream; Global Mirchi blocks server checks (403) but usually loads in the browser.'
                : `Global Mirchi also did not respond (probe ${probe.status || probe.error || 'failed'}). Trying remaining embeds next.`,
          };
          if (mirchiUsable) {
            selected = resolved.providers.find((provider) => provider.id === 'mirchi') || selected;
            sourcesToSave = resolved.providers;
          }
        }

        // Third-party embeds (VidLink/VidEasy/…) are intentionally NOT used.
        // If Mirchi also failed and no MP4 was found, selected stays null → 404 below.
      }
    } else if (requestedProvider === 'stremio' && hasValidTmdbId) {
      try {
        const stremioResult = await resolveStremioProvider({
          tmdbId,
          type,
          season,
          episode,
          streamId: stremioStreamId,
          mode: 'manual',
        });
        selected = stremioResult;
        sourcesToSave = [];
        const stremioAttempt = createStremioAttempt(
          stremioResult,
          'available',
          `Selected Stremio manually — picked ${stremioResult.label} from ${stremioResult.count} addon stream(s). Use the Stremio Quality dropdown to switch.`,
        );
        attempts = [
          stremioAttempt,
          ...attempts.map((attempt) => ({
            ...attempt,
            status: 'configured',
            reason: 'Available fallback provider. Stremio is selected manually.',
          })),
        ];
      } catch (error) {
        const failedAttempt = createStremioAttempt(
          null,
          'failed',
          `${error.message || 'No Stremio stream for this title.'}`,
        );
        attempts = [failedAttempt, ...attempts];
        return NextResponse.json(
          { error: error.message || 'No Stremio stream for this title', attempts },
          { status: 404 },
        );
      }
    } else if (requestedProvider === 'iframe' && hasValidTmdbId) {
      return NextResponse.json(
        { error: 'iframe / onestream embeds are disabled on the watch page. Use Stremio, Direct MP4, or Global Mirchi — or open the title from The Vault.', attempts },
        { status: 410 },
      );
    } else if (requestedProvider === 'mp4' && hasValidTmdbId) {
      // Direct MP4 server card — links minted fresh from the stable moviesda pageUrl.
      if (!moviesdaMatch) {
        return NextResponse.json(
          { error: 'This title is not in the moviesda source yet', attempts },
          { status: 404 },
        );
      }
      const fresh = await resolveMoviesdaMovie(moviesdaMatch.pageUrl);
      const mp4s = sortByQuality((fresh.mp4s || []).filter((q) => q?.url && !/onestream/i.test(q.url)));
      if (!mp4s.length) {
        return NextResponse.json(
          { error: 'moviesda walk returned no direct MP4 links for this title', attempts },
          { status: 404 },
        );
      }
      const pick = mp4s[0];
      const rest = [
        ...mp4s.filter((q) => q !== pick).map((q) => ({ url: q.url, type: 'direct', label: `Direct MP4 • moviesda • ${q.quality}` })),
      ];
      const mirchi = (resolved.providers || []).find((provider) => provider.id === 'mirchi');
      if (mirchi?.streamUrl) {
        rest.push({ url: mirchi.streamUrl, type: 'embed', label: 'Global Mirchi embed' });
      }
      selected = {
        id: 'vod-mp4',
        provider: 'moviesda',
        label: `Direct MP4 • moviesda • ${pick.quality || 'HD'}`,
        streamUrl: pick.url,
        streamType: 'direct',
        fallbacks: rest.map((entry) => entry.url),
        fallbackTypes: rest.map((entry) => entry.type),
        fallbackLabels: rest.map((entry) => entry.label),
        selectedStreamId: '',
        availableStreams: [],
        health: null,
      };
      attempts = [
        {
          providerId: selected.id,
          provider: 'moviesda',
          label: selected.label,
          status: 'available',
          streamUrl: selected.streamUrl,
          reason: 'Selected Direct MP4 server manually; links resolved fresh from moviesda.',
        },
        ...attempts,
      ];
    } else if (hasValidTmdbId) {
      // Manual selection — only Global Mirchi remains as an embed provider.
      const blocked = ['vidlink', 'videasy', 'vidzee', 'vidrock', 'vidsrc', 'vidnest', 'screenscape'];
      if (blocked.includes(requestedProvider)) {
        return NextResponse.json(
          { error: `${requestedProvider} embeds are disabled. Use Auto, Stremio, Direct MP4, or Global Mirchi.`, attempts },
          { status: 410 },
        );
      }
      if (requestedProvider === 'mirchi') {
        const mirchiAttemptIndex = attempts.findIndex((attempt) => attempt.providerId === 'mirchi');
        if (mirchiAttemptIndex !== -1) {
          const probe = await checkEmbedUrl(attempts[mirchiAttemptIndex].streamUrl, 4200);
          const softBlocked = !probe.ok && probe.status === 403;
          const mirchiUsable = probe.ok || softBlocked;
          attempts[mirchiAttemptIndex] = {
            ...attempts[mirchiAttemptIndex],
            health: { ok: mirchiUsable, status: probe.status, finalUrl: probe.finalUrl, softBlocked },
            status: mirchiUsable ? 'available' : 'failed',
            reason: probe.ok
              ? 'Selected Global Mirchi manually (embed probe passed).'
              : softBlocked
                ? 'Selected Global Mirchi manually — host blocks server checks (403) but usually loads in the browser.'
                : `Global Mirchi probe returned ${probe.status || probe.error || 'error'}.`,
          };
        }
      }
      const configuredStremioAttempt = createStremioAttempt(
        null,
        'configured',
        'Available fallback provider. Stremio direct file stream can be selected manually.',
      );
      attempts = [configuredStremioAttempt, ...attempts];
    }

    if (!selected?.streamUrl) {
      return NextResponse.json({ error: 'No stream URL returned by selected provider', attempts }, { status: 404 });
    }

    let saveResult = { saved: false, skipped: true };
    // Saving generated embed source metadata is optional. On small/free hosts this
    // MongoDB round-trip can make the watch page feel slow, so keep provider
    // resolution fast by default. Set RESOLVE_SAVE=1 if you want the old behavior.
    if (hasValidTmdbId && process.env.RESOLVE_SAVE === '1') {
      await dbConnect();
      saveResult = await saveEmbedSources({
        tmdbId,
        type,
        sources: sourcesToSave,
      });
    }

    return NextResponse.json(
      {
        streamUrl: selected.streamUrl,
        streamType: selected.streamType,
        provider: selected.provider,
        providerId: selected.id,
        label: selected.label,
        streamFallbacks: selected.fallbacks || [],
        streamFallbackTypes:
          selected.fallbackTypes ||
          (selected.fallbacks || []).map(() => (selected.id === 'stremio' ? 'direct' : 'embed')),
        streamFallbackLabels: selected.fallbackLabels || [],

        selectedStreamId: selected.selectedStreamId || '',
        availableStreams: selected.availableStreams || [],
        health: selected.health || null,
        attempts,
        savedToMongoDB: saveResult.saved,
        savedSources: saveResult.sources || [],
        mode: selected.id === 'stremio' ? 'stremio-direct-provider' : String(selected.id || '').startsWith('vod') ? 'vod-direct-provider' : 'local-embed-provider-module',
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (error) {
    console.error('[api/resolve] Error:', error);
    return NextResponse.json(
      { error: 'Unable to resolve embed provider' },
      { status: 500 }
    );
  }
}
