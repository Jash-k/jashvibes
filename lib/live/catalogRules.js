/**
 * lib/live/catalogRules.js — background catalog classification (v13)
 *
 * Pure, database-free rules used by the post-sync grouping pass to decide
 * which fixed catalog(s) a channel belongs to:
 *
 *   main   — curated Tamil flagship GEC families only (owner decision,
 *            2026-10-24): Sun, Star Vijay, Zee Tamil, Jaya, Kalaignar, Colors
 *            Tamil, Raj, Polimer, DD Podhigai. Flagship news/music/kids/sister
 *            channels keep `main` AND pick up their topical catalog.
 *   music / sports / kids / news — category + name keyword detection.
 *   local  — Tamil community/local channels ONLY. Religious channels are
 *            explicitly excluded (owner decision).
 *   others — everything else: movies-only feeds, lifestyle/infotainment and
 *            anything unmatched.
 *
 * v13 owner rule: religious/devotional channels are excluded from EVERY
 * catalog, so classifyChannelCatalogs returns [] for them and they never
 * appear on /live. Nothing is deleted — the rows stay in the database and an
 * owner can still place one manually; a manual mapping (mappingManaged) is
 * always honored (see isReligiousExcludedGroup).
 *
 * Manual mappings (mappingManaged = true) are never reclassified: the sync
 * layer only calls this for channels with no catalog memberships.
 */

import { LIVE_CATALOG_IDS } from '@/lib/liveCatalogs';

export const CATALOG_MAIN = 'main';
export const CATALOG_MUSIC = 'music';
export const CATALOG_SPORTS = 'sports';
export const CATALOG_KIDS = 'kids';
export const CATALOG_NEWS = 'news';
export const CATALOG_LOCAL = 'local';
export const CATALOG_OTHERS = 'others';

export function normalizeCatalogName(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Word-boundary-tolerant keyword test on the normalized name. */
function hasAny(name, keywords) {
  return keywords.some((keyword) => name.includes(keyword));
}

/* ------------------------------------------------------------------ religion */

const RELIGIOUS_CATEGORY = /religio|devotion|spiritual|worship|bhakti|bakthi/i;
const RELIGIOUS_KEYWORDS = [
  'aaseervatham', 'aastha', 'aasthaa', 'angel tv', 'god tv', 'gods', 'jesus', 'christ',
  'gospel', 'bible', 'church', 'catholic', 'prayer', 'ministry', 'blessing', 'shalom',
  'nambikkai', 'muslim', 'islam', 'quran', 'madani', 'masjid', 'murugan', 'sivan', 'shiva',
  'amman', 'sai baba', 'saibaba', 'bhakthi', 'bakthi', 'vedha', 'veda', 'geetha', 'gita',
  'temple', 'dharmam', 'oman', 'peace tv', 'subhavartha', 'santhosh', 'arputhar', 'nippu',
  'god is', 'yesu', 'karthar', 'parishudda', 'swami', 'swamiye', 'madha', 'matha',
];

export function isReligiousChannel(ch = {}) {
  const name = normalizeCatalogName(ch.name || ch.displayName || '');
  const category = normalizeCatalogName(ch.category || ch.groupTitle || '');
  if (RELIGIOUS_CATEGORY.test(String(ch.category || ch.groupTitle || ''))) return true;
  return hasAny(name, RELIGIOUS_KEYWORDS);
}

/* -------------------------------------------------------------------- topical */

const NEWS_KEYWORDS = [
  'news', 'seithigal', 'seithigal', 'thalaimurai', 'thanthi', '24x7', '24 7',
  'news18', 'news7', 'news 7', 'nation', 'republic', 'ndtv', 'times now',
];
const KIDS_KEYWORDS = [
  'kids', 'chutti', 'chithiram', 'cartoon', 'pogo', 'nick', 'nickelodeon',
  'sonic', 'hungama', 'discovery kids', 'baby', 'children', 'boomerang',
];
const MUSIC_KEYWORDS = [
  'music', 'musix', 'isai', 'isaiaruvi', 'paadal', 'paattU', 'songs', 'raaga',
];
const SPORTS_KEYWORDS = [
  'sports', 'sport', 'cricket', 'ten 1', 'ten 2', 'ten 3', 'ten 4', 'ten hd',
  'sony ten', 'star sports', 'eurosport', 'dsport', 'd sport', 'wwe',
];

function topicalCatalogs(ch = {}) {
  const name = normalizeCatalogName(ch.name || ch.displayName || '');
  const category = normalizeCatalogName(ch.category || ch.groupTitle || '');
  const found = [];
  if (category.includes('news') || hasAny(name, NEWS_KEYWORDS)) found.push(CATALOG_NEWS);
  if (category.includes('kids') || hasAny(name, KIDS_KEYWORDS)) found.push(CATALOG_KIDS);
  if (category.includes('music') || hasAny(name, MUSIC_KEYWORDS)) found.push(CATALOG_MUSIC);
  if (category.includes('sport') || hasAny(name, SPORTS_KEYWORDS)) found.push(CATALOG_SPORTS);
  return found;
}

/* ----------------------------------------------------------------------- main */

/**
 * Flagship Tamil GEC families. Matching is exact or a word-prefix so HD/SD
 * variants ("sun tv hd", "star vijay hd") stay inside the family without
 * catching unrelated channels that merely contain the same letters.
 */
const MAIN_EXACT = new Set([
  'sun tv', 'sun hd', 'sun music', 'sun music hd', 'ktv', 'ktv hd', 'sun news',
  'sun life', 'adithya', 'adithya tv', 'chutti tv',
  'star vijay', 'star vijay hd', 'vijay tv', 'vijay super', 'vijay takkar',
  'star vijay music', 'star vijay movies',
  'zee tamil', 'zee tamil hd', 'zee thirai',
  'jaya tv', 'jaya tv hd', 'jaya plus', 'jaya max', 'jaya movies',
  'kalaignar tv', 'kalaignar', 'kalaignar tv hd', 'kalaignar seithigal',
  'kalaignar news', 'isaiaruvi', 'isaiaruvi tv',
  'colors tamil', 'colors tamil hd',
  'raj tv', 'raj musix', 'raj digital', 'raj news',
  'polimer tv',
  'dd podhigai', 'dd tamil',
]);

const MAIN_PREFIXES = [
  'sun tv', 'sun music', 'star vijay', 'vijay super', 'vijay takkar', 'zee tamil',
  'zee thirai', 'jaya tv', 'jaya max', 'jaya plus', 'jaya movies', 'kalaignar',
  'colors tamil', 'raj tv', 'raj musix', 'polimer tv', 'dd podhigai', 'dd tamil', 'ktv',
];

export function isMainstreamFlagship(ch = {}) {
  const name = normalizeCatalogName(ch.name || ch.displayName || '');
  if (!name) return false;
  if (MAIN_EXACT.has(name)) return true;
  return MAIN_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix} `));
}

/* ------------------------------------------------------------- family rank */

/**
 * Owner-facing /live ordering (2026-10-25): flagship broadcaster families
 * first — Vijay, then Sun (with its sister channels KTV/Adithya/Chutti),
 * then Jaya — followed by every other mainstream flagship, and the long
 * tail last. Applied BEFORE the persisted catalog position, so within a
 * family the owner's manual order still decides; the families as a whole
 * always lead the page regardless of alphabetical naming.
 */
const FAMILY_VIJAY = /^(star )?vijay\b/;
const FAMILY_SUN = /^(sun|ktv|adithya|chutti)\b/;
const FAMILY_JAYA = /^jaya\b/;

export function liveFamilyRank(input = '') {
  const name = normalizeCatalogName(typeof input === 'string' ? input : (input?.displayName || input?.name || ''));
  if (!name) return 4;
  if (FAMILY_VIJAY.test(name)) return 0;
  if (FAMILY_SUN.test(name)) return 1;
  if (FAMILY_JAYA.test(name)) return 2;
  if (isMainstreamFlagship({ name })) return 3;
  return 4;
}

/* ---------------------------------------------------------------------- local */

const LOCAL_CATEGORY = /(^|[\s/])(local|community|regional)([\s/]|$)/i;
/**
 * Known Tamil community/local broadcasters. National flagship and topical
 * channels are decided before this list, so this only catches the small
 * regional services. Religious names never reach here.
 */
const LOCAL_KEYWORDS = [
  'aathavan', 'athavan', 'vasanth', 'vasantham', 'murasu', 'lotus', 'win tv',
  'makkal', 'makkal tv', 'mega tv', 'captain tv', 'vendhar', 'tamil vision',
  'local tv', 'city tv', 'nagar', 'mavatta', 'maavatta', 'district', 'aanmeegham',
  'tamilan', 'anandha', 'anandham', 'bhagyam', 'sathiyam', 'velicham', 'oli',
  'kathir', 'thedal', 'puthu yugam', 'puthuyugam',
];

export function isLocalTamilChannel(ch = {}) {
  if (isReligiousChannel(ch)) return false;
  const name = normalizeCatalogName(ch.name || ch.displayName || '');
  const rawCategory = String(ch.category || ch.groupTitle || '');
  if (LOCAL_CATEGORY.test(rawCategory)) return true;
  return hasAny(name, LOCAL_KEYWORDS);
}

/* --------------------------------------------------------------------- classify */

/**
 * @returns {string[]} catalog ids, all valid LIVE_CATALOG_IDS. A flagship
 * channel can return two ids (main + topical); every non-religious channel
 * returns exactly one; a religious channel returns [] — excluded from every
 * catalog and from /live until an owner maps it by hand.
 */
export function classifyChannelCatalogs(ch = {}) {
  const religious = isReligiousChannel(ch);
  if (religious) return [];
  const topical = topicalCatalogs(ch);
  const flagship = isMainstreamFlagship(ch);

  if (flagship) {
    return [CATALOG_MAIN, ...topical].filter((id, index, all) => LIVE_CATALOG_IDS.includes(id) && all.indexOf(id) === index);
  }
  if (topical.length) return [topical[0]];
  if (isLocalTamilChannel(ch)) return [CATALOG_LOCAL];
  return [CATALOG_OTHERS];
}

/**
 * Group-level religious exclusion for deduplicated logical channels.
 *
 * A whole logical group is excluded only when EVERY variant is a religious
 * channel and no variant carries an owner mapping (mappingManaged with at
 * least one catalog membership). That second clause is the manual override:
 * once an owner places a religious channel in a catalog, it stays visible
 * exactly there and no sync can take it back out.
 *
 * Accepts either a logical group ({ variants: [...] }) or a single flat
 * channel shape. Variants need the same name/category fields the classifier
 * reads plus mappingManaged/catalogIds when available.
 */
export function isReligiousExcludedGroup(group = {}) {
  const variants = Array.isArray(group.variants) && group.variants.length
    ? group.variants
    : [group];
  if (!variants.every((variant) => variant && isReligiousChannel(variant))) return false;
  return !variants.some((variant) => {
    if (!variant.mappingManaged) return false;
    if (Array.isArray(variant.catalogIds) && variant.catalogIds.length) return true;
    return Array.isArray(variant.catalogs) && variant.catalogs.length > 0;
  });
}

/**
 * Rank used when auto-assigning positions inside a catalog: flagships first,
 * then alphabetical. Manual ordering always overrides this.
 */
export function autoCatalogRank(ch = {}) {
  const name = normalizeCatalogName(ch.name || ch.displayName || '');
  return (isMainstreamFlagship(ch) && !isReligiousChannel(ch) ? '0' : '1') + name;
}
