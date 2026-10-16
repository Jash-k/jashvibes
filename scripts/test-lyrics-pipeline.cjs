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

 // ── the picker's title rule: the same song, allowing for a version suffix, never a fragment
 assert.equal(m.lyricSameTitle('Kannana Kanne (Female)','Kannana Kanne'),true,'a version suffix must still be the same song');
 assert.equal(m.lyricSameTitle('Kannana Kanne - Live','Kannana Kanne'),true,'a live cut must be offered');
 assert.equal(m.lyricSameTitle('Kannana Kanne (From "Naanum Rowdydhaan")','Kannana Kanne'),true,'the film name in brackets must not hide a record');
 assert.equal(m.lyricSameTitle('Kanna','Kannana Kanne'),false,'a fragment of the title is a different song, not a version');
 assert.equal(m.lyricSameTitle('Naanum Rowdydhaan Theme','Kannana Kanne'),false,'an unrelated free-text hit must never reach the list');

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
 for(const needle of ['not-in-catalogue','identity-rejected','Paste the lyrics for','retry={() => music.openLyrics(true)}'])assert.ok(screen.includes(needle),`lyric screen must still handle ${needle}`);
 const engine=fs.readFileSync('components/music/MusicEngine.jsx','utf8');
 assert.ok(!engine.includes('detailSettledFor'),'lyrics must not wait for the song-detail request');

 // ── the picker: every record is listed, and a choice is saved as the owner's lyrics ──
 // "Wrong lyrics?" used to reject one record on one device and hope the retry picked better. The
 // picker instead shows what the provider actually has and saves the pick for everyone, so the
 // single-winner matcher must hand over the records it loses as well.
 assert.ok(route.includes('collect = null'),'findLyrics must accept a collector');
 assert.ok(route.includes('if (collect) for (const row of items) collect(row, label, wanted);'),
  'every record the provider returned on a stage must reach the collector, not only the winner');
 assert.ok(route.includes("searchParams.get('candidates') === '1'")&&route.includes("searchParams.get('reload') === '1'"),
  'the list asks for candidates, and a reload skips the cached provider answer');
 assert.ok(route.includes('if (!force && !reload) {'),'a reload must not re-pick the automatic match');
 assert.ok(route.includes('collectCandidates')&&route.includes('savedId'),
  'the list must mark the automatic match and the record the saved choice came from');

 // ── the panel: one word of chrome, a list, and a tick that writes ──
 assert.ok(screen.includes('className="mc-lyric-available"')&&screen.includes('<span>Available</span>'),
  'the records open from a single "Available" control');
 assert.ok(screen.includes('aria-expanded={open}'),'the control must report whether the list is open');
 assert.ok(screen.includes('mc-lyric-pop')&&screen.includes('mc-lyric-option')&&screen.includes('recordLine(candidate, wanted)'),
  'every record must be listed by title, in a list rendered inside the panel');
 assert.ok(screen.includes("name={candidate.synced ? 'wave' : 'text'}"),
  'whether a record carries timings must be a symbol, not a sentence');
 assert.ok(!/<select[^>]*picker/i.test(screen),'the record list is not a native select: it must render on a phone too');
 assert.ok(!screen.includes('candidateLabel'),'no option may be labelled by an opaque id');
 assert.ok(screen.includes('onClick={() => setPicked(candidate.id)}'),
  'choosing a row must only mark it — nothing is saved by looking');
 assert.ok(screen.includes('onClick={commit}')&&screen.includes('disabled={!picked || picking || picked === currentId}'),
  'the tick is the only thing that writes, and it waits for a real choice');
 assert.ok((screen.match(/action: 'choose'/g)||[]).length===1,'exactly one call may save a choice');
 assert.ok(screen.includes('is-current')&&screen.includes("picker.current === 'saved' ? (picker.savedId || '') : picker.autoId"),
  'the record in use must be marked, without a word');

 // ── no wording: the panel is for reading, so only content and one label remain ──
 const screenCode=screen.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
 assert.ok(!screenCode.includes('Wrong lyrics?')&&!screenCode.includes('rejectLyrics'),
  'the device-level rejection must be gone from the panel');
 // (The paste form keeps its own help line about where a paste is saved: that is a form, not chrome.)
 for(const retired of ['Saved for everyone','Remove my lyrics','Edit my lyrics','records available','showing now','Looking for other versions','Tap a line to seek','Timing is not available','Resume follow','Your lyrics','Plain lyrics','Automatic — let the app match it again','Saved lyrics — pick','Only one record exists'])
  assert.ok(!screenCode.includes(retired),`the panel must not print “${retired}” any more`);
 const footer=screenCode.slice(screenCode.indexOf('<footer>'),screenCode.indexOf('</footer>'));
 assert.ok(footer.includes('IconButton'),'the footer is a row of symbols');
 assert.ok(!/>[A-Za-z][^<>{}]*</.test(footer),'the footer must print no words at all');
 assert.ok(screenCode.includes('<h2>Lyrics</h2>'),'the panel keeps its one heading, without a status tag');

 const canvasCss=fs.readFileSync('components/music/music-canvas.css','utf8');
 assert.ok(/\.mc-lyrics \{[^}]*position:relative/.test(canvasCss),'the panel must anchor its own list');
 assert.ok(/\.mc-lyric-pop \{[^}]*position:absolute/.test(canvasCss)&&/\.mc-lyric-pop \{[^}]*max-height:calc\(100% - \d+px\)/.test(canvasCss),
  'the list opens inside the panel: never clipped by it, never floating over another section');
 assert.ok(!canvasCss.includes('.mc-picker'),'the footer select and its rules must be gone');
 assert.ok(canvasCss.includes('.mc-app.is-pocket .mc-lyric-pop'),
  'a list left open must not stay sharp and live under the touch lock');
 assert.ok(/\.mc-lyric-option \{[^}]*min-height:44px/.test(canvasCss),'rows must stay thumb-sized on a phone');
 assert.ok(engine.includes('rejectLyrics'),'the engine keeps the rejection path for callers that still refuse a record');
 // The panel deliberately offers no way back: the owner asked for no words and no extra buttons,
 // so a saved choice is changed by choosing another record and undone from the admin Lyrics tab.
 assert.ok(!screen.includes("choose('auto')")&&!screen.includes("action: 'clear'"),
  'the panel must not carry a reset control it was asked not to show');
 assert.ok(engine.includes('reloadLyrics')&&engine.includes('lyricSong'),'the engine must expose a reload and the song identity');
 assert.ok(fs.readFileSync('lib/lyricsController.js','utf8').includes("reload = false"),'the controller must support the reload that re-reads saved lyrics');

 const post=route.slice(route.indexOf('export async function POST'));
 assert.ok(post.includes("body.action === 'clear'")&&post.includes("body.action !== 'choose'"),
  'the picker needs both directions: choose and clear');
 assert.ok(post.includes('fetchRecordById'),'the lyrics text must be re-read from the provider, never trusted from the browser');
 assert.ok(!/body\.syncedLyrics|body\.plainLyrics/.test(post),'no lyrics text may arrive in the request body');
 assert.ok(post.includes('saveLyricsOverride')&&post.includes("origin: 'user'"),'a choice is saved through the store the admin panel uses');
 assert.ok(post.includes('recordAction')&&post.includes("area: 'lyrics'"),'a choice must be audited like every other write');
 assert.ok(post.includes('lyricsSnapshot'),'the audit entry must carry the before and after lyrics');
 assert.ok(post.includes('isAuthorized(request)'),'writing lyrics is an owner action');

 console.log('Lyrics pipeline: tiered acceptance, album-less matching, rejection reasons, retrieval variants, ranking, stable cache keys, single-source wiring, ladder, store, admin gate and screen recovery, plus the record list (every candidate collected, one word of chrome, rows that only mark a choice, a tick that writes it, no printed wording, and a list that renders inside the panel on every screen) all passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
