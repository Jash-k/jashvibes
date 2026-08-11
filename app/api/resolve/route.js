import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import Media from '@/models/Media';
import { fetchTMDB } from '@/lib/tmdb';
import {
  buildStoredSource,
  resolveEmbedProvider,
} from '@/lib/providers/embedProviders';
import {
  createTamilOttAttempt,
  resolveTamilOttProvider,
} from '@/lib/providers/tamilOttProvider';

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

async function checkEmbedUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);

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
    const requestedProvider = String(provider || 'auto').toLowerCase();
    const ottStreamId = searchParams.get('ottStreamId') || searchParams.get('streamId') || '';
    const title = String(searchParams.get('title') || '').trim();
    const year = String(searchParams.get('year') || '').trim();
    const isTamilOttTitleOnly = !hasValidTmdbId && requestedProvider === 'tamilott' && title;

    if (!hasValidTmdbId && !isTamilOttTitleOnly) {
      return NextResponse.json(
        { error: 'A valid tmdbId is required unless provider=tamilott&title=TITLE is supplied' },
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

    if (requestedProvider === 'tamilott' || (requestedProvider === 'auto' && hasValidTmdbId)) {
      try {
        const tamilOttResult = await resolveTamilOttProvider({
          tmdbId,
          type,
          title,
          year,
          season,
          episode,
          streamId: ottStreamId,
          quick: requestedProvider === 'auto',
        });
        selected = tamilOttResult;
        sourcesToSave = hasValidTmdbId ? [tamilOttResult, ...resolved.providers] : [tamilOttResult];
        attempts = [
          createTamilOttAttempt(
            tamilOttResult,
            'available',
            requestedProvider === 'auto'
              ? `Auto Priority selected TamilOTT first. Matched: ${tamilOttResult.match?.streamTitle || tamilOttResult.match?.title || tamilOttResult.label}`
              : `Matched authorized JSON item: ${tamilOttResult.match?.streamTitle || tamilOttResult.match?.title || tamilOttResult.label}`,
          ),
          ...(hasValidTmdbId
            ? resolved.attempts.map((attempt) => ({
                ...attempt,
                status: 'configured',
                reason: requestedProvider === 'auto'
                  ? 'Available fallback provider. Auto Priority selected TamilOTT first; switch manually if needed.'
                  : 'Available fallback provider. TamilOTT JSON is selected manually.',
              }))
            : []),
        ];
      } catch (error) {
        if (requestedProvider === 'tamilott') {
          return NextResponse.json(
            {
              error: error.message || 'TamilOTT JSON source did not return a playable match',
              attempts: [
                createTamilOttAttempt(null, 'failed', error.message || 'TamilOTT JSON match failed'),
                ...(hasValidTmdbId ? resolved.attempts : []),
              ],
              mode: 'tamilott-json-provider',
            },
            { status: 404 },
          );
        }

        attempts = [
          createTamilOttAttempt(
            null,
            'failed',
            `${error.message || 'TamilOTT JSON match failed'} Auto Priority is falling back to the next provider.`,
          ),
          ...attempts,
        ];
      }
    } else if (hasValidTmdbId) {
      attempts = [
        createTamilOttAttempt(
          null,
          'configured',
          'Authorized JSON stream feed. Auto Priority tries this first; select it manually to force TamilOTT JSON.',
        ),
        ...attempts,
      ];
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
        match: selected.match || null,
        health: selected.health || null,
        attempts,
        savedToMongoDB: saveResult.saved,
        savedSources: saveResult.sources || [],
        titleOnly: isTamilOttTitleOnly,
        mode: selected.id === 'tamilott' ? 'tamilott-json-provider' : 'local-embed-provider-module',
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
