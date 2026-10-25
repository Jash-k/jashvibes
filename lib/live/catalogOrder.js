/**
 * lib/live/catalogOrder.js — ordering of logical groups on /live.
 *
 * Two distinct orders, both decided here so the public route and its
 * contract tests share one implementation:
 *
 *   1. Inside a fixed catalog (main/music/sports/…): the owner's Admin
 *      drag/↑↓ order is authoritative. Every mapped membership carries a
 *      100-step position, so sorting by the group's lowest position
 *      reproduces the Admin catalog exactly — family rank only breaks
 *      ties, then the display name.
 *
 *   2. The virtual "All Tamil" view has no single admin order, so the
 *      broadcaster-family ranking (Vijay → Sun+sisters → Jaya → other
 *      mainstream → tail) leads, with position and name as tiebreaks.
 *
 * Pure and side-effect free.
 */

import { normalizeCatalogMemberships } from '@/lib/liveCatalogs';
import { liveFamilyRank } from '@/lib/live/catalogRules';

/** Lowest catalog position any variant of this group holds (999999 if unmapped). */
export function groupCatalogPosition(group, catalogId = 'all') {
  let lowest = 999999;
  for (const variant of group.variants || []) {
    const memberships = normalizeCatalogMemberships(variant.catalogs || []);
    for (const membership of memberships) {
      if (catalogId !== 'all' && membership.catalogId !== catalogId) continue;
      lowest = Math.min(lowest, Number(membership.position) || 0);
    }
  }
  return lowest;
}

function byName(a, b) {
  return String(a.displayName || '').localeCompare(String(b.displayName || ''));
}

/** Comparator for Array.sort — see file header for the two ordering modes. */
export function compareLogicalGroups(a, b, catalogId = 'all') {
  if (catalogId && catalogId !== 'all') {
    // Fixed catalog: Admin order first, family rank then name as tiebreaks.
    const positionDiff = groupCatalogPosition(a, catalogId) - groupCatalogPosition(b, catalogId);
    if (positionDiff) return positionDiff;
    const rankDiff = liveFamilyRank(a.displayName) - liveFamilyRank(b.displayName);
    if (rankDiff) return rankDiff;
    return byName(a, b);
  }
  // "All Tamil": broadcaster families first.
  const rankDiff = liveFamilyRank(a.displayName) - liveFamilyRank(b.displayName);
  if (rankDiff) return rankDiff;
  const positionDiff = groupCatalogPosition(a, 'all') - groupCatalogPosition(b, 'all');
  if (positionDiff) return positionDiff;
  return byName(a, b);
}

export function sortLogicalGroups(groups = [], catalogId = 'all') {
  return [...groups].sort((a, b) => compareLogicalGroups(a, b, catalogId));
}
