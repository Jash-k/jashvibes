/**
 * lib/live/adminBrowse.js — pure Admin → TV browse summaries.
 *
 * The admin manager holds the whole collection in memory and drives a
 * source → catalog → channel flow with zero network calls. This helper
 * summarises one source scope (or every source) into the catalog chip
 * counts the UI renders, including the virtual Unmapped and Religious
 * buckets. Side-effect free so the counts are contract-testable.
 */

import { LIVE_CATALOGS, isLiveCatalogId } from '@/lib/liveCatalogs';

/**
 * @param {Array} rows            channel docs in the current source scope
 * @param {Function} catalogIdsOf (row) => string[] membership ids
 * @returns {{ total, unmapped, religious, catalogs: Object<string, number> }}
 */
export function summarizeSourceCatalogs(rows = [], catalogIdsOf = () => []) {
  const summary = {
    total: Array.isArray(rows) ? rows.length : 0,
    unmapped: 0,
    religious: 0,
    catalogs: Object.fromEntries(LIVE_CATALOGS.map((catalog) => [catalog.id, 0])),
  };
  for (const row of rows || []) {
    if (row?.religious) summary.religious += 1;
    const ids = (catalogIdsOf(row) || []).filter(isLiveCatalogId);
    if (!ids.length) {
      summary.unmapped += 1;
      continue;
    }
    for (const id of new Set(ids)) summary.catalogs[id] += 1;
  }
  return summary;
}
