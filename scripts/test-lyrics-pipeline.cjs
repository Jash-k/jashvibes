const fs=require('node:fs'),assert=require('node:assert/strict');
const load=p=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(p)).toString('base64'));
(async()=>{
 const m=await load('lib/lyricsMatch.js');
 assert.equal(m.LYRICS_MATCH_VERSION,5);
 const song={title:'Nenjukkul Peidhidum',artist:'Harris Jayaraj',album:'Vaaranam Aayiram',duration:295};

 // ── the old bug: no album must still be able to match on title+artist+duration
 const noAlbum={trackName:'Nenjukkul Peidhidum',artistName:'Harris Jayaraj',albumName:'',duration:295,plainLyrics:'x'};
 assert.equal(m.lyricIdentity(noAlbum,{...song,album:''}).ok,true,'title+artist+duration must match without an album');
 assert.equal(m.lyricIdentity(noAlbum,{...song,album:''}).tier,'artist-duration');

 // ── tiered acceptance: title+artist+album agree, duration differs (radio edit)
 const edit={trackName:'Nenjukkul Peidhidum',artistName:'Harris Jayaraj',albumName:'Vaaranam Aayiram',duration:283,syncedLyrics:'[00:01.00] a'};
 const judged=m.lyricIdentity(edit,song);
 assert.equal(judged.ok,true); assert.equal(judged.tier,'strong');
 // but a remix-album record with a wildly different length is refused
 assert.equal(m.lyricIdentity({...edit,duration:120},song).ok,false);
 assert.equal(m.lyricIdentity({...edit,duration:120},song).reason,'duration-mismatch');

 // ── album+duration without matching artist credits (composer vs singer)
 const credits={trackName:'Nenjukkul Peidhidum',artistName:'Hariharan',albumName:'Vaaranam Aayiram',duration:296,plainLyrics:'x'};
 assert.equal(m.lyricIdentity(credits,song).tier,'album-duration');

 // ── rejections keep their reason and never fall through to a different song
 assert.equal(m.lyricIdentity({trackName:'Other Song',artistName:'Harris Jayaraj',albumName:'Vaaranam Aayiram',duration:295,plainLyrics:'x'},song).reason,'title-mismatch');
 assert.equal(m.lyricIdentity({trackName:'Nenjukkul Peidhidum',artistName:'Someone Else',albumName:'Other Album',duration:295,plainLyrics:'x'},song).reason,'artist-mismatch');
 // an instrumental row or a row with no text at all is never shown as lyrics
 assert.equal(m.chooseLyricMatch([{...edit,instrumental:true,plainLyrics:'',syncedLyrics:''}],song),null);
 assert.equal(m.chooseLyricMatch([{...edit,plainLyrics:'',syncedLyrics:''}],song),null);
 // M/F versions may share a duration to the second — always refused when they disagree
 const male={title:'Parthu Parthu (Male)',artist:'A',album:'B',duration:200};
 assert.equal(m.lyricIdentity({trackName:'Parthu Parthu (Female)',artistName:'A',albumName:'B',duration:200,plainLyrics:'x'},male).reason,'vocal-version-mismatch');
 // the documented alias case: '(M)' on one side, '- Male' on the other, album+duration agreeing
 const maleShort={title:'Parthu Parthu (M)',artist:'A',album:'B',duration:200};
 assert.equal(m.lyricIdentity({trackName:'Parthu Parthu - Male',artistName:'A',albumName:'B',duration:201,plainLyrics:'x'},maleShort).tier,'vocal-alias');
 // an unmarked catalogue title is NOT upgraded into a versioned one: it is a different record than the (Male) cut
 assert.equal(m.lyricIdentity({trackName:'Parthu Parthu',artistName:'A',albumName:'B',duration:200,plainLyrics:'x'},male).ok,false);

 // ── retrieval variants cover the spellings catalogue metadata produces
 const variants=m.lyricSearchVariants({title:'Vandikkaran Sontha (From "Managara Kaval")',album:'Managara Kaval'});
 assert.ok(variants.includes('Vandikkaran Sontha'));
 const withMarker=m.lyricSearchVariants({title:'Po Nee Po - Male Vocals',album:''});
 assert.ok(withMarker.includes('Po Nee Po'));
 assert.ok(withMarker.some(v=>/^po nee po$/i.test(v)));

 // ── ranking prefers the strongest tier and the closest duration
 const picked=m.chooseLyricMatch([
  {id:3,trackName:'Nenjukkul Peidhidum',artistName:'Harris Jayaraj',albumName:'Vaaranam Aayiram',duration:120,plainLyrics:'x'},
  {id:4,trackName:'Nenjukkul Peidhidum',artistName:'Someone',albumName:'Vaaranam Aayiram',duration:295,plainLyrics:'x'},
  {id:5,trackName:'Nenjukkul Peidhidum',artistName:'Harris Jayaraj',albumName:'Vaaranam Aayiram',duration:295,syncedLyrics:'[00:01.00] x'},
 ],song);
 assert.equal(picked.id,5,'the fully agreeing, timed record must win');
 assert.equal(m.chooseLyricMatch([{id:9,trackName:'Another',artistName:'X',albumName:'',duration:1,plainLyrics:'x'}],song),null);

 // ── the cache key is stable, version-scoped and ignores formatting noise
 const a=m.lyricCacheKey({title:'Nenjukkul Peidhidum (From "Vaaranam Aayiram")',artist:'Harris  Jayaraj',album:'Vaaranam Aayiram',duration:295.4,id:'abc123'});
 const b=m.lyricCacheKey({title:'nenjukkul peidhidum',artist:'harris jayaraj',album:'Vaaranam Aayiram',duration:294.6,id:'abc123'});
 assert.equal(a,b,'formatting and sub-2s duration noise must not split the cache');
 assert.ok(a.startsWith('5|'));

 // ── one wired source, and the route actually implements the ladder
 const sources=await load('lib/musicSources.js');
 assert.deepEqual(sources.WIRED_LYRICS_SOURCES,['lrclib']);
 const route=fs.readFileSync('app/api/music/lyrics/route.js','utf8');
 for(const needle of ["'/api/get'","track_name: variant","q: wanted.album ?","Lyrics queue is busy","Retry-After"])assert.ok(route.includes(needle),`route must keep ${needle}`);
 assert.ok(!/saavn/i.test(route),'the lyrics route must no longer call Saavn');
 assert.ok(route.includes('readLyricsOverride')&&route.includes('readLyricsCache')&&route.includes('writeLyricsCache'));
 const store=fs.readFileSync('lib/lyricsStore.js','utf8');
 for(const fn of ['readLyricsOverride','saveLyricsOverride','readLyricsCache','writeLyricsCache','listLyricsMisses'])assert.ok(store.includes(`export async function ${fn}`));
 assert.ok(store.includes("catch { return null; }"),'cache/override reads must fail soft so lyrics still load without MongoDB');
 const admin=fs.readFileSync('app/api/admin/lyrics/route.js','utf8');
 assert.ok(admin.includes('await adminDeny(request)'));
 const screen=fs.readFileSync('components/music/CanvasLyrics.jsx','utf8');
 for(const needle of ['Paste lyrics','Edit my lyrics','not-in-catalogue','identity-rejected','Saved on this device'])assert.ok(screen.includes(needle),`lyric screen must offer ${needle}`);
 const engine=fs.readFileSync('components/music/MusicEngine.jsx','utf8');
 assert.ok(!engine.includes('detailSettledFor'),'lyrics must not wait for the song-detail request');
 console.log('Lyrics pipeline: tiered acceptance, album-less matching, rejection reasons, retrieval variants, ranking, stable cache keys, single-source wiring, ladder, store, admin gate and screen recovery all passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
