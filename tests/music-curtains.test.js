/*
 * tests/music-curtains.test.js — the Lyric Lounge music section (G final).
 *
 * Two jobs. First, the pure model in `lib/musicCore.js`, which is where the promises live (a `0`
 * count is a real count, an unsynchronised lyric is not a button, a hold has a progress). Second, a set of
 * structural assertions on the shipped files: the old UI is gone rather than hidden, the lounge layout is
 * exactly header / player card / lyrics-browse center / queue strip, and every hard-won function survived
 * the rewrite. Pixels are verified in the browser pass, not here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const core = require('../lib/musicCore');
const css = read('app/globals.css');
const section = read('components/music/MusicCurtains.jsx');
const page = read('app/music/page.js');

/* ───────────────────────────────── the model ───────────────────────────────── */

test('tabs report real counts, including zero', () => {
  const tabs = core.muTabs({ albums: 12, artists: 0, playlists: 3 });
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.count]), [
    ['albums', 'Albums', 12],
    ['artists', 'Artists', 0],
    ['playlists', 'Playlists', 3],
  ], 'an empty facet stays visible as 0 — a tab that hides itself is how a library starts lying');
  assert.deepEqual(core.muTabs({}).map((t) => t.count), [0, 0, 0]);
  assert.deepEqual(core.muTabs({ albums: -5 }).map((t) => t.count), [0, 0, 0], 'never a negative count');
});

test('the non-facet views are chips, never a fourth tab', () => {
  assert.deepEqual(core.MU_TABS.map((t) => t.id), ['albums', 'artists', 'playlists']);
  assert.deepEqual(core.MU_CHIPS.map((c) => c.id), ['search', 'favorites', 'recent']);
});

test('lyric rows: only timed lines are tappable', () => {
  const lines = [{ time: 12, text: 'one' }, { time: 20, text: 'two' }, { time: 31, text: 'three' }];
  const rows = core.muLyricRows(lines, 1, { radius: 1 });
  assert.deepEqual(rows.map((r) => r.state), ['past', 'current', 'future']);
  assert.deepEqual(rows.map((r) => r.tappable), [true, true, true]);
  assert.deepEqual(rows.map((r) => r.visible), [true, true, true], 'radius only dims the window, it never drops lines from the list');

  const unsynced = core.muLyricRows([{ time: null, text: 'a' }, { time: null, text: 'b' }], -1, { radius: 4 });
  assert.deepEqual(unsynced.map((r) => r.state), ['plain', 'plain']);
  assert.deepEqual(unsynced.map((r) => r.tappable), [false, false],
    'no timestamps means no seek affordance — a row that looks pressable and is not one is a decorative control');

  assert.deepEqual(core.muLyricRows([], -1), []);
  assert.deepEqual(core.muLyricRows(null, 0), [], 'a missing list is not a crash');
});

test('the curtain position comes from playback, and never from a timer', () => {
  assert.equal(core.muCurtainPosition(51, 225), 51 / 225);
  assert.equal(core.muCurtainPosition(0, 0), 0, 'an unknown duration is 0, not Infinity');
  assert.equal(core.muCurtainPosition(300, 225), 1, 'clamped at the end');
  assert.equal(core.muCurtainPosition(-4, 100), 0);
  assert.equal(core.muCurtainPosition('x', 'y'), 0);
});

test('the hue rotates by track, so a playlist shifts light instead of flashing wallpaper', () => {
  const a = core.muCurtainVars('song-one');
  const b = core.muCurtainVars('song-one');
  const c = core.muCurtainVars('');
  assert.deepEqual(a, b, 'same key, same colours — a re-render must not restyle the room');
  assert.notEqual(a['--ll-glow-a'], core.muCurtainVars('other-song')['--ll-glow-a']);
  assert.deepEqual(Object.keys(c), ['--ll-glow-a', '--ll-glow-b', '--ll-glow-c']);
});

test('quality chips keep the ladder order and mark what is current', () => {
  const chips = core.muQualityChips({ '96kbps': 'u', '320kbps': 'u', auto: 'u' }, '320kbps');
  assert.deepEqual(chips.map((c) => c.label), ['320k', '96k', 'Auto']);
  assert.deepEqual(chips.map((c) => c.current), [true, false, false]);
  assert.deepEqual(core.muQualityChips({}, ''), []);
  const odd = core.muQualityChips({ 'weird-host': 'u' }, '');
  assert.deepEqual(odd, [{ key: 'weird-host', label: 'weird-host', current: false }], 'an unknown key is still selectable, and shows its own name');
});

test('the lock surface says what it is doing in every state', () => {
  const pocket = core.muLockView({ pocketMode: true, hold: 0.5, nextTitle: 'Vaan Megam' });
  assert.equal(pocket.kind, 'pocket');
  assert.equal(pocket.progress, 50, 'the hold ring is a percentage the CSS can draw');
  assert.equal(pocket.nextTitle, 'Vaan Megam', 'pocket mode is for not looking at the phone, so the next song belongs on it');

  for (const [status, fragment] of [
    ['active', 'keeping the screen awake'],
    ['unsupported', 'no wake lock in this browser'],
    ['blocked', 'refused'],
    ['released', 'took the lock back'],
  ]) {
    assert.match(core.muLockView({ listeningMode: true, wakeLockStatus: status }).status, new RegExp(fragment, 'i'),
      `${status} must be named, not hidden behind a spinner`);
  }
  assert.equal(core.muLockView({}).kind, 'off');
});

test('the helpers the player depends on still behave after moving out of the page', () => {
  assert.equal(core.trackKey({ seokey: 'a', id: 'b' }), 'a');
  assert.equal(core.trackKey(null), '');
  assert.equal(core.chooseBestQuality({ '96kbps': 'u', '320kbps': 'u' }), '320kbps');
  assert.equal(core.chooseBestQuality({}), '');
  assert.equal(core.isHlsUrl('https://x/y.M3U8?a=1'), true);
  assert.equal(core.formatTime(75), '1:15');
  assert.equal(core.formatTime('nope'), '0:00');
  assert.deepEqual(core.dedupeQueue([{ seokey: 'a' }, { seokey: 'a' }, { seokey: 'b' }]).length, 2);

  const parsed = core.parseSyncedLyrics('[01:12.50][01:20] two stamps one line\nplain line');
  assert.deepEqual(parsed, [
    { time: 72.5, text: 'two stamps one line' },
    { time: 80, text: 'two stamps one line' },
  ]);
  assert.equal(core.plainFromSyncedLyrics('[00:01] a\n[00:02] b'), 'a\nb');
  assert.deepEqual(core.normalizeSearchResults(['x']), { songs: ['x'], albums: [], artists: [], playlists: [] });
  assert.equal(core.searchResultCount({ songs: [1, 2], albums: [1] }), 3);
  assert.deepEqual(core.artistChipsFromTrack({ artists: 'A, B & C' }).map((a) => a.name), ['A', 'B', 'C']);
});

/* ─────────────────────── the section: old UI gone, promises kept ─────────────────────── */

/* ─────────────────────── the lounge: 6 tabs, promises kept ─────────────────────── */

test('the page is a thin shell over one new component', () => {
  assert.match(page, /import MusicCurtains from '@\/components\/music\/MusicCurtains'/);
  assert.match(page, /return <MusicCurtains \/>;/);
  assert.ok(page.length < 1200, 'the shell stays thin; the logic moved with the new render, not beside it');
  assert.match(page, /No `export const dynamic`|Static shell/, 'the shell stays static so browsing does not wake the server');
});

test('the previous music UIs are deleted, not restyled', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'components/music/Curtains.jsx')), 'the primitives file is deleted outright');
  for (const token of ['jv-mu-', '--mu-', 'jv-vinyl', 'jv-spin', 'MUSIC PLAYER']) {
    assert.ok(!section.includes(token), `the section carries no ${token} anymore`);
    assert.ok(!css.includes(token), `the stylesheet carries no ${token} anymore`);
  }
  for (const kept of ['deepsea', 'nordic', 'cybergrape']) {
    assert.ok(css.includes(`.palette-${kept}`),
      `the ${kept} palette belongs to another page and must not be collateral damage`);
  }
  for (const gone of ['VinylArt', 'SectionHeader', 'HorizontalRow', 'TrackTile', 'AlbumTile', 'ArtistTile', 'PlaylistTile', 'TrackList', 'SidebarButton', 'IconButton',
      'CurtainField', 'MuPanel', 'MuTabs', 'MuHeading', 'MuTile', 'MuTrackRow', 'MuTrackList', 'NowPlayingPanel', 'LyricsPanel', 'TransportStrip', 'MiniCapsule', 'LockVeil', 'MuNote']) {
    assert.ok(!new RegExp(`function ${gone}\\b`).test(section), `${gone} was removed rather than kept around for old markup`);
    assert.ok(!new RegExp(`<${gone}[\\s/>]`).test(section), `${gone} is not rendered anywhere`);
  }
  const soup = /className="[^"]*(rounded-3xl|bg-\[#050012\]|backdrop-blur)/;
  assert.ok(!soup.test(section), 'no Tailwind soup left in the section — it is one class family now');
});

test('the asked-out wordings are gone: brand text, footer line, listen button', () => {
  assert.ok(!section.includes(' Lyric Lounge</p>'), 'the header keeps the bars mark, not the words');
  assert.match(section, /ll-brand-bars"[\s\S]{0,120}ll-sr">Music<\/span>/, 'the mark stays announced for screen readers');
  assert.ok(!section.includes('Streams are resolved by this app'), 'the footer line is deleted');
  assert.ok(!section.includes('ll-foot'), 'and the footer element went with it');
  assert.ok(!css.includes('.ll-foot'), 'and its rules');
  assert.ok(!section.includes('>listen</button>'), 'the listen button is off the card');
});

test('the header is mark · search · nav, with TV icons and a phone search toggle', () => {
  assert.match(section, /LlAmbient vars=\{curtainVars\}/, 'the room glows with the track hash');
  assert.match(section, /placeholder="Search Tamil Songs\.\.\."/, 'the search pill matches the design');
  assert.match(section, /aria-label="Music"[\s\S]*>Home<\/button>[\s\S]*>Explore<\/button>[\s\S]*>My Library<\/button>/, 'Home · Explore · My Library, in that order');
  assert.match(section, /setCenterTab\('trending'\); setSelectedCollection\(null\); setQuery\(''\); if \(trending\.status === 'idle'\) loadTrending\(\);/, 'Home jumps to Trending and loads it');
  assert.match(section, /setCenterTab\('tracks'\); setSelectedCollection\(null\); setQuery\(''\);/, 'Explore jumps to Tracks');
  assert.match(section, /setCenterTab\('library'\); setSelectedCollection\(null\); setQuery\(''\);/, 'My Library jumps to Library');
  assert.match(section, /aria-label="Quick actions"/, 'the TV icon trio is mounted');
  assert.match(section, /aria-pressed=\{mSearch\}/, 'phones toggle the search row');
  assert.match(section, /<main className="ll jv-rail-shift">/, 'the lounge keeps its rail clearance');
});

test('the center is six tabs behind one tab state, queue on phones', () => {
  assert.match(section, /const \[centerTab, setCenterTab\] = useState\('lyrics'\);/, 'lyrics first, as the design promises');
  assert.match(section, /role="tablist" aria-label="Center"/, 'the center tabs are announced');
  assert.match(section, /aria-selected=\{centerTab === 'lyrics'\}[\s\S]*aria-selected=\{centerTab === 'trending'\}[\s\S]*aria-selected=\{centerTab === 'new'\}[\s\S]*aria-selected=\{centerTab === 'tracks'\}[\s\S]*aria-selected=\{centerTab === 'playlists'\}[\s\S]*aria-selected=\{centerTab === 'library'\}[\s\S]*aria-selected=\{centerTab === 'queue'\}/, 'all seven tabs report selection, in order');
  assert.match(section, /setCenterTab\('lyrics'\); setShowLyrics\(true\); openLyrics\(\)/, 'the lyrics tab opens and loads the panel');
  assert.match(section, /setCenterTab\('trending'\); setShowLyrics\(false\); if \(trending\.status === 'idle'\) loadTrending\(\)/, 'trending parks lyrics and loads once');
  assert.match(section, /setCenterTab\('new'\); setShowLyrics\(false\); if \(fresh\.status === 'idle'\) loadFresh\(\)/, 'new parks lyrics and loads once');
  assert.match(section, /onClose=\{\(\) => \{ setShowLyrics\(false\); setCenterTab\('trending'\); \}\}/, 'closing lyrics lands back on trending');
  assert.match(section, /aria-label="Center shortcuts">[\s\S]*> Lyrics<\/button>[\s\S]*> Trending<\/button>[\s\S]*> Queue<\/button>/, 'the phone bottom nav carries Lyrics · Trending · Queue');
  assert.ok(!section.includes("setCenterTab('browse')"), 'the old browse tab is fully unreferenced');
});

test('the player card carries art, transport, progress, quality and every extra', () => {
  assert.match(section, /aria-label="Now playing"/, 'the card is labelled');
  assert.match(section, /onClick=\{playPrevious\}[\s\S]*onClick=\{togglePlay\}[\s\S]*onClick=\{\(\) => playNext\(\)\}/, 'previous · play · next');
  assert.match(section, /scaleX\(\$\{curtainPosition\.toFixed\(4\)\}\)/, 'progress comes from playback position');
  assert.match(section, /formatTime\(currentTime\)\}<\/span><span>\{duration/, 'elapsed and total stay visible');
  assert.match(section, /aria-label="Stream quality"/, 'the quality ladder survived');
  assert.match(section, /setShuffleEnabled/, 'shuffle survived');
  assert.match(section, /onClick=\{cycleRepeat\}[\s\S]*repeat \{repeatMode\}/, 'repeat survived with its three moods');
  assert.match(section, /setCenterTab\(next \? 'lyrics' : 'trending'\)/, 'the lyrics chip toggles against trending');
  assert.match(section, /function toggleListeningMode/, 'the lock machine is intact behind the scenes');
  assert.match(section, /onClick=\{enterPocketMode\} title="Pocket mode">lock<\/button>/, 'pocket mode survived');
  assert.match(section, /onClick=\{\(\) => loadHome\(\)\} title="Refresh the shelves"/, 'refresh survived');
  assert.match(section, /aria-label="Volume" onChange=\{\(event\) => changeVolume\(event\.target\.value\)\}/, 'volume survived with its slider');
  assert.match(section, /onClick=\{toggleMute\}/, 'mute survived');
  assert.match(section, /onClick=\{\(\) => setCardHidden\(true\)\} title="Hide player"/, 'the phone card closes into the capsule');
});

test('the queue rides a strip on the big screens and a full tab on phones', () => {
  assert.match(section, /className="ll-strip" aria-label="Up next"/, 'the strip keeps its label');
  assert.match(section, /queueTracks\.slice\(0, 12\)\.map/, 'the strip shows a dozen, scrollable');
  assert.match(section, /className="ll-queuepane"/, 'phones get the full queue as a third tab');
  assert.match(section, /<span className="ll-queue-num">\{index \+ 1\}<\/span>/, 'queue rows are numbered');
});

test('search and collections overlay any tab; every tab keeps its function', () => {
  assert.match(section, /\{query\.trim\(\) \? \(\n {16}<div className="ll-browse">\n {18}<section className="ll-panel" aria-label="Search results">/, 'typing searches over whatever tab is open');
  assert.match(section, /onClick=\{\(\) => setQuery\(''\)\}>clear<\/button>/, 'clearing returns to the tab');
  assert.match(section, /: selectedCollection \? \(/, 'an opened collection takes the stage');
  assert.match(section, /aria-label="Collection"/, 'collections open');
  assert.match(section, /song controls · \{showSongCrud \? 'open' : 'minimized'\}/, 'song controls survived');
  assert.match(section, /replaceImportedTrack\(selectedCollection\.tracks\?\.\[0\]\)/, 'replace-first survived');
  assert.match(section, /removeImportedTrack\(selectedCollection\.tracks\?\.\[0\]\)/, 'remove-first survived');
  assert.match(section, /aria-label="Trending now"/, 'trending exists');
  assert.match(section, /fetch\('\/api\/music\/trending\?limit=48'/, 'trending asks its own endpoint');
  assert.match(section, /aria-label="New releases"/, 'new exists');
  assert.match(section, /fetch\('\/api\/music\/new\?limit=48'/, 'new asks its own endpoint');
  assert.match(section, /aria-label="All tracks"/, 'tracks exists');
  assert.match(section, /allShelfSongs\.length \? <LlTrackList tracks=\{allShelfSongs\}/, 'tracks plays the whole pool as one list');
  assert.match(section, />From the shelves<\/h3>/, 'shelf collections keep their tiles');
  assert.match(section, /aria-label="Playlists"/, 'playlists exists');
  assert.match(section, /aria-label="Library"/, 'library exists');
  assert.match(section, /loadFacet\('albums', query\)/, 'albums reload from their endpoint');
  assert.match(section, /loadFacet\('artists', query\)/, 'artists reload from theirs');
  assert.match(section, />Favorites<\/h3>[\s\S]*>Recently played<\/h3>/, 'starred and recent live in the library');
  assert.match(section, /Spotify playlist sync/, 'the import block survived, in the library');
  assert.match(section, /onClick=\{\(\) => importSpotifyPlaylists\(\)\}/, 'import survived');
  assert.match(section, /resyncImportedPlaylist\(playlist\)/, 're-sync survived');
  assert.match(section, /renameImportedPlaylist\(playlist\)/, 'rename survived');
  assert.match(section, /deleteImportedPlaylist\(playlist\)/, 'delete survived');
});

test('lyrics: the current line glows, timed lines jump, the reader keeps its tools', () => {
  assert.match(section, /data-state=\{row\.state\} ref=\{row\.state === 'current' \? activeRef : undefined\}/, 'rows carry state and the current row takes the scroll ref');
  assert.match(section, /onJump=\{\(time\) => \{ if \(Number\.isFinite\(time\)\) seekTo\(time\); \}\}/, 'tap-to-jump seeks exactly');
  assert.match(section, /onToggleAutoScroll=\{\(\) => setLyricAutoScroll\(\(current\) => !current\)\}/, 'auto-scroll toggles');
  assert.match(section, /onBlurToggle=\{\(\) => setLyricBlur\(\(current\) => !current\)\}/, 'blur toggles');
  assert.match(section, /the source has no timed lyrics for this song/, 'unsynced sources say so');
});

test('the lock machine survived, in both its moods', () => {
  assert.match(section, /view=\{lockView\.kind === 'pocket' \? lockView : null\}/, 'the veil only rises for pocket mode');
  assert.match(section, /onHoldStart=\{startPocketUnlock\} onHoldEnd=\{cancelPocketUnlock\}/, 'the hold-to-release gesture is wired');
  assert.match(section, /conic-gradient\(var\(--ll-accent\)/, 'the ring reads gold now');
  assert.match(section, /className="ll-listenbar" role="status"/, 'listening mode keeps its bar');
  assert.match(section, /hold 1\.5s to leave<\/button>/, 'leaving still takes a hold');
  assert.match(section, /wakeLockStatusText\(\)/, 'wake-lock states are still spoken');
});

test('the mini capsule is a control surface, and dismissible by drag', () => {
  assert.match(section, /if \(!visible\) return null;/, 'hidden is unmounted, never a second player');
  assert.match(section, /cardHidden \|\| \(showMiniPlayer && centerTab !== 'lyrics'\)/, 'it answers the hidden card and the lyrics call');
  assert.match(section, /onTouchStart=\{onDragStart\} onTouchMove=\{onDragMove\} onTouchEnd=\{onDragEnd\}/, 'the drag surface is the capsule itself');
  assert.match(section, /if \(dragDy > MU_MINI_DRAG_CLOSE_PX\) \{ closeMiniPlayer\(\); setCardHidden\(false\); \}/, 'a long drag dismisses and reopens the card');
});

test('the hard-won wiring is still in the room', () => {
  assert.match(section, /<audio ref=\{videoRef\}/, 'one audio node, still the only player');
  assert.match(section, /total - now <= 0\.9/, 'the pre-end advance still beats the lock screen');
  assert.match(section, /\[queueTracks\[index \+ 1\], queueTracks\[index \+ 2\]\]/, 'the two-track prefetch still runs ahead');
  assert.equal(section.match(/export const dynamic/g)?.length || 0, 1, 'the only mention is the header comment — the screen stays static');
});

test('the lounge pins its chrome and scrolls only the panes', () => {
  assert.match(css, /\.ll \{[\s\S]*?height: 100dvh;[\s\S]*?overflow: hidden;/, 'the room is the viewport');
  assert.match(css, /grid-template-areas: "top" "stage" "strip"/, 'header · stage · strip, no footer row');
  assert.match(css, /\.ll-center-body \{[\s\S]*?overflow-y: auto/, 'the center body is the scroller');
  assert.match(css, /\.ll-centertab-queue \{ display: none; \}/, 'no queue tab where the strip shows');
  assert.match(css, /\.ll-centertabs \{[^}]*overflow-x: auto/, 'the tab bar swipes instead of squeezing');
  assert.match(css, /\.ll-line\[data-state="current"\] \.ll-line-text \{[^}]*color: var\(--ll-accent\)/, 'the current line glows gold');
  assert.match(css, /html\.day-mode \.ll \{ color: var\(--ll-ink\) !important;/, 'day mode cannot wash the room out');
});

test('phones get the compact card and the bottom nav; the TV gets karaoke', () => {
  assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*?\.ll-strip \{ display: none; \}/, 'the strip folds away on phones');
  assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*?\.ll-centertab-queue \{ display: inline-flex; \}/, 'the queue tab appears on phones');
  assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*?\.ll-bottomnav \{ display: grid;/, 'the bottom nav appears on phones');
  assert.match(css, /@media \(max-width: 899px\) \{[\s\S]*?\.ll-vol \{ display: none; \}/, 'no software volume where hardware keys rule');
  assert.match(css, /@media \(min-width: 1600px\) \{[\s\S]*?\.ll-line-text \{ font-size: clamp\(34px, 3\.4vw, 54px\); \}/, 'the TV verse is karaoke-big');
  assert.match(css, /@media \(min-width: 1600px\) \{[\s\S]*?\.ll-icons \{ display: flex; \}/, 'the TV header trades words for icons');
});

function deepestButtonNesting(source) {
  const tag = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let depth = 0;
  let max = 0;
  let match;
  while ((match = tag.exec(source))) {
    const full = match[0];
    const name = match[1];
    if (name !== 'button') continue;
    if (full.startsWith('</')) depth -= 1;
    else if (!full.endsWith('/>')) { depth += 1; max = Math.max(max, depth); }
  }
  return max;
}

test('no control sits inside a control', () => {
  assert.equal(deepestButtonNesting(section), 1, `the section nests a button (depth ${deepestButtonNesting(section)})`);
  assert.match(section, /<\/button>\n {6}\{onFavorite \? \(\n {8}<button/,
    'favourite is a sibling of the play button in every track row');
});
