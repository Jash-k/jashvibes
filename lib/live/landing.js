/**
 * lib/live/landing.js — pure helpers for the /live landing choice.
 *
 * Owner rule: opening Live TV lands on the Main catalog with Star Vijay
 * already tuned. Kept side-effect free so the choice is unit-testable without
 * a database or React tree.
 */

/** Union of catalog ids across every variant of a logical group. */
export function groupCatalogIds(group = {}) {
  const ids = new Set();
  for (const variant of group.variants || []) {
    for (const id of variant.catalogIds || []) ids.add(id);
    for (const membership of variant.catalogs || []) {
      if (typeof membership === 'string') ids.add(membership);
      else if (membership?.catalogId) ids.add(membership.catalogId);
    }
  }
  return [...ids];
}

const VIJAY_EXACT = new Set(['star vijay', 'vijay tv', 'star vijay tv']);

/**
 * Pick the channel to tune when /live opens.
 * 1. a Main-catalog group whose name is exactly Star Vijay / Vijay TV
 * 2. any Main-catalog group whose name starts with / contains "vijay"
 * 3. the first Main-catalog group
 * 4. the first group overall (so the player is never empty)
 */
export function pickLandingGroup(groups = []) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const inMain = groups.filter((g) => groupCatalogIds(g).includes('main'));
  const pool = inMain.length ? inMain : groups;
  const named = (g) => String(g.displayName || g.name || '').toLowerCase().trim();

  const exact = pool.find((g) => VIJAY_EXACT.has(named(g)));
  if (exact) return exact;

  const vijay = pool.find((g) => {
    const name = named(g);
    return name.startsWith('star vijay') || name.startsWith('vijay tv') || name.includes('vijay');
  });
  return vijay || pool[0];
}
