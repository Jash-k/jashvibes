#!/usr/bin/env node
/**
 * scripts/verify-vault.mjs — contract test for the vault catalogue.
 *
 *   node scripts/verify-vault.mjs                          # reads the live upstream
 *   node scripts/verify-vault.mjs ../mv_vault/data/vault.json
 *
 * Guards the two things that silently break the Vault UI:
 *   1. a movie record must normalise to EXACTLY the legacy field set — nothing
 *      added, nothing removed (series fields must never leak onto 2,797 movies);
 *   2. a series must group into ordered episodes with no embed lost, and must
 *      open on its earliest episode at the best quality.
 *
 * No dependencies, no test framework — exit code 1 on failure so CI can gate on it.
 */
import { normalizeVaultMovie } from '../lib/vault.js';
import { groupEpisodes, episodeLabel } from '../lib/vaultEpisodes.js';

const SOURCE = process.argv[2]
  || 'https://raw.githubusercontent.com/Jash-k/mv_vault/main/data/vault.json';

/** The exact key set every movie produced before series existed. */
const LEGACY_KEYS = ['id', 'title', 'year', 'poster', 'rating', 'tmdbId', 'imdbId', 'pageUrl',
  'addedAt', 'updatedAt', 'embeds', 'embedCount', 'quality', 'decade', 'letter'];

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const raw = /^https?:/.test(SOURCE)
  ? await (await fetch(SOURCE)).json()
  : JSON.parse(await (await import('node:fs/promises')).readFile(SOURCE, 'utf8'));

const records = (Array.isArray(raw) ? raw : []).map(normalizeVaultMovie);
const movies = records.filter((r) => !r.isSeries);
const series = records.filter((r) => r.isSeries);

console.log(`\nsource: ${SOURCE}`);
console.log(`catalogue: ${records.length} records (${movies.length} movies, ${series.length} series)\n`);

console.log('MOVIES — legacy contract');
check('records present', records.length > 0, String(records.length));
const extras = new Set();
for (const movie of movies) {
  for (const key of Object.keys(movie)) if (!LEGACY_KEYS.includes(key)) extras.add(key);
  for (const key of LEGACY_KEYS) if (!(key in movie)) extras.add(`missing:${key}`);
}
check('no field added to or missing from any movie', extras.size === 0, [...extras].join(', ') || 'exact legacy set');
check('every movie has plays, embeds and a quality label',
  movies.every((m) => m.embeds.length > 0 && m.quality), `${movies.filter((m) => !m.embeds.length).length} empty`);
check('groupEpisodes is inert for movies',
  movies.every((m) => groupEpisodes(m.embeds).length === 0));

console.log('\nSERIES — episode contract');
check('series have episodes', series.every((s) => s.episodeCount > 0),
  `${series.filter((s) => !s.episodeCount).length} empty`);
check('series expose kind/isSeries/seasonCount',
  series.every((s) => s.kind === 'series' && s.isSeries === true && s.seasonCount > 0));

let rangeOk = true; let detail = '';
for (const s of series) {
  const eps = groupEpisodes(s.embeds);
  if (eps.length !== s.episodeCount) { rangeOk = false; detail ||= `${s.id}: episodeCount mismatch`; continue; }
  for (let i = 1; i < eps.length; i += 1) {
    if (eps[i].episode <= eps[i - 1].episode) { rangeOk = false; detail ||= `${s.id}: episodes out of order`; }
  }
  const flat = eps.reduce((n, e) => n + e.embeds.length, 0);
  if (flat !== s.embeds.length) { rangeOk = false; detail ||= `${s.id}: ${flat}/${s.embeds.length} embeds lost`; }
}
check('episodes ordered, counted, none lost', rangeOk, detail || `${series.length} series`);

const wrongOpen = series.filter((s) => {
  const eps = groupEpisodes(s.embeds);
  const lowest = Math.min(...eps.map((e) => e.episode));
  return Number(s.embeds[0]?.episode) !== lowest
    || String(s.embeds[0]?.quality).toLowerCase() !== '1080p';
});
check('player opens on the earliest episode at 1080p', wrongOpen.length === 0,
  wrongOpen.map((s) => s.id).join(', ') || 'all series');

check('embed urls are vault-canonical',
  records.every((r) => r.embeds.every((e) => /^https:\/\/play\.onestream\.today\/stream\/page\/\d+$/.test(e.url))));

const chips = series.length ? groupEpisodes(series[0].embeds).slice(0, 2).map(episodeLabel).join(' ') : '';
if (chips) console.log(`\n  sample episode labels: ${chips} …`);

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
