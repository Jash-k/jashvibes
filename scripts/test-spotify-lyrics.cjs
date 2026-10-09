// Metadata/route regression. Lyrics text below is a fixture, not a bundled lyric database.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
(async () => {
  const matcherURL = url(fs.readFileSync(path.join(root, 'lib/lyricsMatch.js'), 'utf8'));
  const { lyricRequestMetadata, lyricAlbum, lyricIdentity, chooseLyricMatch, LYRICS_MATCH_VERSION } = await import(matcherURL);
  const title = 'Vandikkaran Sontha (From "Managara Kaval")';
  const record = { id:36408300, trackName:'Vandikkaran Sontha', artistName:'Vaali, Chandrabose, S. P. Balasubrahmanyam, S.P. Sailaja', albumName:'Managara Kaval', duration:299, plainLyrics:'FIXTURE TEXT', syncedLyrics:'[00:48.36] FIXTURE TEXT' };
  const original = { title, spotify:{ title, artists:['S. P. Balasubrahmanyam', 'S. P. Sailaja'], album:title, durationMs:299000 } };
  const metadata = lyricRequestMetadata({ title, artists:'S.P.Balasubrahmanyam, S. P. Sailaja', album:title, duration:299 }, original);
  assert.equal(metadata.album, 'Managara Kaval');
  assert.equal(lyricAlbum('Managara Kaval (Original Motion Picture Soundtrack)'), 'Managara Kaval');
  assert.equal(lyricRequestMetadata({ title:title.replaceAll('"', '&quot;'), artists:'S.P.Balasubrahmanyam', duration:299 }).album, 'Managara Kaval');
  assert(lyricIdentity(record, metadata).ok);
  assert(lyricIdentity(record, { ...metadata, duration:0 }).ok, 'full artist plus film match permits missing duration');
  for (const bad of [ { ...record, trackName:'Another song' }, { ...record, albumName:'Another film' }, { ...record, duration:330 } ]) assert(!lyricIdentity(bad, metadata).ok);
  assert(!lyricIdentity(record, { ...metadata, artist:'S. P.', duration:0 }).ok, 'partial singer name is not enough');
  assert.equal(chooseLyricMatch([record], metadata).id, 36408300);
  assert.equal(lyricRequestMetadata({ title, artists:'Singer', album:'Conflicting Film', duration:299 }, original).album, 'Conflicting Film');
  assert(!lyricIdentity(record, lyricRequestMetadata({ title, artists:'Singer', album:'Conflicting Film', duration:299 }, original)).ok);
  let source = fs.readFileSync(path.join(root, 'app/api/music/lyrics/route.js'), 'utf8')
    .replace("'@/lib/lyricsMatch'", JSON.stringify(matcherURL))
    .replace("'@/lib/musicSources'", JSON.stringify(url(fs.readFileSync(path.join(root, 'lib/musicSources.js'), 'utf8'))))
    .replace("import { NextResponse } from 'next/server';", 'const NextResponse = { json: body => body };');
  const realFetch = global.fetch, calls = [];
  global.fetch = async input => {
    const u = new URL(input); calls.push(u);
    const body = u.pathname === '/api/get' ? null : [record];
    return { ok:true, status:200, headers:new Headers(), json:async () => body };
  };
  try {
    const { GET } = await import(url(source));
    const params = new URLSearchParams({ title, album:title, artist:'S.P.Balasubrahmanyam', duration:'299', skipSaavn:'1' });
    const result = await GET(new Request('http://fixture/api/music/lyrics?' + params));
    assert.equal(result.matched.id, 36408300); assert.equal(result.matchVersion, LYRICS_MATCH_VERSION);
    assert.equal(calls[0].searchParams.get('track_name'), 'Vandikkaran Sontha');
    assert.equal(calls[0].searchParams.get('album_name'), 'Managara Kaval');
    const rejected = await GET(new Request('http://fixture/api/music/lyrics?' + params + '&exclude=36408300&force=1'));
    assert.equal(rejected.source, 'none'); assert.equal(rejected.lyrics, '');
    // Album-only search may miss soundtrack-tagged records. Title-only retrieval still requires exact identity.
    calls.length = 0;
    global.fetch = async input => { const u = new URL(input); calls.push(u); return { ok:true, status:200, headers:new Headers(), json:async () => u.pathname === '/api/search' && !u.searchParams.has('album_name') ? [{ ...record, id:10385047, albumName:'Managara Kaval (Original Motion Picture Soundtrack)' }] : null }; };
    const fallback = await GET(new Request('http://fixture/api/music/lyrics?' + params + '&force=1'));
    assert.equal(fallback.matched.id, 10385047); assert.equal(calls.length, 3);
  } finally { global.fetch = realFetch; }
  const engine = fs.readFileSync(path.join(root, 'components/music/MusicEngine.jsx'), 'utf8');
  assert(engine.includes('lyricRequestMetadata(lyricDetail || active || {}, active || {})'));
  assert(engine.includes('spotify: track.spotify || null'));
  console.log('PASS Spotify film suffix/entity cleanup, preserved metadata, artist initials, strict identity guards, LRCLIB retrieval, rejection exclusions and cache-version invalidation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
