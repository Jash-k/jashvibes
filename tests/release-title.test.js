import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { humaniseSlugText, looksLikeHumanTitle, slugToTitle } from '../lib/releaseTitle.js';

/**
 * The forum is the source of truth for titles, and a forum title is a release name: dot-separated,
 * camel-humped, bracket-tagged. The old parser split only on '-', so
 * `ImmortalCombat.2025.[Tamil].1080p.WEB-DL` arrived in the catalog as one glued word — and because
 * the TMDB normaliser removes punctuation but cannot invent a space, that row could never be matched,
 * never get a poster, and never be corrected.
 */

test('a release slug becomes words, not one glued token', () => {
  assert.equal(
    slugToTitle('401234-ImmortalCombat.2025.[Tamil].1080p.WEB-DL.x264'),
    '401234 Immortal Combat 2025 [Tamil] 1080p WEB DL X264',
    'dots, hyphens and the camelCase hump all separate words; the year and quality tags stay for the parser to read',
  );
  assert.equal(slugToTitle('the-great-indian-kitchen-2025'), 'The Great Indian Kitchen 2025');
  assert.equal(slugToTitle('Viduthalai_Part_2'), 'Viduthalai Part 2');
});

test('acronyms and initials are not shredded', () => {
  // Splitting camelCase is about `ImmortalCombat`, not about every capital: a run of capitals stays put.
  assert.equal(humaniseSlugText('KGF-2022'), 'KGF 2022');
  assert.equal(humaniseSlugText('WEB-DL'), 'WEB DL');
  assert.equal(humaniseSlugText('K.G.F.Chapter.2'), 'K G F Chapter 2', 'dot runs between letters are separators; the match normaliser strips them anyway');
});

test('a real anchor text beats the slug, year or no year', () => {
  assert.equal(looksLikeHumanTitle('Immortal (G.V. Prakash)'), true, 'no year typed — the old rule threw this away');
  assert.equal(looksLikeHumanTitle('[1080p & 720p] [Tamil]'), false, 'pure quality noise still falls back to the slug');
  assert.equal(looksLikeHumanTitle(''), false);
  assert.equal(looksLikeHumanTitle('[HQ PreDVD]'), false);
});

test('file extensions are not part of a title', () => {
  assert.equal(humaniseSlugText('Thunivi.2025.1080p.mkv'), 'Thunivi 2025 1080p');
});

test('the scraper uses the shared parser instead of its own one-liner', () => {
  const scraper = fs.readFileSync(new URL('../lib/tamilmvScraper.js', import.meta.url), 'utf8');
  assert.match(scraper, /import \{ humaniseSlugText, looksLikeHumanTitle, slugToTitle \} from '@\/lib\/releaseTitle'/);
  assert.ok(!scraper.includes(".split('-')"), 'no local hyphen-only splitter left behind');
  assert.match(scraper, /looksLikeHumanTitle\(visible\) \? visible : slugText/, 'visible words win over the slug');
  assert.match(scraper, /humaniseSlugText\(decodeURIComponent\(hrefPath\)\)/, 'the URL text used for matching is humanised too');
});
