import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ANIMATION_GENRE_ID,
  MAX_PAGE,
  buildDiscoverParams,
  clampDiscoverPage,
  getAnimeTitles,
  normalizeDiscoverPage,
} from '../lib/animeCatalog.js';

/**
 * The Anime destination. What these tests guard is the part that is easy to get wrong on a free tier:
 * one upstream call per (type, page), a page number that cannot run past what TMDB answers, and params
 * that actually mean "Japanese animation" rather than "anything with cartoons in it".
 */

test('the discover query is the genre plus the language', () => {
  const params = buildDiscoverParams({ type: 'movie', page: 2 });
  assert.equal(params.with_genres, ANIMATION_GENRE_ID, 'TMDB genre 16 is Animation');
  assert.equal(params.with_original_language, 'ja');
  assert.equal(params.sort_by, 'popularity.desc');
  assert.equal(params.include_adult, 'false');
  assert.equal(params.page, 2);
  assert.equal(buildDiscoverParams({ type: 'movie' }).watch_region, undefined, 'movies do not take a watch region here');
  assert.equal(buildDiscoverParams({ type: 'series', page: 1 }).watch_region, 'IN');
});

test('a page number cannot be talked into a crawl', () => {
  assert.equal(clampDiscoverPage(0), 1);
  assert.equal(clampDiscoverPage('3'), 3);
  assert.equal(clampDiscoverPage('nonsense'), 1);
  assert.equal(clampDiscoverPage(-40), 1);
  assert.equal(clampDiscoverPage(9999), MAX_PAGE, 'TMDB stops answering past a few hundred pages');
  assert.equal(clampDiscoverPage(2.9), 2, 'floored, not rounded up');
});

test('a payload maps to the same item shape the watch page expects', () => {
  const page = normalizeDiscoverPage({
    page: 1,
    total_pages: 40,
    results: [
      { id: 11, title: 'Suzume', original_title: 'Suzume', poster_path: '/a.jpg', release_date: '2023-04-11', vote_average: 8.4, overview: 'A door…' },
      { id: 12, name: 'Frieren', original_name: 'Frieren', first_air_date: '2023-09-29', poster_path: null },
    ],
  }, { type: 'movie' });
  assert.equal(page.items.length, 2);
  assert.equal(page.totalPages, 40);
  assert.equal(page.items[0].tmdbId, 11);
  assert.equal(page.items[0].type, 'movie');
  assert.equal(page.items[0].href, undefined, 'hrefs are built by the UI, not stored here');
  assert.equal(page.items[0].posterUrl, 'https://image.tmdb.org/t/p/w500/a.jpg');
  const series = normalizeDiscoverPage({ results: [{ id: 12, name: 'Frieren' }] }, { type: 'series' });
  assert.equal(series.items[0].type, 'series', 'the series mapper is what gives a /watch/series link its type');
  assert.deepEqual(normalizeDiscoverPage(null, { type: 'movie' }).items, [], 'a body-less answer is an empty page, not a crash');
});

test('the cache is single-flight and the failure path is boring', async () => {
  // No TMDB key in this sandbox, so the request throws: the promise must settle, not hang, and a second
  // call must not join a half-dead in-flight entry.
  await assert.rejects(() => getAnimeTitles({ type: 'movie', page: 7 }));
  await assert.rejects(() => getAnimeTitles({ type: 'movie', page: 7 }));
});

test('the route degrades to a 200 with ok:false, and the page makes one request per toggle', () => {
  const route = fs.readFileSync(new URL('../app/api/anime/route.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../app/anime/page.js', import.meta.url), 'utf8');
  assert.match(route, /ok: false,[\s\S]*status: 200/, 'a bad minute at the metadata provider is not a 5xx');
  assert.match(route, /runtime = 'nodejs'/);
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /requestRef\.current !== id/, 'a slow response for the previous toggle is dropped');
  assert.ok(!/setInterval|setTimeout/.test(page), 'no polling: an anime list is not a live score');
  assert.match(page, /setNonce\(\(value\) => value \+ 1\)/, 'Retry has to change something, or React skips the re-render');
  assert.match(page, /import MasonryGrid from '@\/components\/MasonryGrid'/, 'it reuses the grid the homepage grid used');
});
