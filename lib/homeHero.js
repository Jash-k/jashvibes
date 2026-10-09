/*
 * lib/homeHero.js — server-side read of the home hero banner.
 *
 * WHY THIS EXISTS
 * The hero art is the largest thing on the page, and it used to be painted only
 * after: HTML → hydration → fetch /api/tamilmv → state → render → image request.
 * That chain is what the LCP was really waiting on, not the image bytes. Reading
 * the same cached payload on the server puts the banner (and its <img src>) in the
 * first HTML response, so the browser starts the artwork download at parse time.
 *
 * THREE RULES, each deliberate:
 *
 * 1. **Never block on a scrape.** This only serves a cache the API would serve
 *    without syncing. If the cache is due for a refresh the function returns null
 *    immediately and the page renders exactly as it did before — the client fetch
 *    takes over. The HTML must not wait behind a scraper.
 *
 * 2. **A hard time budget.** Every await races a short timer. If Mongo is slow or
 *    unreachable, the hero is simply absent and the page is no worse than yesterday.
 *    A dangling read is harmless: everything here is read-only.
 *
 * 3. **The same pipeline as the API.** Title matches (which is where backdropUrl
 *    comes from), quality tagging and owner overrides all come from
 *    lib/tamilmvPayload.js — the module the route itself uses. Reimplementing that
 *    shaping here is how the server hero and the client grid would start disagreeing.
 */
import { cacheAgeMs, getCachedScrape, isSyncDue, paginatePayload, withOverrides, withTitleMatches } from '@/lib/tamilmvPayload';
import { buildHeroSlide, pickHeroItem } from '@/lib/heroSlide';

// Must track the API's page-1 window: the client asks for /api/tamilmv?page=1&limit=15
// and picks the first item with art from movies-then-series.
const FIRST_PAGE = { page: 1, limit: 15, group: 'all', start: 0, end: 15 };

const BUDGET_MS = 700;

// One process-level memo. A server component runs per request and the payload only
// changes every six hours, so re-deriving the hero for every visitor would be pure
// waste (and three extra queries). Sixty seconds keeps it comfortably fresh — the
// client re-fetches the real catalogue immediately after hydration anyway.
const MEMO_TTL_MS = 60_000;
let memo = { at: 0, slide: null };

function withBudget(promise, ms = BUDGET_MS) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function readCachedHero() {
  const now = Date.now();
  if (now - memo.at < MEMO_TTL_MS) return memo.slide;

  let slide = null;
  try {
    const cached = await withBudget(getCachedScrape());
    if (cached && !isSyncDue(cached)) {
      const payload = await withBudget(withTitleMatches(cached).then(withOverrides));
      if (payload) {
        const shaped = paginatePayload(payload, FIRST_PAGE);
        slide = buildHeroSlide(pickHeroItem([...(shaped.movies || []), ...(shaped.series || [])]));
      }
    }
  } catch {
    // A missing hero is a cosmetic loss; a thrown error here would take the whole
    // page down. The client renders the banner a moment later regardless.
    slide = null;
  }

  memo = { at: now, slide };
  return slide;
}

/** Exposed for the log line in tests and for diagnosing a cold cache. */
export function heroCacheAgeMs(doc) {
  return cacheAgeMs(doc);
}
