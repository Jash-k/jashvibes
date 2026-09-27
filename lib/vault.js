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
 */

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

/** Embeds sorted best-first: 1080p embeds keep their original order, then 720p, then the rest. */
export function sortEmbeds(embeds = []) {
  return (Array.isArray(embeds) ? embeds.slice() : [])
    .filter((embed) => embed && typeof embed.url === 'string' && embed.url)
    .sort((a, b) => rankQuality(b.quality) - rankQuality(a.quality));
}

/** The one quality label a card shows: the best embed's quality, or `—`. */
export function bestQuality(embeds = []) {
  const sorted = sortEmbeds(embeds);
  return sorted.length ? String(sorted[0].quality || 'stream').toLowerCase() : '';
}

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
  return {
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
  };
}

/** Counts that power the rails: decade bars, quality toggles, poster coverage. */
export function buildVaultFacets(movies = []) {
  const decades = new Map();
  const qualities = { '1080p': 0, '720p': 0, other: 0 };
  let posters = 0;
  let embeds = 0;

  for (const movie of movies) {
    if (movie.decade) decades.set(movie.decade, (decades.get(movie.decade) || 0) + 1);
    if (movie.poster) posters += 1;
    embeds += movie.embedCount;
    if (movie.embeds.some((embed) => String(embed.quality).toLowerCase() === '1080p')) qualities['1080p'] += 1;
    else if (movie.embeds.some((embed) => String(embed.quality).toLowerCase() === '720p')) qualities['720p'] += 1;
    else qualities.other += 1;
  }

  return {
    total: movies.length,
    posters,
    embeds,
    qualities,
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
