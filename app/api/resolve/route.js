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
import { STREMIO_FIRST_TIERS } from '@/lib/quality';

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
        provider,
      });

      selected = await chooseHealthyVidSrcMirror(resolved.selected);
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

    // Auto chain: Global Mirchi first, then Stremio direct-file streams, then
    // the remaining embed providers. Stremio is also a manual server.
    // Quality-aware routing (from scraped release title): theatrical releases
    // (CAMRip/PreDVD/HDTC) live only on Mirchi → Mirchi first. Clean digital
    // releases (UHD/BluRay/WEB-DL/HD) are best on Stremio → Stremio first.
    const stremioFirst = requestedProvider === 'auto' && STREMIO_FIRST_TIERS.includes(quality);
    let runStremio = requestedProvider === 'stremio' || stremioFirst;
    let mirchiProbeFailed = false;

    // Auto Priority cascade: Global Mirchi first (live embed probe; a 403 is
    // treated as WAF noise because the embed iframe loads in the user's
    // browser — only hard failures like DNS/timeout, 404, 5xx or non-HTML skip
    // Mirchi), then the remaining embed providers in priority order.
    if (requestedProvider === 'auto' && hasValidTmdbId && !stremioFirst) {
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
            ? 'Auto Priority selected Global Mirchi first (embed probe passed).'
            : softBlocked
              ? 'Global Mirchi selected first — this host blocks server-side checks (403) but the player still loads in your browser. If it does not play, switch servers below.'
              : `Global Mirchi did not respond (probe ${probe.status || probe.error || 'failed'}). Auto Priority tries Stremio next.`,
        };
        if (mirchiUsable) {
          selected = resolved.providers.find((provider) => provider.id === 'mirchi') || selected;
          sourcesToSave = resolved.providers;
        } else {
          // Hard failure: Stremio is next in Auto; embeds follow after it.
          mirchiProbeFailed = true;
          runStremio = true;
        }
      }
    }

    // Stremio direct-file streams: second in Auto (only when Mirchi hard-fails)
    // and selectable manually. Direct HTTPS files stream in the internal
    // <video> player with range/seek support.
    if ((requestedProvider === 'stremio' || runStremio) && hasValidTmdbId) {
      try {
        const stremioResult = await resolveStremioProvider({
          tmdbId,
          type,
          season,
          episode,
          streamId: stremioStreamId,
          mode: requestedProvider === 'stremio' ? 'manual' : 'auto',
        });
        selected = stremioResult;
        sourcesToSave = [];
        const stremioAttempt = createStremioAttempt(
          stremioResult,
          'available',
          requestedProvider === 'auto'
            ? (stremioFirst
              ? `Release quality (${quality.toUpperCase()}) prefers Stremio — Auto Priority selected it first. ${stremioResult.count} addon stream(s) found; picked ${stremioResult.label}.`
              : `Global Mirchi was unreachable, so Auto Priority selected Stremio next. ${stremioResult.count} addon stream(s) found; picked ${stremioResult.label}.`)
            : `Selected Stremio manually — picked ${stremioResult.label} from ${stremioResult.count} addon stream(s). Use the Stremio Quality dropdown to switch.`,
        );
        if (requestedProvider === 'stremio') {
          attempts = [
            stremioAttempt,
            ...attempts.map((attempt) => ({
              ...attempt,
              status: 'configured',
              reason: 'Available fallback provider. Stremio is selected manually.',
            })),
          ];
        } else {
          const insertAt = attempts.findIndex((attempt) => attempt.providerId === 'mirchi');
          attempts.splice(insertAt === -1 ? 0 : insertAt + 1, 0, stremioAttempt);
        }
      } catch (error) {
        const failedAttempt = createStremioAttempt(
          null,
          'failed',
          `${error.message || 'No Stremio stream for this title.'}`,
        );
        const insertAt = attempts.findIndex((attempt) => attempt.providerId === 'mirchi');
        attempts.splice(insertAt === -1 ? 0 : insertAt + 1, 0, failedAttempt);
        if (requestedProvider === 'stremio') {
          return NextResponse.json(
            { error: error.message || 'No Stremio stream for this title', attempts },
            { status: 404 },
          );
        }
      }
    }

    // Stremio-first (HD/UHD/BluRay/WEB-DL) had no stream: fall back to the
    // Global Mirchi probe, exactly like the default auto order.
    if (requestedProvider === 'auto' && stremioFirst && selected?.id !== 'stremio' && hasValidTmdbId) {
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
            ? 'Stremio had no stream for this title, so Auto Priority fell back to Global Mirchi (embed probe passed).'
            : softBlocked
              ? 'Stremio had no stream; Global Mirchi blocks server checks (403) but usually loads in the browser.'
              : `Global Mirchi also did not respond (probe ${probe.status || probe.error || 'failed'}). Trying remaining embeds next.`,
        };
        if (mirchiUsable) {
          selected = resolved.providers.find((provider) => provider.id === 'mirchi') || selected;
          sourcesToSave = resolved.providers;
        } else {
          mirchiProbeFailed = true;
        }
      }
    }

    // Auto with Mirchi down and no Stremio stream: first remaining embed.
    if (requestedProvider === 'auto' && mirchiProbeFailed && selected?.id !== 'stremio') {
      const fallback = resolved.providers.find((provider) => provider.id !== 'mirchi');
      if (fallback) {
        selected = fallback;
        sourcesToSave = resolved.providers;
      }
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
        selectedStreamId: selected.selectedStreamId || '',
        availableStreams: selected.availableStreams || [],
        health: selected.health || null,
        attempts,
        savedToMongoDB: saveResult.saved,
        savedSources: saveResult.sources || [],
        mode: selected.id === 'stremio' ? 'stremio-direct-provider' : 'local-embed-provider-module',
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
