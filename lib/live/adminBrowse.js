/**
 * lib/live/adminBrowse.js — Admin → TV browse summaries.
 *
 * The admin manager drives a source → catalog → channel flow with zero
 * network calls. Its chip counts MUST match what a viewer sees on /live, so
 * there is no second pipeline here: summarizeLiveCatalogue is a thin adapter
 * over the shared read/viewBuilder.js, and count parity holds by construction.
 *
 * Pass rows already scoped to the selected source. Side-effect free, so the
 * whole contract is unit-testable without a database.
 */

import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import { buildCatalogueView } from '@/lib/live/read/viewBuilder.js';

/**
 * @param {Array} rows stored LiveChannel client docs (one source scope, or
 *                     the whole collection for "All sources")
 * @returns {{ total, unmapped, religious, catalogs: Object<string, number> }}
 *          counts are LOGICAL GROUPS — i.e. /live cards, not stored rows.
 */
export function summarizeLiveCatalogue(rows = []) {
  // The admin browse is always Tamil-scoped, exactly like the public
  // tamilOnly=1 catalogue the /live page renders.
  const view = buildCatalogueView(rows, { tamilOnly: true });
  return {
    total: view.total,
    unmapped: view.unmapped,
    religious: view.religious,
    catalogs: Object.fromEntries(
      LIVE_CATALOGS.map((catalog) => [catalog.id, view.catalogs.find((entry) => entry.id === catalog.id)?.count || 0]),
    ),
  };
}

/**
 * Distinct SOURCE-NATIVE groups (the feed's own group-title, stored as the
 * row's `category`) for one source scope. This is the read-only browse
 * dimension the owner uses to walk a source's own taxonomy — e.g. Pocket
 * Tamil's "Local Channels", "Tamil FM Radio", "Overseas". It never edits
 * anything: sync owns the source category, our fixed catalogs own publish.
 *
 * Counts are stored ROWS (feed entries), matching what the admin list
 * renders, not merged /live cards.
 *
 * @param {Array} rows rows already scoped to the selected source
 * @returns {Array<{id:string,label:string,count:number}>} "all" first, then
 *          groups by descending count and label as the tiebreak.
 */
export function summarizeSourceGroups(rows = []) {
  const counts = new Map();
  for (const row of rows || []) {
    const group = String(row?.category || 'Live').trim() || 'Live';
    counts.set(group, (counts.get(group) || 0) + 1);
  }
  const groups = [...counts.entries()]
    .map(([id, count]) => ({ id, label: id, count }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  const total = groups.reduce((sum, item) => sum + item.count, 0);
  return [{ id: 'all', label: 'All source groups', count: total }, ...groups];
}
