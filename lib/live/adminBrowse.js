/**
 * lib/live/adminBrowse.js — pure Admin → TV browse summaries.
 *
 * The admin manager drives a source → catalog → channel flow with zero
 * network calls. Its chip counts MUST match what a viewer sees on /live, so
 * this helper runs the exact same visibility + identity pipeline as
 * app/api/live/channels:
 *
 *   hidden / unplayable / URL-less / dummy-licence rows are dropped,
 *   non-Tamil rows are dropped, the rest are merged with deduplicateChannels
 *   (HD/DASH/ClearKey rows become one card), religious groups are excluded
 *   unless an owner mapped one, and catalogs are counted per LOGICAL GROUP.
 *
 * Pass rows already scoped to the selected source. Side-effect free, so the
 * whole contract is unit-testable without a database.
 */

import { LIVE_CATALOGS, isLiveCatalogId } from '@/lib/liveCatalogs';
import { deduplicateChannels, isDummyVariant } from '@/lib/live/pipeline/deduplicate.js';
import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';
import { isReligiousChannel } from '@/lib/live/catalogRules';

/**
 * @param {Array} rows stored LiveChannel client docs (one source scope, or
 *                     the whole collection for "All sources")
 * @returns {{ total, unmapped, religious, catalogs: Object<string, number> }}
 *          counts are LOGICAL GROUPS — i.e. /live cards, not stored rows.
 */
export function summarizeLiveCatalogue(rows = []) {
  const summary = {
    total: 0,
    unmapped: 0,
    religious: 0,
    catalogs: Object.fromEntries(LIVE_CATALOGS.map((catalog) => [catalog.id, 0])),
  };

  const visibleFlat = (rows || []).filter((row) => {
    if (row.hidden || row.playable === false || !row.url) return false;
    if (isDummyVariant(row)) return false;
    return isMainstreamTamilChannel(row, row.sourceId);
  });
  if (!visibleFlat.length) return summary;

  // The stored category lives on the row; dedup variants only carry the
  // cleaned name, so keep a lookup for the group-level religious decision.
  const rowById = new Map(visibleFlat.map((row) => [row.channelId, row]));
  const groups = deduplicateChannels(visibleFlat);

  for (const group of groups) {
    const everyReligious = group.variants.every((variant) => {
      const row = rowById.get(variant.channelId);
      return isReligiousChannel({
        name: variant.originalName || variant.name,
        category: row?.category,
        groupTitle: row?.category,
      });
    });
    const manualOverride = group.variants.some(
      (variant) => variant.mappingManaged && (variant.catalogIds || []).length > 0,
    );
    if (everyReligious && !manualOverride) {
      summary.religious += 1;
      continue;
    }

    const ids = [...new Set(
      group.variants.flatMap((variant) => variant.catalogIds || []).filter(isLiveCatalogId),
    )];
    summary.total += 1; // every visible group shows in the "All" tab on /live
    if (!ids.length) {
      summary.unmapped += 1;
      continue;
    }
    for (const id of ids) summary.catalogs[id] += 1;
  }

  return summary;
}
