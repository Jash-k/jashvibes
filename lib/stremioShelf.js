/**
 * stremioShelf — the pure logic behind /stremio as the Catalog Shelf.
 *
 * The picked mock (`docs/concepts/stremio-redesign.html`, idea 1) is one tab ruler of catalogs across the
 * top of the page and a grid of posters for whichever tab you are in. Nothing else. That shape is only
 * honest if three rules hold, and every rule below exists to keep one of them:
 *
 *   1. **A tab shows what is on this device, not what exists.** `/api/stremio/catalog` answers
 *      `{ items, count, hasMore }` and never a total, so a tab can truthfully say `25 · more` and can
 *      never say `of 480`. `buildRuler` only ever reads loaded item counts from shelf state.
 *   2. **A filter is offered only when the catalog declares it.** The manifest's `extraSupported` is a
 *      fact about the addon; the old page sent `search`/`language`/`sort`/`genre` to every catalog and a
 *      catalog that ignores one silently returned the unfiltered list. `buildShelfQuery` drops what is not
 *      declared and reports it, so the UI can say so out loud instead of lying quietly.
 *   3. **One catalog, one request.** Switching or filtering fetches page 1 of *that* catalog; `load more`
 *      appends one page at `skip = items.length`. No fan-out over pinned catalogs, no polling, nothing per
 *      render — a 512 MB free tier must not pay for browsing.
 *
 * Filters are stored per catalog (`{ [catalogKey]: filters }`) because "Latest Added" on one catalog and
 * "Highest Rated" on another are two different questions, and a shared filter object is how a page ends up
 * showing a list that does not match the chips above it.
 */

/** Kept as-is so an existing shelf survives the redesign. Array of `type:id` keys. */
export const SELECTED_KEY = 'jash:stremio:selectedCatalogs:v2';
/** New: the last focused catalog and its per-catalog filters. Local only — Mongo is for the library. */
export const SHELF_KEY = 'jash:stremio:shelf:v1';

/** The extras the page can send, with the names addons actually use for them. */
export const EXTRA_ALIASES = {
  search: ['search', 'query'],
  sort: ['sort', 'order'],
  language: ['language', 'lang'],
  genre: ['genre', 'genres'],
};

/**
 * The four values a Stremio catalog is asked for, with the option lists the old `<select>`s carried. They
 * live here so the tests can pin them; the page never hardcodes a list.
 */
export const FILTER_FIELDS = [
  {
    id: 'sort',
    label: 'Sort',
    none: '',
    options: [
      { value: 'Latest Added', label: 'Latest Added' },
      { value: 'Year: Newest', label: 'Year ↓' },
      { value: 'Year: Oldest', label: 'Year ↑' },
      { value: 'Highest Rated', label: 'IMDb' },
      { value: 'Title: A-Z', label: 'A–Z' },
    ],
  },
  {
    id: 'language',
    label: 'Lang',
    none: 'any',
    options: [
      { value: 'Tamil', label: 'Tamil' },
      { value: 'Telugu', label: 'Telugu' },
      { value: 'Hindi', label: 'Hindi' },
      { value: 'Malayalam', label: 'Malayalam' },
      { value: 'Kannada', label: 'Kannada' },
      { value: 'English', label: 'English' },
      { value: 'Multi', label: 'Multi' },
    ],
  },
  {
    id: 'genre',
    label: 'Genre',
    none: 'any',
    options: ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama', 'Family', 'Fantasy', 'Horror', 'Romance', 'Sci-Fi', 'Sport', 'Thriller']
      .map((value) => ({ value, label: value })),
  },
];

/** The catalog page size is whatever the addon returns; this only caps how many pages `load more` walks. */
export const SHELF_MAX_PAGES = 40;

export function catalogKey(catalog = {}) {
  return `${catalog.type || 'movie'}:${catalog.id || ''}`;
}

export function catalogLabel(catalog = {}) {
  return String(catalog.name || catalog.id || 'Catalog');
}

export function rowKey(item = {}) {
  return `${item.type || 'movie'}:${item.id || item.tmdbId || item.imdbId || ''}`;
}

/** Manifest catalogs are `{ id, type, name, extraSupported }`; older addons spell it `extra: [{name}]`. */
export function normalizeCatalog(catalog = {}) {
  const extraSupported = Array.isArray(catalog.extraSupported) && catalog.extraSupported.length
    ? catalog.extraSupported
    : (catalog.extra || []).map((entry) => entry?.name).filter(Boolean);
  return {
    id: String(catalog.id || ''),
    type: catalog.type === 'series' ? 'series' : 'movie',
    name: String(catalog.name || catalog.id || 'Catalog'),
    extraSupported: extraSupported.map((name) => String(name || '').toLowerCase()).filter(Boolean),
  };
}

/** Every catalog in the manifest, de-duplicated by `type:id`, movies and series only (the API's two types). */
export function readCatalogOptions(catalogs = []) {
  const seen = new Set();
  const options = [];
  for (const entry of Array.isArray(catalogs) ? catalogs : []) {
    if (entry?.type !== 'movie' && entry?.type !== 'series') continue;
    const catalog = normalizeCatalog(entry);
    if (!catalog.id) continue;
    const key = catalogKey(catalog);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(catalog);
  }
  return options;
}

/**
 * Does this catalog accept `name` (one of the FILTER_FIELDS ids, or `search`)?
 *
 * A manifest with no `extraSupported` at all is treated as "unknown", not as "nothing": addons like Cinemeta
 * omit the field on some catalogs and still honour `skip`. `unknown` is returned as a flag so the page can
 * keep offering the chip instead of removing a working control on a guess — the reverse mistake.
 */
export function supportsExtra(catalog = {}, name = '') {
  const declared = Array.isArray(catalog.extraSupported) ? catalog.extraSupported.filter(Boolean) : [];
  const aliases = EXTRA_ALIASES[name] || [name];
  const hit = declared.some((entry) => aliases.includes(String(entry).toLowerCase()));
  return { supported: hit, declared: declared.length > 0 };
}

export function defaultFilters() {
  return { sort: 'Latest Added', language: '', genre: '', search: '' };
}

export function safeFilters(filters = {}) {
  const base = defaultFilters();
  return {
    sort: typeof filters.sort === 'string' ? filters.sort : base.sort,
    language: typeof filters.language === 'string' ? filters.language : base.language,
    genre: typeof filters.genre === 'string' ? filters.genre : base.genre,
    search: typeof filters.search === 'string' ? filters.search : base.search,
  };
}

/** How many of the four values are actually pulling the list away from its default. */
export function activeFilterCount(filters = {}) {
  const safe = safeFilters(filters);
  let count = 0;
  if (safe.language) count += 1;
  if (safe.genre) count += 1;
  if (safe.search) count += 1;
  if (safe.sort && safe.sort !== defaultFilters().sort) count += 1;
  return count;
}

/**
 * The query for one page of one catalog, plus the list of active filters this catalog cannot honour.
 *
 * `ignored` is what makes the shelf honest: the value stays in state (so switching back to a catalog that
 * does support it keeps working) while the UI prints `genre ignored here` next to the chips.
 */
export function buildShelfQuery({ catalog, skip = 0, filters = {} } = {}) {
  const safe = safeFilters(filters);
  const params = new URLSearchParams({
    source: 'catalog',
    type: catalog?.type === 'series' ? 'series' : 'movie',
    catalog: String(catalog?.id || ''),
    skip: String(Math.max(0, Number(skip) || 0)),
  });
  const ignored = [];
  const send = (name, value) => {
    if (!value) return;
    const { supported } = supportsExtra(catalog, name);
    if (!supported) {
      ignored.push(name);
      return;
    }
    params.set(name, value);
  };
  send('sort', safe.sort === defaultFilters().sort ? '' : safe.sort);
  send('language', safe.language);
  send('genre', safe.genre);
  send('search', safe.search);
  // A catalog that cannot sort still receives nothing for it, which is the truth: the "Latest Added"
  // default is the addon's own order, so claiming we sorted it would be a lie in the URL.
  return { query: params.toString(), ignored: [...new Set(ignored)] };
}

/**
 * The ruler: one tab per pinned catalog, labelled with the catalog's own name, counted by what is loaded
 * on this device and flagged `· more` while the addon keeps answering `hasMore`.
 */
export function buildRuler({ pinned = [], shelf = {} } = {}) {
  return (Array.isArray(pinned) ? pinned : []).map((catalog) => {
    const key = catalogKey(catalog);
    const entry = shelf[key] || {};
    const count = Array.isArray(entry.items) ? entry.items.length : 0;
    return {
      key,
      id: catalog.id,
      type: catalog.type,
      label: catalogLabel(catalog),
      count,
      more: Boolean(entry.hasMore),
      fetched: Boolean(entry.fetched),
      loading: Boolean(entry.loading),
      error: entry.error || '',
    };
  });
}

/**
 * What the caption under the grid may claim. Only three states are ever true here, and each is computed
 * from the page's own paging state — never from an assumed total.
 */
export function shelfLine({ tab, loading = false, ignored = [] } = {}) {
  const parts = [];
  if (!tab) return { tone: 'muted', text: 'no catalog pinned', resumable: false };
  const { count, more, fetched, error } = tab;
  if (error) return { tone: 'error', text: error, resumable: true };
  if (!fetched) parts.push('not read yet');
  else if (count) parts.push(`${count} loaded${more ? ' · more' : ' · end of catalog'}`);
  else parts.push('nothing back from this catalog');
  if (loading && fetched) parts.push('reading…');
  if (ignored.length) parts.push(`${ignored.join(' + ')} ignored here`);
  return {
    tone: error ? 'error' : count ? 'ok' : 'muted',
    text: parts.join(' · '),
    resumable: Boolean(more),
  };
}

/** Append a page without duplicating an id the addon repeats across `skip` boundaries. */
export function mergeItems(previous = [], next = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...(previous || []), ...(next || [])]) {
    const key = rowKey(item);
    if (!key || key.endsWith(':')) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/**
 * The first two tabs when nothing is pinned yet: the addon's Tamil movie catalog, then its Tamil series
 * catalog, falling back to whatever the manifest leads with. Same intent as the old `getDefaultCatalogs`.
 */
export function getDefaultPins(options = [], tamilCatalogs = {}) {
  const list = Array.isArray(options) ? options : [];
  const pick = (type) => list.find((item) => item.type === type && item.id === tamilCatalogs[type])
    || list.find((item) => item.type === type && /tamil/i.test(item.name))
    || list.find((item) => item.type === type);
  const movie = pick('movie');
  const series = pick('series');
  return [movie, series].filter(Boolean).filter((catalog, index, all) => all.findIndex((c) => catalogKey(c) === catalogKey(catalog)) === index);
}

/**
 * One page of one catalog, assembled and folded into shelf state.
 *
 * This exists so the page and the tests run the same code path: the query is built here (never inline in a
 * component), the answer is reduced here, and the caller only decides `append` and where to put the result.
 * `ignored` travels back with it so the UI can print what the catalog refused.
 */
export async function fetchCatalogPage({ fetchPage, catalog, filters = {}, append = false, current = null } = {}) {
  if (!catalog?.id) throw new Error('No catalog selected.');
  const skip = append ? (Array.isArray(current?.items) ? current.items.length : 0) : 0;
  const { query, ignored } = buildShelfQuery({ catalog, skip, filters });
  const data = await fetchPage(query);
  const entry = reduceShelfPage(current, data || {}, { append });
  return { entry, ignored, query, skipped: skip, capped: entry.pages >= SHELF_MAX_PAGES && entry.hasMore };
}

export function emptyShelfEntry() {
  return { items: [], skip: 0, hasMore: false, loading: false, error: '', catalogName: '', fetched: false, pages: 0 };
}

/** Fold one API page into the shelf state for a catalog. Pure so the paging contract is testable. */
export function reduceShelfPage(current = {}, data = {}, { append = false } = {}) {
  const base = { ...emptyShelfEntry(), ...(current || {}) };
  const incoming = Array.isArray(data.items) ? data.items : [];
  const items = append ? mergeItems(base.items, incoming) : mergeItems([], incoming);
  const count = Number(data.count ?? incoming.length) || 0;
  return {
    ...base,
    items,
    skip: (append ? base.skip : 0) + count,
    pages: (append ? base.pages : 0) + 1,
    hasMore: Boolean(data.hasMore),
    loading: false,
    error: '',
    fetched: true,
    catalogName: data.catalogName || base.catalogName || '',
  };
}

export function markShelfLoading(current = {}) {
  return { ...emptyShelfEntry(), ...(current || {}), loading: true, error: '' };
}

export function markShelfError(current = {}, message = '') {
  return { ...emptyShelfEntry(), ...(current || {}), loading: false, error: message || 'Catalog failed', fetched: true };
}
