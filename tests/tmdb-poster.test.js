/*
 * tests/tmdb-poster.test.js — the catalogue was shipping 500-px originals into
 * 128-px cards. The srcset helper must rebuild TMDB sizes from the URL the
 * server already sent, and must leave every non-TMDB URL (Saavn covers, anime
 * source art, channel logos) exactly alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKDROP_SRCSET_SIZES,
  POSTER_SRCSET_SIZES,
  parseTmdbImageUrl,
  tmdbImageAtSize,
  tmdbImageSrcSet,
} from '../lib/tmdbPoster.js';

const POSTER = 'https://image.tmdb.org/t/p/w500/abc123.jpg';
const STILL = 'https://image.tmdb.org/t/p/w300/def456.jpg';

test('a TMDB URL splits into prefix + path regardless of its current size', () => {
  const poster = parseTmdbImageUrl(POSTER);
  assert.deepEqual(poster, { prefix: 'https://image.tmdb.org/t/p/', path: '/abc123.jpg' });
  const still = parseTmdbImageUrl(STILL);
  assert.equal(`${still.prefix}w500${still.path}`, 'https://image.tmdb.org/t/p/w500/def456.jpg');
});

test('non-TMDB URLs do not parse, rewrite, or produce a srcset', () => {
  const foreigners = [
    '',
    null,
    'https://example.com/cover.jpg',
    'https://scdn.saavn.co/727x727/album.jpg',
    'https://piratexplay.cc/posters/one-piece.jpg',
    'https://evil.com/x?u=https://image.tmdb.org/t/p/w500/a.jpg', // host is not TMDB
  ];
  for (const url of foreigners) {
    assert.equal(parseTmdbImageUrl(url), null, String(url));
    assert.equal(tmdbImageAtSize(url, 'w185'), url || '');
    assert.equal(tmdbImageSrcSet(url), '');
  }
});

test('the srcset ladder is smallest-first with widths', () => {
  const srcset = tmdbImageSrcSet(POSTER);
  const entries = srcset.split(', ').map((entry) => entry.split(' '));
  assert.deepEqual(entries.map(([, width]) => width), ['185w', '342w', '500w', '780w']);
  assert.match(srcset, /\/t\/p\/w185\/abc123\.jpg 185w/);
  assert.ok(srcset.indexOf('185w') < srcset.indexOf('780w'));
});

test('backdrop ladders can reach the original', () => {
  const srcset = tmdbImageSrcSet(POSTER, BACKDROP_SRCSET_SIZES);
  assert.match(srcset, /\/t\/p\/original\/abc123\.jpg original/);
});

test('the shipped poster ladder matches the card math', () => {
  // Grid cards are ~230 px at 1x and the library rails are 128 px — w185
  // through w780 covers up to 3x on the rails and 2x+ on the grid; the point
  // is that the 500-px default never travels alone again.
  assert.deepEqual(POSTER_SRCSET_SIZES, ['w185', 'w342', 'w500', 'w780']);
});
