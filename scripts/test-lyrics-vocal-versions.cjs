// Representative public catalogue metadata; synthetic text, no bundled copyrighted lyrics.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), asURL = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
(async () => {
  const matcherURL = asURL(fs.readFileSync(path.join(root, 'lib/lyricsMatch.js'), 'utf8'));
  const { chooseLyricMatch, lyricIdentity, lyricVocalVersion, LYRICS_MATCH_VERSION } = await import(matcherURL);
  const wanted = { title: 'Parthu Parthu M', artist: 'S.A. Rajkumar, Vaikudavaasan, Vijay P., R. Parthiban, Ajith Kumar, Devaiyani, R. Parthiepan', album: 'Nee Varuvaai Enaa', duration: 272 };
  const male = { id: 13119036, trackName: 'Parthu Parthu (Male)', artistName: 'S. P. Balasubrahmanyam', albumName: 'Nee Varuvaai Ena (Original Motion Picture Soundtrack)', duration: 272, plainLyrics: 'MALE FIXTURE', syncedLyrics: '[00:00]MALE FIXTURE' };
  const female = { ...male, id: 10753037, trackName: 'Parthu Parthu (Female)', artistName: 'K.S. Chitra', plainLyrics: 'FEMALE FIXTURE', syncedLyrics: '' };
  const unmarked = { ...male, id: 10753038, trackName: 'Parthu Parthu' };
  const otherMale = { ...male, id: 14299759, trackName: 'Parthu Parthu - Male Vocals' };
  const rows = [female, unmarked, otherMale, male];
  assert.equal(chooseLyricMatch(rows, wanted).id, male.id);
  assert.equal(chooseLyricMatch([...rows].reverse(), wanted).id, male.id, 'stable tie-break across provider ordering');
  assert.equal(chooseLyricMatch(rows, { ...wanted, title: 'Parthu Parthu F' }).id, female.id);
  assert.equal(chooseLyricMatch([unmarked, female], wanted), null, 'M never silently becomes unversioned or female');
  assert.equal(chooseLyricMatch([male], { ...wanted, title: 'Parthu Parthu F' }), null);
  for (const title of ['Parthu Parthu M', 'Parthu Parthu (M)', 'Parthu Parthu - Male', 'Parthu Parthu (Male)', 'Parthu Parthu - Male Vocals', 'Parthu Parthu (Male Vocals)', 'Parthu Parthu M (From "Nee Varuvaai Enaa")']) {
    assert(lyricIdentity(male, { ...wanted, title }).ok, title);
    assert(!lyricIdentity(female, { ...wanted, title }).ok, title);
  }
  for (const changed of [{ album: '' }, { album: 'Another Movie' }, { album: 'Nee Varuvai Ena' }, { duration: 0 }, { duration: 275 }, { title: 'Parthu Parthu Remix M' }, { title: 'Parthu Parthu m' }])
    assert(!lyricIdentity(male, { ...wanted, ...changed }).ok, JSON.stringify(changed));
  for (const changed of [{ albumName: '' }, { albumName: 'Another Movie' }, { duration: 0 }, { duration: 275 }, { trackName: 'Parthu Parthu (Female)' }, { trackName: 'Parthu Parthu (Male) Remix' }, { trackName: 'Parthu Parthu M' }])
    assert(!lyricIdentity({ ...male, ...changed }, wanted).ok, JSON.stringify(changed));
  assert(lyricIdentity(unmarked, { ...wanted, title: 'Parthu Parthu', album: 'Nee Varuvaai Ena' }).ok, 'unversioned exact behavior unchanged');
  assert(!lyricIdentity(unmarked, { ...wanted, title: 'Parthu Parthu' }).ok, 'album relaxation is not global');
  assert.equal(lyricVocalVersion('M'), null);
  assert.equal(lyricVocalVersion('Song Remix'), null);
  assert.equal(lyricVocalVersion('Song (Female)').version, 'female');
  assert(!lyricIdentity({ ...male, trackName: 'Dial' }, { ...wanted, title: 'Dial M' }).ok);

  let source = fs.readFileSync(path.join(root, 'app/api/music/lyrics/route.js'), 'utf8')
    .replace("'@/lib/lyricsMatch'", JSON.stringify(matcherURL))
    .replace("'@/lib/musicSources'", JSON.stringify(asURL(fs.readFileSync(path.join(root, 'lib/musicSources.js'), 'utf8'))))
    .replace("import { NextResponse } from 'next/server';", 'const NextResponse = { json: body => body };');
  const realFetch = global.fetch, calls = [];
  global.fetch = async input => {
    const url = new URL(input); calls.push(url);
    const exact = url.pathname === '/api/get';
    const body = exact ? null : url.searchParams.get('track_name') === 'Parthu Parthu' && !url.searchParams.get('album_name') ? rows : [];
    return { ok: !exact, status: exact ? 404 : 200, headers: new Headers(), json: async () => body };
  };
  try {
    const { GET } = await import(asURL(source));
    const params = new URLSearchParams({ ...wanted, duration: String(wanted.duration), skipSaavn: '1' });
    const req = new Request('http://fixture/api/music/lyrics?' + params);
    const result = await GET(req);
    assert.equal(result.matched.id, male.id); assert.equal(result.matchVersion, LYRICS_MATCH_VERSION);
    assert.equal(calls.length, 3); assert.equal(calls[0].searchParams.get('track_name'), wanted.title);
    assert.equal(calls[1].searchParams.get('track_name'), 'Parthu Parthu'); assert.equal(calls[2].searchParams.has('album_name'), false);
    const forced = await GET(new Request(req.url + '&source=lrclib')); assert.equal(forced.matched.id, male.id);
    const rejected = await GET(new Request(req.url + '&exclude=13119036,14299759&force=1')); assert.equal(rejected.source, 'none');
    const list = await GET(new Request(req.url + '&list=1')); assert.equal(list.sources.find(s => s.id === 'lrclib').ok, true);
  } finally { global.fetch = realFetch; }
  console.log('PASS vocal-version aliases, Enaa/Ena scoped film match, male/female separation at equal duration, unmarked rejection, missing evidence, stable ranking, search retrieval, exclusions and source paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
