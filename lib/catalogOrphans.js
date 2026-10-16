import CatalogOverride from '@/models/CatalogOverride';
import { itemKey } from '@/lib/catalogAdmin';

/**
 * catalogOrphans — find overrides that no longer apply, and offer to put them back.
 *
 * The bug this exists for: an override is keyed by `type + lowercased RAW scraped title`. That is
 * the right key — it survives a re-scrape — but it is not immortal. When the forum edits a release
 * name (a typo fix, a quality tag, a re-upload), the raw string changes, the key changes, and every
 * correction, pin and hide attached to it **silently stops applying**. Nothing errors; the row just
 * quietly goes back to how the scraper sees it.
 *
 * So: read the live catalogue, compute which override keys are not in it, and for each one find the
 * closest current row so a re-bind is one click instead of a forensic exercise.
 *
 * Matching is deliberately conservative and explainable — never fuzzy-guess-and-apply:
 *   exact-parsed  a current row whose parsed title + year match the orphan's
 *   title-only    same parsed title, different year (a re-upload often changes the year)
 *   year+type     same year and type, and the orphan's parsed title is a prefix of the candidate's
 * Nothing is changed by the report; `rebindOverride` moves the document only when asked.
 */

/**
 * Candidate rows for one orphan, ranked, with a reason a human can check.
 *
 * Matching is explainable, never a magic score: same parsed title, same raw title, same words apart
 * from a spelling (`Gray`/`Grey`, the quality tag the forum just changed), a prefix relationship, and
 * finally year+type alone. Only rows of the same type are ever considered — a movie override must
 * never be re-bound onto a series.
 *
 * Nothing here writes anything. The report shows these with their reasons and the owner clicks one,
 * which is why a bounded typo-tier is safe: a wrong re-bind is visible in the button before it is
 * applied, and undoable afterwards.
 */
export function suggestRebinds(orphan = {}, rows = [], limit = 3) {
  const title = normalise(orphan.title || orphan.titleOverride || '');
  const year = String(orphan.yearOverride || orphan.year || '').trim();
  if (!title && !year) return [];
  const type = orphan.type === 'series' ? 'series' : 'movie';

  const scored = [];
  for (const row of rows) {
    if (row.type && row.type !== type) continue; // never across a movie/series boundary
    const rowTitle = normalise(row.title);
    const rowRaw = normalise(row.rawTitle);
    const rowYear = String(row.year || '').trim();
    const sameYear = Boolean(year) && rowYear === year;
    let score = 0;
    let why = '';

    if (title && rowRaw === normalise(orphan.rawTitle)) {
      score = 95;
      why = 'same raw scraped title — the key should have matched, so check for a whitespace or case change in the source';
    } else if (title && rowTitle === title) {
      score = sameYear ? 100 : 80;
      why = sameYear ? 'same title and year' : 'same title, year differs';
    } else if (title && sameWords(title, rowTitle)) {
      score = sameYear ? 70 : 55;
      why = sameYear ? 'same title words, spelling differs (and same year)' : 'same title words, spelling and year differ';
    } else if (title && (rowTitle.startsWith(title) || title.startsWith(rowTitle))) {
      score = sameYear ? 65 : 50;
      why = 'one title is a prefix of the other — check the quality tag';
    } else if (sameYear) {
      score = 40;
      why = `same type and year only (${year}) — check carefully before re-binding`;
    }
    if (score) scored.push({ key: row.key, title: row.title, year: row.year, type: row.type, why, score, sameYear });
  }
  return scored
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit);
}

/** Words match when the sets are equal after dropping articles and allowing one typo per word. */
function sameWords(a = '', b = '') {
  const left = words(a);
  const right = words(b);
  if (!left.length || left.length !== right.length) return false;
  return left.every((word, index) => word === right[index] || offByOne(word, right[index]));
}

function words(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !['the', 'a', 'an', 'of'].includes(word));
}

/** One insertion, deletion or substitution — enough for Gray/Grey and a dropped letter. */
function offByOne(a = '', b = '') {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a === b) return true;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function normalise(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The report. `rows` are the admin listing rows (decorated, with keys); `overrides` are the raw
 * override documents. An override is orphaned when its key is not in the live catalogue.
 */
export function buildOrphanReport(overrides = [], rows = []) {
  const liveKeys = new Set(rows.map((row) => row.key));
  const orphans = overrides
    .filter((doc) => doc?.key && !liveKeys.has(doc.key))
    .map((doc) => ({
      key: doc.key,
      type: doc.type || 'movie',
      rawTitle: doc.rawTitle || '',
      title: doc.titleOverride || doc.rawTitle || doc.key,
      year: doc.yearOverride || '',
      hidden: Boolean(doc.hidden),
      pinned: Boolean(doc.pinned),
      overridden: Boolean(doc.titleOverride || doc.yearOverride || doc.qualityOverride),
      updatedAt: doc.updatedAt || null,
      // What the override was doing, so a re-bind can carry the whole intent across, not just the key.
      carry: {
        hidden: Boolean(doc.hidden),
        pinned: Boolean(doc.pinned),
        titleOverride: doc.titleOverride || '',
        yearOverride: doc.yearOverride || '',
        qualityOverride: doc.qualityOverride || '',
        note: doc.note || '',
      },
      suggestions: suggestRebinds(doc, rows),
    }))
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return {
    count: orphans.length,
    applied: overrides.length - orphans.length,
    orphans,
  };
}

/**
 * Move an override from its dead key to a live one: the whole intent travels (hidden, pinned,
 * corrections, note), then the old document is deleted. Runs as "copy then remove" so a failure
 * between the two steps leaves a duplicate rather than losing the owner's correction.
 */
export async function rebindOverride(fromKey, toKey) {
  if (!fromKey || !toKey) throw Object.assign(new Error('Both keys are required.'), { status: 400 });
  if (fromKey === toKey) throw Object.assign(new Error('The override already belongs to that row.'), { status: 400 });
  const source = await CatalogOverride.findOne({ key: fromKey }).lean();
  if (!source) throw Object.assign(new Error('That override no longer exists.'), { status: 404 });
  const target = await CatalogOverride.findOne({ key: toKey }).lean();
  if (target) throw Object.assign(new Error('That row already has its own override — merge them by hand, or clear it first.'), { status: 409 });

  await CatalogOverride.create({
    key: toKey,
    type: source.type,
    rawTitle: source.rawTitle,
    title: source.title,
    hidden: Boolean(source.hidden),
    pinned: Boolean(source.pinned),
    titleOverride: source.titleOverride || '',
    yearOverride: source.yearOverride || '',
    qualityOverride: source.qualityOverride || '',
    note: source.note ? `${source.note} (re-bound from ${fromKey})`.slice(0, 2000) : `Re-bound from ${fromKey}`,
  });
  await CatalogOverride.deleteOne({ key: fromKey });
  return true;
}
