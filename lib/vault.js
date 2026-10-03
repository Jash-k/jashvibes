/**
 * The Movie Vault — data layer (v10.9.0).
 *
 * Reads the published catalogue of `Jash-k/mv_vault` (the GitHub-Actions-scraped
 * movie archive) and shapes it for the app. The repo is the single source of
 * truth: nothing here ever writes back — the app is a *reader*.
 *
 * Freshness contract: the vault page feels live but the upstream is hit at most
 * once every ~30 minutes. Three layers make that true:
 *   1. module memory cache (30 min TTL) — the Node process re-reads GitHub
 *      at most every 30 min no matter how many browsers ask;
 *   2. raw.githubusercontent's own CDN cache on top;
 *   3. the browser gets `private, max-age=300` so rail + page navigation
 *      within a session doesn't even reach this server.
 *
 * Shape notes (vault.json): quality is a property of each *embed*, not of the
 * movie — a movie carries `embeds: [{quality, url}]`. Normalisation lifts the
 * best quality onto the movie (`1080p` > `720p` > anything else, per the
 * locked vault standard) so cards and filters stay one-field simple.
 *
 * v10.11.0 — filterable provenance. The upstream record has always carried
 * `category` (a site bucket: tamil-movie / tamil-dubbed-movie / tamil-series /
 * tamil-dubbed-series) and `originalLanguage` (35 values), and this file never
 * copied either one — so the page could not offer language or dubbed/original
 * filters even though both fields were already in the payload it fetches. They
 * are now lifted, plus the derived `origin` the rail filters on.
 *
 * v10.9.1 — web series. The vault now also carries series, which arrive as
 * `kind: 'series'` with `season`/`episode` on every embed (one embed per quality
 * per episode) plus a canonical `seasons[]` tree. `kind` is ABSENT on movies, so
 * a missing `kind` means movie and every pre-series record is unaffected.
 * `seasons[]` is deliberately NOT forwarded: grouping is re-derived in the
 * browser from the flat embeds (see lib/vaultEpisodes.js) so the payload does
 * not carry every episode URL twice.
 */

import { groupEpisodes, countSeasons } from './vaultEpisodes.js';

export const VAULT_SOURCE_URL = 'https://raw.githubusercontent.com/Jash-k/mv_vault/main/data/vault.json';

/** How often the server re-reads the upstream catalogue. */
export const VAULT_REVALIDATE_SECONDS = 30 * 60;

const MEMORY_TTL_MS = VAULT_REVALIDATE_SECONDS * 1000;

/** Quality rank — higher wins. The vault standard is 1080p/720p only; anything
 *  else that ever shows up still sorts below them instead of crashing. */
const QUALITY_RANK = { '1080p': 3, '720p': 2 };

function rankQuality(quality) {
  return QUALITY_RANK[String(quality || '').toLowerCase()] || 1;
}

/**
 * Embeds sorted best-first.
 *
 * Movies: 1080p first, then 720p, then anything else (input order preserved
 * inside a quality band — Array.prototype.sort is stable). Unchanged behaviour.
 *
 * Series: episode-major, quality-minor — `S1E1 1080p, S1E1 720p, S1E2 1080p…`
 * — so "next source" walks one episode's qualities before moving on, and the
 * default source (index 0) is always episode 1's best quality.
 */
export function sortEmbeds(embeds = []) {
  const list = (Array.isArray(embeds) ? embeds.slice() : [])
    .filter((embed) => embed && typeof embed.url === 'string' && embed.url);
  const hasEpisodes = list.some((embed) => Number(embed.season) || Number(embed.episode));
  if (!hasEpisodes) {
    return list.sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality));
  }
  return list.sort((a, b) => (
    (Number(a.season) || 0) - (Number(b.season) || 0)
    || (Number(a.episode) || 0) - (Number(b.episode) || 0)
    || rankQuality(b.quality) - rankQuality(a.quality)
  ));
}

/** The one quality label a card shows: the best embed's quality, or `—`. */
export function bestQuality(embeds = []) {
  const sorted = (embeds || []).slice().sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality));
  return sorted.length ? String(sorted[0].quality || 'stream').toLowerCase() : '';
}

/**
 * Tamil is a language here, not a genre: a record whose ORIGINAL language is
 * Tamil is an original, anything else with a language is a dub, and a record
 * the enricher has not reached yet is unknown rather than assumed.
 */
export function originOf(raw = {}) {
  const code = String(raw.originalLanguage || '').trim().toLowerCase();
  if (!code) return 'unknown';
  return code === 'ta' ? 'tamil' : 'dubbed';
}

/** ISO code → the word a person reads. Unknown codes stay as themselves. */
export function languageLabel(code) {
  const key = String(code || '').trim().toLowerCase();
  return LANGUAGE_LABELS[key] || (key ? key.toUpperCase() : 'Unknown');
}

const LANGUAGE_LABELS = {
  ta: 'Tamil', te: 'Telugu', en: 'English', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada',
  ja: 'Japanese', es: 'Spanish', fr: 'French', ru: 'Russian', pa: 'Punjabi', it: 'Italian',
  ko: 'Korean', zh: 'Chinese', de: 'German', bn: 'Bengali', mr: 'Marathi', tr: 'Turkish',
};

function decadeOf(year) {
  const value = Number(year);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.floor(value / 10) * 10}s`;
}

/** A–Z index letter for the jump strip; titles that start with a digit land on `#`. */
function letterOf(title) {
  const first = String(title || '').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

/** Raw vault.json entry → the lean shape the client gets. Drops nothing the
 *  UI uses; adds the computed fields (quality/decade/letter) so the client
 *  never re-derives them. */
export function normalizeVaultMovie(raw = {}) {
  const embeds = sortEmbeds(raw.embeds);
  const year = Number(raw.year) || 0;
  const isSeries = raw.kind === 'series';
  const base = {
    id: String(raw.id || '').trim(),
    title: String(raw.title || '').trim(),
    year,
    poster: typeof raw.poster === 'string' ? raw.poster : '',
    rating: Number(raw.rating) || 0,
    tmdbId: raw.tmdbId || null,
    imdbId: raw.imdbId || '',
    pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : '',
    addedAt: raw.addedAt || '',
    updatedAt: raw.updatedAt || '',
    embeds,
    embedCount: embeds.length,
    quality: bestQuality(embeds),
    decade: decadeOf(year),
    letter: letterOf(raw.title),
    // provenance — the two fields the page could not filter on before
    language: String(raw.originalLanguage || '').trim().toLowerCase(),
    category: String(raw.category || '').trim().toLowerCase(),
    origin: originOf(raw),
  };

  // Series fields are added ONLY to series, so every pre-series movie record
  // normalises to exactly the same object it did before this change (`isSeries`
  // is simply absent → falsy). Keeps the catalogue payload free of dead weight
  // on 2,797 of 2,837 records.
  if (!isSeries) return base;
  const episodes = groupEpisodes(embeds);
  return {
    ...base,
    kind: 'series',
    isSeries: true,
    episodeCount: episodes.length,
    seasonCount: countSeasons(episodes),
  };
}

/** Counts that power the rails: decade bars, quality toggles, poster coverage. */
export function buildVaultFacets(movies = []) {
  const decades = new Map();
  const qualities = { '1080p': 0, '720p': 0, other: 0 };
  const languages = new Map();
  const letters = new Map();
  const days = new Map();
  const origins = { tamil: 0, dubbed: 0, unknown: 0 };
  const sourceBuckets = { 1: 0, 2: 0, '3-4': 0, '5+': 0 };
  const ratingBands = { 5: 0, 6: 0, 7: 0, 8: 0, unrated: 0 };
  // QUALITY_RANK is "the best it has"; this is "does it hold this at all", which
  // is the question a filter asks — one title can hold both 1080p and 720p.
  const qualityHolds = { '1080p': 0, '720p': 0, HD: 0, '360p': 0 };
  let posters = 0;
  let embeds = 0;
  let series = 0;

  for (const movie of movies) {
    if (movie.decade) decades.set(movie.decade, (decades.get(movie.decade) || 0) + 1);
    if (movie.poster) posters += 1;
    if (movie.isSeries) series += 1;
    embeds += movie.embedCount;

    const marks = new Set(movie.embeds.map((embed) => String(embed.quality).toLowerCase()));
    if (marks.has('1080p')) qualities['1080p'] += 1;
    else if (marks.has('720p')) qualities['720p'] += 1;
    else qualities.other += 1;
    for (const key of Object.keys(qualityHolds)) if (marks.has(key.toLowerCase())) qualityHolds[key] += 1;

    if (movie.language) languages.set(movie.language, (languages.get(movie.language) || 0) + 1);
    origins[movie.origin] += 1;
    letters.set(movie.letter, (letters.get(movie.letter) || 0) + 1);
    const added = String(movie.addedAt || '').slice(0, 10);
    if (added) days.set(added, (days.get(added) || 0) + 1);

    const count = movie.embedCount;
    sourceBuckets[count <= 1 ? 1 : count === 2 ? 2 : count <= 4 ? '3-4' : '5+'] += 1;

    const rating = Number(movie.rating) || 0;
    if (rating > 0) for (const band of [5, 6, 7, 8]) { if (rating >= band) ratingBands[band] += 1; }
    else ratingBands.unrated += 1;
  }

  return {
    total: movies.length,
    posters,
    embeds,
    series,
    qualities,
    qualityHolds,
    origins,
    sourceBuckets,
    ratingBands,
    languages: [...languages.entries()]
      .map(([code, count]) => ({ code, label: languageLabel(code), count }))
      .sort((a, b) => b.count - a.count),
    letters: [...letters.entries()].map(([letter, count]) => ({ letter, count })),
    days: [...days.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => b.day.localeCompare(a.day)),
    decades: [...decades.entries()]
      .map(([decade, count]) => ({ decade, count }))
      .sort((a, b) => parseInt(b.decade, 10) - parseInt(a.decade, 10)),
  };
}

const store = (globalThis.__jashVaultCache ||= { at: 0, payload: null, promise: null });

/**
 * Load the catalogue (memory-cached, ~30-min upstream revalidation).
 * Concurrent callers share one upstream fetch via `store.promise`.
 */
export async function loadVault({ force = false } = {}) {
  const now = Date.now();
  if (!force && store.payload && now - store.at < MEMORY_TTL_MS) return store.payload;
  if (!force && store.promise) return store.promise;

  store.promise = (async () => {
    const response = await fetch(VAULT_SOURCE_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`vault upstream ${response.status}`);
    const raw = await response.json();
    const movies = (Array.isArray(raw) ? raw : [])
      .map(normalizeVaultMovie)
      .filter((movie) => movie.id && movie.title);
    const payload = {
      movies,
      facets: buildVaultFacets(movies),
      count: movies.length,
      fetchedAt: new Date().toISOString(),
      source: VAULT_SOURCE_URL,
    };
    store.payload = payload;
    store.at = Date.now();
    return payload;
  })();

  try {
    return await store.promise;
  } finally {
    store.promise = null;
  }
}
