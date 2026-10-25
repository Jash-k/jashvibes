/**
 * catalogBulk — the pure half of the Home tab's power tools: bulk edits, duplicate grouping, and
 * scraping-diff computation. No database, no network, so `scripts/test-admin-controls.cjs` can
 * prove all of it.
 *
 * The rule for everything here: **compute the change, show it, then apply it.** Bulk editing one
 * row at a time is what the panel already did; what makes it safe to touch forty at once is being
 * able to read exactly what will happen (and what will not, because it is already that way) first.
 */

const DEFAULT_OVERRIDE = {
  hidden: false,
  pinned: false,
  titleOverride: '',
  yearOverride: '',
  qualityOverride: '',
  note: '',
};

/** The override document a row should have after `op`, or null when it should have none. */
function planOverride(row = {}, op = {}) {
  const current = snapshotOf(row);
  const action = String(op.op || '').trim();
  const value = String(op.value || '').trim();

  if (action === 'forget') {
    // Deleting the override is a real change only when one exists.
    return { key: row.key, label: labelOf(row), before: current, after: null };
  }

  const next = { ...(current || DEFAULT_OVERRIDE) };
  if (action === 'hide') next.hidden = true;
  else if (action === 'restore') next.hidden = false;
  else if (action === 'pin') next.pinned = true;
  else if (action === 'unpin') next.pinned = false;
  else if (action === 'set-quality') next.qualityOverride = value;
  else if (action === 'retag') next.titleOverride = value;
  else throw Object.assign(new Error(`Unknown bulk action "${action}".`), { status: 400 });

  // With no override document yet, the row's own state is the baseline: asking to hide an
  // already-hidden row (or restore a visible one) must come out as "nothing to do", not as a write.
  const baseline = current || { ...DEFAULT_OVERRIDE, hidden: Boolean(row.hidden), pinned: Boolean(row.pinned) };
  const noChange = !current && sameOverride(baseline, next);
  return { key: row.key, label: labelOf(row), before: current, after: noChange ? null : stripEmpty(next) };
}

/** The whole plan for a selection: only the rows that would actually change. */
export function planBulk(rows = [], op = {}) {
  const plans = rows.map((row) => planOverride(row, op));
  const changed = plans.filter((plan) => !sameSnapshot(plan.before, plan.after));
  const skipped = plans.filter((plan) => sameSnapshot(plan.before, plan.after));
  return { changed, skipped, summary: summariseBulk(op, changed, skipped) };
}

function summariseBulk(op = {}, changed = [], skipped = []) {
  const what = {
    hide: 'Hide', restore: 'Restore', pin: 'Pin', unpin: 'Unpin',
    'set-quality': `Set quality to ${op.value || '—'}`, retag: `Retag to “${op.value || '—'}”`, forget: 'Forget overrides',
  }[op.op] || op.op;
  const bits = [`${what} — ${changed.length} row${changed.length === 1 ? '' : 's'} will change`];
  if (skipped.length) bits.push(`${skipped.length} already in that state`);
  return bits.join('; ');
}

/** Snapshots for the audit trail, with empty strings dropped so an undo restores a clean document. */
function stripEmpty(override) {
  const out = {};
  for (const [key, value] of Object.entries(override)) {
    if (value === '' || value === false || value === null || value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

export function snapshotOf(row = {}) {
  const override = row.override;
  if (!override) return null;
  const out = {};
  for (const key of ['hidden', 'pinned', 'titleOverride', 'yearOverride', 'qualityOverride', 'note']) {
    const value = override[key];
    if (value === '' || value === false || value === null || value === undefined) continue;
    out[key] = key === 'hidden' || key === 'pinned' ? Boolean(value) : value;
  }
  return Object.keys(out).length ? out : null;
}

function sameOverride(a, b) {
  const left = a || {};
  const right = b || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Boolean(left[key]) !== Boolean(right[key])) return false;
    if (String(left[key] ?? '') !== String(right[key] ?? '')) return false;
  }
  return true;
}

function sameSnapshot(a, b) {
  return sameOverride(a, b);
}

function labelOf(row = {}) {
  return row.title || row.rawTitle || row.key || '';
}

// ── Duplicates ───────────────────────────────────────────────────────────────

/**
 * Group the catalogue rows that are the same film uploaded more than once.
 *
 * The forum does this constantly: a re-upload, a second quality, a fixed audio track — each is a
 * separate topic and therefore a separate row, and the home page shows all of them. This finds the
 * groups; it never decides alone. A group is only reported when it has two or more rows *and* the
 * rows are not simply the same release twice at different qualities the owner may want to keep.
 *
 * Grouping key: the parsed title plus the type. Years are allowed to differ by one (a re-release
 * often carries the next year) but no further — beyond that they are different films.
 */
export function findDuplicateGroups(rows = [], { maxYearGap = 1 } = {}) {
  const buckets = new Map();
  for (const row of rows) {
    const slug = normaliseTitle(row.title || row.rawTitle);
    if (!slug) continue;
    const type = row.type === 'series' ? 'series' : 'movie';
    const key = `${type}|${slug}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const groups = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    // Split by year when the years are far apart.
    const byYear = [];
    for (const row of [...members].sort((a, b) => Number(a.year || 0) - Number(b.year || 0))) {
      const year = Number(row.year || 0);
      const bucket = byYear.find((entry) => !year || !entry.year || Math.abs(entry.year - year) <= maxYearGap);
      if (bucket) {
        bucket.rows.push(row);
        if (!bucket.year) bucket.year = year;
      } else {
        byYear.push({ year, rows: [row] });
      }
    }
    for (const bucket of byYear) {
      if (bucket.rows.length < 2) continue;
      groups.push({
        key: `${key}|${bucket.year || 'unknown'}`,
        title: bucket.rows[0].title || bucket.rows[0].rawTitle,
        type: bucket.rows[0].type === 'series' ? 'series' : 'movie',
        year: bucket.year || '',
        rows: bucket.rows,
        suggestedWinner: pickWinner(bucket.rows),
        reasons: bucket.rows.map((row) => winnerReason(row, pickWinner(bucket.rows))),
      });
    }
  }
  return groups.sort((a, b) => b.rows.length - a.rows.length || String(a.title).localeCompare(String(b.title)));
}

/**
 * Which copy to keep. Ordered, and every step is something the owner can see in the row: a matched
 * TMDB id beats an unmatched one (it has a poster and correct metadata), a visible row beats a
 * hidden one, a better quality tier wins, and a pinned row is being kept on purpose.
 */
function pickWinner(rows = []) {
  return [...rows].sort((a, b) => scoreRow(b) - scoreRow(a) || String(a.rawTitle).localeCompare(String(b.rawTitle)))[0];
}

function winnerReason(row, winner) {
  if (winner && row.key === winner.key) return 'suggested keep — best metadata, visible, highest quality';
  const bits = [];
  if (!row.tmdbId) bits.push('no TMDB match');
  if (row.hidden) bits.push('already hidden');
  if (row.pinned) bits.push('pinned');
  if (winner?.tmdbId && row.tmdbId && String(row.tmdbId) !== String(winner.tmdbId)) bits.push('different TMDB id');
  return bits.length ? `suggested merge — ${bits.join(', ')}` : 'suggested merge — a duplicate row';
}

function scoreRow(row = {}) {
  return (row.tmdbId ? 100 : 0)
    + (row.hidden ? 0 : 20)
    + (row.pinned ? 10 : 0)
    + Math.min(9, Number(row.qualityTier) || 0)
    + Math.min(5, (row.rawTitle || '').length ? 1 : 0);
}

// ── Scrape diff (dry run) ────────────────────────────────────────────────────

/**
 * What a sync *would* do: which titles appear, which disappear, which change, and — the part that
 * actually protects the owner — which overrides this sync would orphan.
 *
 * Keys come from `keyFor`, passed in deliberately: the real one is `itemKey()` from the catalogue
 * module, and a dry run that used a different key would report a different answer than the sync
 * itself produces.
 */
export function diffScrape(cache = {}, scraped = {}, keyFor = (item) => `${item.type}:${item.rawTitle}`) {
  const before = indexItems([...(cache.movies || []), ...(cache.series || [])], keyFor);
  const after = indexItems([...(scraped.movies || []), ...(scraped.series || [])], keyFor);

  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, item] of after) {
    const previous = before.get(key);
    if (!previous) { added.push({ key, title: item.title || item.rawTitle, type: item.type, year: item.year || '' }); continue; }
    const fields = [];
    if (String(previous.title || '') !== String(item.title || '')) fields.push('title');
    if (String(previous.year || '') !== String(item.year || '')) fields.push('year');
    if (String(previous.qualityTier || '') !== String(item.qualityTier || '')) fields.push('quality');
    if (fields.length) changed.push({ key, title: item.title || item.rawTitle, type: item.type, fields });
  }
  for (const [key, item] of before) {
    if (!after.has(key)) removed.push({ key, title: item.title || item.rawTitle, type: item.type, year: item.year || '' });
  }

  return {
    added, removed, changed,
    counts: {
      before: before.size,
      after: after.size,
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      net: after.size - before.size,
    },
  };
}

/** Overrides whose key would vanish in the diff — i.e. that a sync would silently orphan. */
export function orphanedBy(diff = {}, overrideKeys = []) {
  const surviving = new Set([...(diff.changed || []), ...(diff.added || [])].map((row) => row.key));
  const gone = new Set((diff.removed || []).map((row) => row.key));
  return overrideKeys.filter((key) => gone.has(key) || !surviving.has(key));
}

function indexItems(items = [], keyFor) {
  const map = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (key) map.set(key, item);
  }
  return map;
}

export function normaliseTitle(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd|bluray|blu-ray|web-?dl|web-?rip|hdrip|hdtc|cam|predvd|dvdrip|hevc|x264|x265|aac|ddp?5\.?1|hindi|tamil|telugu|malayalam|kannada|dubbed|multi|audios?|esub|proper|repack)\b/g, ' ')
    .replace(/\b(the|a|an|of)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    // A trailing year belongs in the `year` field, not in the grouping key: "Vikram 2022" and
    // "Vikram" are the same film. Only a trailing 19xx/20xx is stripped, so a title that legitimately
    // carries a number keeps it — and if that leaves nothing at all (a film called "2012"), the row
    // is skipped from grouping rather than grouped on an empty key.
    .replace(/\s(19|20)\d{2}$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
