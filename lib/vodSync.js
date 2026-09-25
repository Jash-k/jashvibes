import dbConnect from '@/lib/db';
import VodItem, { ensureVodTextIndexSafe } from '@/models/VodItem';
import { fetchVodEntriesFromSources, matchMovieToTMDB, runLimitedConcurrency } from '@/lib/vodM3u';
import { getActiveVodSources } from '@/lib/vodSources';

/**
 * The ReTro sync engine, out of the HTTP layer.
 *
 * A full sync (fetch every M3U source, TMDB-match every title at concurrency
 * 3) legitimately runs for many minutes — far past any sane request timeout.
 * The admin panel therefore starts it in the BACKGROUND and polls
 * `getVodSyncStatus()`; the /api/vod/sync route still offers the awaited form
 * for token callers.
 *
 * Single-flight: a second start while one is running returns the live status
 * instead of stacking a second sync on a 512 MB box.
 */
const state = (globalThis.__jashVodSync ||= {
  running: false,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: '',
});

export function getVodSyncStatus() {
  return {
    running: state.running,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    elapsedMs: state.startedAt ? Date.now() - state.startedAt : null,
    result: state.result,
    error: state.error,
  };
}

function mergeByKey(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const existing = map.get(entry.key);
    if (!existing) {
      map.set(entry.key, { ...entry, streams: [entry.stream] });
      continue;
    }
    existing.streams.push(entry.stream);
    if (!existing.year && entry.year) existing.year = entry.year;
  }

  return [...map.values()].map((item) => {
    const seen = new Set();
    item.streams = item.streams.filter((stream) => {
      if (!stream?.url || seen.has(stream.url)) return false;
      seen.add(stream.url);
      return true;
    });
    return item;
  });
}

export async function runVodSync() {
  const syncBatch = new Date().toISOString();
  const sources = await getActiveVodSources();
  const { entries, errors } = await fetchVodEntriesFromSources({ sources });
  const grouped = mergeByKey(entries);
  const syncLimit = Number(process.env.VOD_LIMIT || process.env.CLASSICS_LIMIT || 0);
  const workItems = syncLimit > 0 ? grouped.slice(0, syncLimit) : grouped;

  let matched = 0;
  let unmatched = 0;
  let stored = 0;

  await dbConnect();
  await ensureVodTextIndexSafe();

  await runLimitedConcurrency(workItems, Number(process.env.VOD_CONCURRENCY || 3), async (item) => {
    let tmdb = null;
    try {
      tmdb = await matchMovieToTMDB({ title: item.title, year: item.year });
    } catch (error) {
      console.warn('[vod/sync] TMDB match failed:', item.title, error.message);
    }

    if (tmdb?.tmdbId) matched += 1;
    else unmatched += 1;

    const key = tmdb?.tmdbId ? `tmdb:movie:${tmdb.tmdbId}` : item.key;
    const streams = item.streams || [];
    const sourcesList = [...new Set(streams.map((stream) => stream.source).filter(Boolean))];

    const setPayload = {
      key,
      title: tmdb?.title || item.title,
      normalizedTitle: item.normalizedTitle,
      type: 'movie',
      year: tmdb?.year || item.year || undefined,
      releaseDate: tmdb?.releaseDate || (item.year ? new Date(`${item.year}-01-01`) : undefined),
      tmdbId: tmdb?.tmdbId || undefined,
      tmdbMatched: Boolean(tmdb?.tmdbId),
      originalTitle: tmdb?.originalTitle || '',
      synopsis: tmdb?.synopsis || '',
      posterUrl: tmdb?.posterUrl || streams.find((stream) => stream.logo)?.logo || '',
      backdropUrl: tmdb?.backdropUrl || '',
      rating: tmdb?.rating || 0,
      voteCount: tmdb?.voteCount || 0,
      language: tmdb?.language || '',
      genres: tmdb?.genres || [],
      syncBatch,
      lastSyncedAt: new Date(),
    };

    await VodItem.updateOne(
      { key },
      { $set: { ...setPayload, sources: sourcesList, streams } },
      { upsert: true },
    );
    stored += 1;
  });

  const ok = stored > 0;
  return {
    ok,
    syncBatch,
    sourceCount: sources.length,
    sources: sources.map((source) => ({ label: source.label, url: source.url })),
    parsedEntries: entries.length,
    groupedTitles: grouped.length,
    processed: workItems.length,
    stored,
    matched,
    unmatched,
    errors,
    message: ok
      ? `Synced ${stored} classics (${matched} matched to TMDB).`
      : 'No classics were synced. Your VOD source URLs returned no playable M3U entries.',
  };
}

/** Start the sync in the background; returns immediately with live status. */
export function startVodSyncInBackground() {
  if (state.running) return { started: false, ...getVodSyncStatus() };
  state.running = true;
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.result = null;
  state.error = '';
  (async () => {
    try {
      state.result = await runVodSync();
    } catch (error) {
      state.error = error?.message || 'Sync failed';
    } finally {
      state.running = false;
      state.finishedAt = Date.now();
    }
  })();
  return { started: true, ...getVodSyncStatus() };
}
