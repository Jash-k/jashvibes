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
import VodItem from '@/models/VodItem';
import { orderBySourcePriority, sourceRank } from '@/lib/player/sourcePriority';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'series' : 'movie';
}

function uniqueList(items) {
  return [...new Set((items || []).filter(Boolean))];
}

// ---- v10.5.1 locked source tiers from the ReTro VOD catalog ----
// Stremio -> direct MP4 -> onestream iframe -> Mirchi -> rest. These helpers
// load tiers 2 and 3 so the watch page can offer them as next sources no
// matter whether Stremio succeeded.
async function loadVodTiers(tmdbId) {
  try {
    const vodItem = await VodItem.findOne({
      tmdbId: Number(tmdbId),
      type: 'movie',
      'streams.0': { $exists: true },
    }).lean();
    const ranked = orderBySourcePriority(vodItem?.streams || []);
    return {
      directs: ranked.filter((stream) => sourceRank(stream) === 1),
      embeds: ranked.filter((stream) => sourceRank(stream) === 2),
    };
  } catch {
    return { directs: [], embeds: [] };
  }
}

function vodTierEntries(tiers) {
  return [
    ...tiers.directs.map((s) => ({
      url: s.url,
      type: 'direct',
      label: ['Direct MP4', s.source, s.quality].filter(Boolean).join(' • '),
    })),
    ...tiers.embeds.map((s) => ({
      url: s.url,
      type: 'embed',
      label: ['iframe', s.source, s.quality].filter(Boolean).join(' • '),
    })),
  ];
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

    // Auto chain: Stremio direct-file streams FIRST for all titles (including PreDVD/theatrical
    // and digital releases). If Stremio addon has no stream or is unreachable, Auto Priority
    // cascades to Global Mirchi embed next, then the remaining third-party embeds (VidLink, Videasy, etc.).
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

      // v10.5.1: even when Stremio plays, expose the locked tiers below it —
      // direct MP4, then onestream iframe, then the embed providers — as
      // labelled next sources in the player's source list.
      if (stremioSucceeded) {
        const tiers = await loadVodTiers(tmdbId);
        const stremioFbCount = (selected.fallbacks || []).length;
        const extras = [
          ...vodTierEntries(tiers),
          ...(resolved.providers || []).map((provider) => ({
            url: provider.streamUrl,
            type: 'embed',
            label: `${provider.provider || provider.id} embed`,
          })),
        ];
        const used = new Set([selected.streamUrl, ...(selected.fallbacks || [])]);
        const clean = extras.filter((entry) => entry.url && !used.has(entry.url) && (used.add(entry.url), true));
        if (clean.length) {
          selected.fallbacks = [...(selected.fallbacks || []), ...clean.map((entry) => entry.url)];
          selected.fallbackTypes = [...Array(stremioFbCount).fill('direct'), ...clean.map((entry) => entry.type)];
          selected.fallbackLabels = [...Array(stremioFbCount).fill(''), ...clean.map((entry) => entry.label)];
        }
      }

      // If Stremio had no stream, fall back to Global Mirchi probe
      if (!stremioSucceeded) {
        // v10.5.0 locked priority — tier 2 (direct MP4) then tier 3 (onestream
        // iframe), pulled straight from the ReTro VOD catalog, before the
        // embed providers (Mirchi etc.). Best-effort: a dead Mongo or an
        // unmatched tmdbId just skips the tier.
        let vodPick = null;
        try {
          const tiers = await loadVodTiers(tmdbId);
          const direct = tiers.directs[0] || null;
          const embed = tiers.embeds[0] || null;
          if (direct || embed) {
            const picked = direct || embed;
            const rest = vodTierEntries(tiers).filter((entry) => entry.url !== picked.url);
            const providerEntries = (resolved.providers || []).map((provider) => ({
              url: provider.streamUrl,
              type: 'embed',
              label: `${provider.provider || provider.id} embed`,
            }));
            const seen = new Set([picked.url]);
            const clean = [...rest, ...providerEntries].filter(
              (entry) => entry.url && !seen.has(entry.url) && (seen.add(entry.url), true),
            );
            vodPick = {
              pick: picked,
              isEmbed: !direct,
              fallbacks: clean.map((entry) => entry.url),
              fallbackTypes: clean.map((entry) => entry.type),
              fallbackLabels: clean.map((entry) => entry.label),
            };
          }
        } catch { /* VOD tier is optional */ }

        if (vodPick) {
          const picked = vodPick.pick;
          selected = {
            id: vodPick.isEmbed ? 'vod-embed' : 'vod-mp4',
            provider: picked.source || 'VOD',
            label: [vodPick.isEmbed ? 'iframe' : 'Direct MP4', picked.source, picked.quality].filter(Boolean).join(' • '),
            streamUrl: picked.url,
            streamType: vodPick.isEmbed ? 'embed' : 'direct',
            fallbacks: vodPick.fallbacks,
            fallbackTypes: vodPick.fallbackTypes,
            fallbackLabels: vodPick.fallbackLabels,
            selectedStreamId: '',
            availableStreams: [],
            health: null,
          };
          attempts = [
            {
              providerId: selected.id,
              provider: selected.provider,
              label: selected.label,
              status: 'available',
              streamUrl: selected.streamUrl,
              reason: vodPick.isEmbed
                ? 'Stremio had no stream and no direct MP4; Auto Priority picked the VOD onestream-iframe tier.'
                : 'Stremio had no stream; Auto Priority picked the VOD direct-MP4 tier.',
            },
            ...attempts,
          ];
        }

        let mirchiUsable = false;
        const mirchiAttemptIndex = attempts.findIndex((attempt) => attempt.providerId === 'mirchi');
        if (mirchiAttemptIndex !== -1 && !vodPick) {
          const probe = await checkEmbedUrl(attempts[mirchiAttemptIndex].streamUrl, 4200);
          const softBlocked = !probe.ok && probe.status === 403;
          mirchiUsable = probe.ok || softBlocked;
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
          }
        }

        // If Global Mirchi also failed, fall back to the first available third-party embed
        if (!mirchiUsable && !vodPick) {
          const fallback = resolved.providers.find((provider) => provider.id !== 'mirchi');
          if (fallback) {
            selected = fallback;
            sourcesToSave = resolved.providers;
            const fallbackIndex = attempts.findIndex((attempt) => attempt.providerId === fallback.id);
            if (fallbackIndex !== -1) {
              attempts[fallbackIndex] = {
                ...attempts[fallbackIndex],
                status: 'available',
                reason: `Stremio and Global Mirchi were unavailable; Auto Priority fell back to ${fallback.provider}.`,
              };
            }
          }
        }
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
    } else if (hasValidTmdbId) {
      // Manual selection of embed provider (mirchi, vidlink, videasy, etc.)
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
