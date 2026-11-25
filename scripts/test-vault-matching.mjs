import assert from 'node:assert/strict';
import { matchVaultMovie, vaultTitleKey } from '../lib/vaultMatch.js';
import { normalizeVaultMovie } from '../lib/vault.js';
import { vaultCategory, vaultSearchMatch } from '../lib/vaultBrowse.js';
const raw={id:'local-film',title:'Local Name',year:2023,tmdbId:42,tmdbTitle:'Canonical Name',originalYear:2022,
 originalLanguage:'ml',category:'tamil-dubbed-movie',categorySource:'tmdb',embeds:[{quality:'1080p',url:'https://example.test/film'}],
 metadataVerification:{status:'verified',reason:'title-and-source-credits',checkedAt:'2026-11-13T00:00:00Z'}};
const movie=normalizeVaultMovie(raw);
assert.equal(vaultSearchMatch(movie, 'Canonical Name 2022'), true);
assert.equal(vaultSearchMatch({ title: 'தமிழ்' }, 'தமிழ்'), true);
assert.equal(movie.originalTitle,'Canonical Name');assert.equal(movie.originalYear,2022);assert.equal(movie.originalLanguage,'ml');
assert.equal(vaultCategory(movie),'tamil-dubbed-movie');
assert.equal(matchVaultMovie([movie],{title:'Canonical Name',year:2022,type:'movie'}).id,raw.id);
assert.notEqual(vaultTitleKey('தமிழ்'),'');assert.notEqual(vaultTitleKey('2.0'),vaultTitleKey('20'));
assert.equal(vaultTitleKey('Mr. & Mrs. Smith'),vaultTitleKey('Mr and Mrs Smith'));
assert.equal(matchVaultMovie([{id:'one',title:'Same',year:2020},{id:'two',title:'Same',year:2020}],{title:'Same',year:2020}),null);
const series=[{id:'s1',title:'Show S1',kind:'series',year:2020,tmdbId:123,embeds:[{season:1,episode:1}]},
 {id:'s2',title:'Show S2',kind:'series',year:2026,tmdbId:123,embeds:[{season:2,episode:1}]}];
assert.equal(matchVaultMovie(series,{type:'series',tmdbId:123}).id,'s2');
assert.equal(matchVaultMovie(series,{type:'series',tmdbId:123,season:1}).id,'s1');
assert.equal(matchVaultMovie(series,{type:'movie',tmdbId:123}),null);
assert.equal(vaultCategory(normalizeVaultMovie({id:'unknown',title:'Known-looking name',category:'tamil-movie',tmdbId:42,embeds:[]})),'tamil-movie');
assert.equal(vaultCategory({...movie,category:'tamil-movie'}),'tamil-dubbed-movie');
console.log('PASS canonical aliases/original year, Unicode, type/season matching, ambiguity and honest unverified classification');

assert.equal(vaultCategory({kind:'series',pageUrl:'https://isaidub.green/local-name/',category:'tamil-series'}),'tamil-dubbed-series');
assert.equal(vaultCategory({kind:'movie',pageUrl:'https://moviesda36.com/local/',category:'tamil-dubbed-movie'}),'tamil-movie');
assert.equal(vaultCategory({kind:'series',originalLanguage:'hi',pageUrl:'https://moviesda36.com/local/'}),'tamil-dubbed-series');
