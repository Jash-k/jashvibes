import dbConnect from '@/lib/db';
import { fetchTMDB } from '@/lib/tmdb';
import {
  applyMatchesToItems,
  extractYear,
  makeMatchKey,
  mapMovieDetail,
  mapTvDetail,
  normalizeMatchTitle,
  normalizeMatchType,
  parseMatchQuery,
} from '@/lib/titleMatchCore';

export { applyMatchesToItems };

const COLLECTION_NAME = 'title_matches';

// MongoDB is the durable store. A process-local mirror keeps freshly made
// matches visible even during a DB hiccup (and allows DB-less dev/testing).
const memoryStore = globalThis.__jashTitleMatchStore || new Map();
globalThis.__jashTitleMatchStore = memoryStore;

async function getCollection() {
  try {
    const mongoose = await dbConnect();
    return mongoose.connection.db.collection(COLLECTION_NAME);
  } catch {
    return null;
  }
}

export async function saveTitleMatch(doc) {
  if (memoryStore.size > 2000) {
    const firstKey = memoryStore.keys().next().value;
    if (firstKey) memoryStore.delete(firstKey);
  }
  memoryStore.set(doc.key, doc);
  const collection = await getCollection();
  if (collection) {
    await collection.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
  }
  return doc;
}

function collectWanted(items = []) {
  const wanted = new Map(); // type -> Set(slugs)
  for (const item of items || []) {
    const type = normalizeMatchType(item?.type || item?.group);
    const slug = normalizeMatchTitle(item?.title || '');
    if (!slug) continue;
    if (!wanted.has(type)) wanted.set(type, new Set());
    wanted.get(type).add(slug);
  }
  return wanted;
}

function docIsWanted(doc, wanted) {
  const slug = doc?.titleSlug || normalizeMatchTitle(doc?.sourceTitle || '');
  return Boolean(slug && wanted.get(normalizeMatchType(doc?.type))?.has(slug));
}

/** Fetch all stored matches relevant to the given catalog items. */
export async function findMatchesForItems(items = []) {
  const wanted = collectWanted(items);
  if (!wanted.size) return [];

  const types = [...wanted.keys()];
  const slugs = [...new Set([...wanted.values()].flatMap((set) => [...set]))];
  const docs = [];

  const collection = await getCollection();
  if (collection) {
    try {
      const found = await collection
        .find({ type: { $in: types }, titleSlug: { $in: slugs } })
        .limit(2000)
        .toArray();
      docs.push(...found);
    } catch {}
  }

  // The in-memory mirror may hold matches a cold DB read missed (and is the
  // only store when Mongo is unreachable).
  for (const doc of memoryStore.values()) {
    if (docIsWanted(doc, wanted) && !docs.some((d) => d.key === doc.key)) {
      docs.push(doc);
    }
  }

  return docs;
}

async function enrichIfNeeded(meta) {
  if (!meta?.tmdbId || (meta.posterUrl && meta.synopsis)) return meta;
  try {
    const detail = await fetchTMDB(`/${meta.tmdbType}/${meta.tmdbId}`);
    return meta.tmdbType === 'movie' ? mapMovieDetail(detail) : mapTvDetail(detail);
  } catch {
    return meta;
  }
}

export async function resolveMatchQuery(parsed) {
  if (parsed.kind === 'imdb') {
    const found = await fetchTMDB(`/find/${parsed.id}`, { external_source: 'imdb_id' });
    const movie = (found?.movie_results || [])[0];
    const tv = (found?.tv_results || [])[0];
    if (!movie && !tv) {
      throw new Error(`No TMDB movie or series links to IMDb id ${parsed.id}. Check the id and try again.`);
    }
    return enrichIfNeeded(movie ? mapMovieDetail(movie) : mapTvDetail(tv));
  }

  const fetchDetail = async (mediaType) => {
    const detail = await fetchTMDB(`/${mediaType}/${parsed.id}`);
    return mediaType === 'movie' ? mapMovieDetail(detail) : mapTvDetail(detail);
  };

  if (parsed.mediaType === 'movie' || parsed.mediaType === 'tv') {
    try {
      return await fetchDetail(parsed.mediaType);
    } catch (error) {
      const label = parsed.mediaType === 'tv' ? 'series' : 'movie';
      throw new Error(`TMDB has no ${label} with id ${parsed.id}. (${String(error.message || '').slice(0, 140)})`);
    }
  }

  // Unknown type: try a movie first, then a series.
  try {
    return await fetchDetail('movie');
  } catch {
    return fetchDetail('tv');
  }
}

/**
 * Match one scraped poster to a TMDB/IMDb identity and persist it, so every
 * future catalog load renders this poster with the bound TMDB metadata.
 */
export async function matchAndStore({ type = 'movie', title = '', year = '', query = '' } = {}) {
  const normType = normalizeMatchType(type);
  const slug = normalizeMatchTitle(title);
  if (!slug) throw new Error('This poster has no usable title to match against.');

  const parsed = parseMatchQuery(query, normType);
  if (!parsed) {
    throw new Error(
      'Paste a TMDB or IMDb link, or a plain id. Examples: https://www.themoviedb.org/movie/1132687 • https://www.imdb.com/title/tt0133093 • 1132687 • tt0133093',
    );
  }

  const meta = await resolveMatchQuery(parsed);
  if (!meta?.tmdbId) throw new Error('TMDB returned no usable id for that input.');

  const scrapedYear = extractYear(year);
  const doc = {
    key: makeMatchKey({ type: normType, title, year: scrapedYear }),
    type: normType,
    titleSlug: slug,
    scrapedYear,
    sourceTitle: String(title || '').slice(0, 160),
    query: String(query || '').slice(0, 300),
    ...meta,
    matchedBy: 'manual',
    matchedAt: new Date(),
  };

  await saveTitleMatch(doc);
  return doc;
}
