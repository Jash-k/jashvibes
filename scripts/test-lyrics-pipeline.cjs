const fs=require('node:fs'),assert=require('node:assert/strict');
const load=p=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(p)).toString('base64'));
(async()=>{
 const m=await load('lib/lyricsMatch.js');
 assert.equal(m.LYRICS_MATCH_VERSION,6);
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

 // ── the same credit list, written with a slash ──
 // LRCLIB joins credits with "/" where the catalogue joins them with ",". Both must be read as the
 // same list of names, or a record neither side disputes is refused for its punctuation.
 assert.equal(m.lyricIdentity({trackName:'Xyz Song',artistName:'Dhanush/ Dhee',albumName:'Album',duration:280,plainLyrics:'x'},
  {title:'Xyz Song',artist:'Dhanush, Dhee',album:'Album',duration:281}).tier,'strong',
  'a slash-joined credit list must match a comma-joined one');

 // ── the catalogue's decorations are the catalogue's, not the recording's ──
 // JioSaavn appends "(Trending Version)", "(Title Theme)", "(LoFi Mix)", "(Karaoke)", "(Reprise)",
 // "(Remix by …)" to the SAME recording, so exact-title matching refused songs whose lyrics the
 // provider's own site plainly shows. The decoration is stripped for matching — and nothing else is:
 // M/F markers, Live, Acoustic, Instrumental and language names are different recordings or
 // different words, and must survive untouched.
 assert.equal(m.lyricCatalogueTitle('Kannana Kanne (Trending Version)'),'Kannana Kanne');
 assert.equal(m.lyricCatalogueTitle('Thalli Pogathey - Lofi Mix'),'Thalli Pogathey');
 assert.equal(m.lyricCatalogueTitle('Rowdy Baby (Title Theme)'),'Rowdy Baby');
 assert.equal(m.lyricCatalogueTitle('Xyz (Karaoke)'),'Xyz');
 assert.equal(m.lyricCatalogueTitle('Xyz - Remix By Someone'),'Xyz');
 assert.equal(m.lyricCatalogueTitle('Un Paarvaiyil LoFi Mix'),'Un Paarvaiyil','a bare trailing decoration is stripped too');
 assert.equal(m.lyricCatalogueTitle('Why This Kolaveri Di? (From \"3\") (131 - 132 BPM)'),'Why This Kolaveri Di?','a tempo marker is the catalogue\'s, not the song\'s');
 assert.equal(m.lyricCatalogueTitle('Tamil Love Mix'),'Tamil Love Mix','a lone "Mix" is a real word and survives');
 assert.equal(m.lyricCatalogueTitle('Po Nee Po - Male Vocals'),'Po Nee Po - Male Vocals','M/F markers survive');
 assert.equal(m.lyricCatalogueTitle('Xyz (Instrumental)'),'Xyz (Instrumental)','an instrumental is a different recording');
 assert.equal(m.lyricCatalogueTitle('Anjaana Anjaani (Telugu)'),'Anjaana Anjaani (Telugu)','a language version is different words');
 const plainRecord={trackName:'Kannana Kanne',artistName:'Anirudh Ravichander',albumName:'Naanum Rowdy Dhaan',duration:267,syncedLyrics:'[00:01.00] x'};
 const decoratedSong={title:'Kannana Kanne (Trending Version)',artist:'Anirudh Ravichander',album:'Naanum Rowdy Dhaan',duration:266};
 const tier=m.lyricIdentity(plainRecord,decoratedSong);
 assert.equal(tier.ok,true,'a decorated catalogue title is the same recording'); assert.equal(tier.tier,'catalogue-suffix');
 assert.equal(m.lyricIdentity({...plainRecord,duration:40},decoratedSong).ok,false,'a different length still rejects');
 assert.equal(m.lyricIdentity({...plainRecord,artistName:'Someone Else',albumName:'Other Album'},decoratedSong).ok,false,
  'a decoration alone is never enough: the artist or the album must agree too');
 assert.equal(m.lyricIdentity({...plainRecord,trackName:'Kannana Kanne (Female)'},decoratedSong).ok,false,
  'a decoration never rescues a different vocal version');
 assert.equal(m.lyricIdentity(plainRecord,{...decoratedSong,title:'Kannana Kanne'}).tier,'strong',
  'an undecorated match is still the strong tier');
 assert.equal(m.chooseLyricMatch([{...plainRecord,duration:30},{...plainRecord,id:7}],decoratedSong).id,7,
  'the tier still ranks behind a length that fits');

 // ── retrieval variants cover the spellings catalogue metadata produces
 const variants=m.lyricSearchVariants({title:'Vandikkaran Sontha (From "Managara Kaval")',album:'Managara Kaval'});
 assert.ok(variants.includes('Vandikkaran Sontha'));
 assert.equal(m.lyricSearchVariants({title:'Rowdy Baby (Title Theme)',album:''})[0],'Rowdy Baby',
  'the first question must carry the catalogue-clean title, not the decorated one');
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
 assert.ok(a.startsWith('6|'));

 // ── one wired source, and the route actually implements the ladder
 const sources=await load('lib/musicSources.js');
 assert.deepEqual(sources.WIRED_LYRICS_SOURCES,['lrclib']);
 const route=fs.readFileSync('app/api/music/lyrics/route.js','utf8');
 for(const needle of ["'/api/search'","track_name: variants[0], artist_name: wanted.artist","Lyrics queue is busy","Retry-After"])assert.ok(route.includes(needle),`route must keep ${needle}`);
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
 // Round 3: one request per song. The cascade that spent a dozen calls on one song is gone, and
 // the one search that replaced it answers both halves of the screen — the record the stage shows
 // and every record the panel lists.
 assert.ok(route.includes('async function searchRecords')&&!route.includes('async function findLyrics'),
  'one search must answer a song; the staged cascade must not come back');
 // Round 4: the question order is measured, not assumed. The artist field is an AND filter and our
 // artist string is a credit list, so it must not be asked FIRST; it is the narrowing for a page
 // that yielded no acceptable record. The free-text question is earned only by an empty answer.
 assert.equal((route.match(/await ask\(/g)||[]).length,3,
  'a lookup asks at most three questions: title, title+artist, free text');
 const askOrder=route.indexOf("await ask({ track_name: variants[0] },")<route.indexOf("await ask({ track_name: variants[0], artist_name:")
  &&route.indexOf("await ask({ track_name: variants[0], artist_name:")<route.indexOf("await ask({ q:");
 assert.ok(askOrder,'title first, then the artist narrows, then the free-text question');
 assert.ok(route.includes('if (rows && rows.length && !match) {'),
  'the artist-narrowed question is asked only when the page carried no acceptable record');
 assert.ok(route.includes('if (rows && !rows.length) {')&&route.includes("await ask({ q: `${variants[0]} ${wanted.artist}`.trim() }"),
  'the free-text question is spent only on an empty answer, never on a refusal, and asks the clean title');
 assert.ok(route.includes('function mergeRows(')&&route.includes('rows = mergeRows(rows, narrowed)'),
  'both pages are kept: the narrowed call must not shrink the list');
 assert.ok(!route.includes('collectCandidates'),'the second lookup that filled the list alone is gone');
 assert.ok(route.includes('async function lookupBundle')&&route.includes('const pending = new Map()'),
  'one answer per song is kept in memory, and the call already in flight is shared');
 assert.ok(route.includes('lookupBundle({ song, title, artist, album, duration, exclude, needsList: true, skipCache: fresh, skipMemory: force })'),
  'the list reads the same lookup the stage does, so a song costs one call');
 assert.ok(route.includes("const busy = bundle.reason === 'provider-error'")&&route.includes('busy, stale: busy,'),
  'a busy provider is reported as busy, with the answer that was remembered for the song');
 assert.ok(route.includes('if (entry.result || entry.list.length) {')&&route.includes('const poisoned ='),
  'only what was found is remembered, and a miss recorded during an outage is not a verdict');
 assert.ok(route.includes("searchParams.get('candidates') === '1'")&&route.includes("searchParams.get('reload') === '1'"),
  'the list asks for candidates, and a reload skips the remembered provider answer');
 assert.ok(route.includes('savedId'),'the list must mark the record the saved choice came from');
 assert.ok(route.includes('const rows = (bundle.list || []).map((row) => ({ ...row, auto: row.id === bundle.autoId, saved: row.id === savedId }));'),
  'every row the search returned reaches the list — the covers and other languages included, dimmed');
 assert.ok(!route.includes('wantsList')&&!route.includes("searchParams.get('list') === '1'"),
  'the dead source list went with the picker it was built for');

 // ── the panel: one word of chrome, a list, and a tick that writes ──
 assert.ok(screen.includes('className="mc-lyric-available"')&&screen.includes('<span>Available</span>'),
  'the records open from a single "Available" control');
 assert.ok(screen.includes('aria-expanded={open}'),'the control must report whether the list is open');
 assert.ok(screen.includes('mc-lyric-pop')&&screen.includes('mc-lyric-option')&&screen.includes('recordLine(candidate, wanted)'),
  'every record must be listed by title, in a list rendered inside the panel');
 assert.ok(screen.includes("name={candidate.synced ? 'wave' : 'text'}"),
  'whether a record carries timings must be a symbol, not a sentence');
 assert.ok(!screen.includes('mc-picker'),'the footer select the owner rejected must not come back');
 assert.ok(screen.includes('mc-lyric-records')&&screen.includes('mc-lyric-select')&&screen.includes('candidateLabel(candidate, wanted, currentId)'),
  'the same records are offered again as a dropdown, labelled by title and marks');
 assert.ok(!screen.includes('recordLine(candidate.id'),'a record is never shown to a person as its provider id');
 assert.ok(screen.includes('onClick={() => setPicked(candidate.id)}'),
  'choosing a row must only mark it — nothing is saved by looking');
 assert.ok(screen.includes('onClick={() => ask(picked)}')&&screen.includes('disabled={!picked || picking || picked === currentId}'),
  'the tick is the only thing that writes, and it waits for a real choice');
 assert.ok(screen.includes('mc-lyric-retry')&&screen.includes('picker.busy'),
  'a busy provider must show a retry symbol rather than an empty panel');
 assert.ok(screen.includes("candidate.same === false ? 'is-other'"),
  'the rest of the search follows this song\'s own records, dimmed');
 assert.ok(screen.includes('if (ready || candidates.length) CANDIDATE_CACHE.set(key, next);'),
  'a failure is never remembered, so the next look is a real look');
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
 assert.ok(canvasCss.includes('.mc-lyric-option.is-other'),
  'the rest of the search must read as secondary, not as a candidate for this song');
 assert.ok(canvasCss.includes('.mc-lyric-records .mc-lyric-select')&&/\.mc-lyric-select \{[^}]*min-height:44px/.test(canvasCss),
  'the dropdown must stay thumb-sized on a phone');
 assert.ok(canvasCss.includes('.mc-lyric-retry'),'the busy mark is a control, and it has a rule');
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

 console.log('Lyrics pipeline: tiered acceptance with the catalogue-suffix tier, decorations stripped but never M/F, Live or language markers, album-less matching, rejection reasons, retrieval variants, ranking, stable cache keys, single-source wiring, the measured question order (title, then the artist narrows, then one free-text), the merged list that covers, store, admin gate and screen recovery, plus the record list (every candidate collected, one word of chrome, rows that only mark a choice, a tick that writes it, no printed wording, and a list that renders inside the panel on every screen) all passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
