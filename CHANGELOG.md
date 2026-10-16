## Lyrics the site shows but the app did not: the question was wrong (2026-10-16)

Requested: *"lyrics not available for many songs but they are have lyrics in site. so study analyze the
whole structure and give me proper working solution."*

Measured before changing anything: 116 real songs from the app's own catalogue source, queried against the
real LRCLIB through the app's own matcher. The app found **74 %**; the artist-free question found **78 %**
and filled the record list with a median of 19 rows instead of 3.

- **The artist field was emptying the search.** LRCLIB treats `track_name` and `artist_name` as an AND
  filter, and this app's artist string is a credit list (lyricist, composer, singers joined), which rarely
  equals LRCLIB's own `artistName` — so the endpoint answered 200 with an **empty array** for songs it
  plainly has. "Mozhiye", "Vazhithunaiye", "Nandanandanaa", "The One", "Dont Care": 0 rows with the
  artist field, 20 without it, the right record among them. The route now asks `track_name` alone first.
- **The artist still has one job.** A record can be crowded out of a common title's 20-row page
  ("I Wanna Fly" is also a Trevi Moran song), so when the first page carries nothing the matcher accepts,
  the artist-narrowed question is asked and its rows are **merged** with the first page — never replacing
  them, so the list cannot shrink.
- **The free-text question is now the last resort.** Asked only when both fielded questions returned no
  rows at all — the question LRCLIB's own search box asks. A refusal or a rejection is never retried
  automatically; that is what the person's retry button is for.
- **Decorated catalogue titles are the same recording.** JioSaavn appends "(Trending Version)",
  "(Title Theme)", "(LoFi Mix)", "(Karaoke)", "(Reprise)", "(Remix by …)" to the *same* recording, and an
  exact-title comparison refused them silently. The new `catalogue-suffix` tier strips those decorations
  from this app's title only and still demands artist-or-album agreement plus a length inside the
  tolerance; the tier name is recorded with the choice, so a wrong pick is traceable. Deliberately
  untouched: M/F vocal markers, Live, Acoustic, Instrumental and language names — those are different
  recordings or different words, and the M/F rule exists because they can share a duration to the second.
- **The list is now the whole answer.** Every row the search returned reaches it — this song's records
  first, then the covers, karaoke cuts and other-language versions it is right to refuse automatically,
  dimmed, for a deliberate one-tap pick. Together with the richer search, "Available" now has content for
  roughly nine songs in ten instead of three in four.
- **Unchanged:** one request per song (a working song still costs exactly one call, a revisit costs none),
  the in-process + MongoDB memory, the busy-with-retry-symbol state, the strict gate on what is shown
  automatically, `LYRICS_MATCH_VERSION` bumping to 6 so every cached answer is re-resolved once.

## One request per song, and a desktop that stays where it is (2026-10-16)

Requested: *"i dont want that when song satrt toplay it shows lyrics panel behaviour in desktop … now i
face provider busy error. fix this one song make one request get that all result in available tab. best
match result showed in lyrics panel as usual. now there is no lyrics shown available dropdown. no matter
if the song have match lyrics or not all songs i want that available shows lyrics."*

- **One lookup per song, not a cascade.** The route walked a ladder — `/api/get`, up to three fielded
  searches across title variants, two free-text ones and a last-resort query — so one song could cost a
  dozen provider requests. LRCLIB answered the way a rate-limited community service does: HTTP 503
  `ServerOverloaded`, which the route turned into a per-origin cooldown the panel reported as "Lyrics
  provider is busy." There is now one search (`track_name` + `artist_name`) and, only when it comes back
  empty, one free-text `q=` question. A refusal is never retried inside the lookup: the retry a person can
  press is worth more than one spent automatically.
- **The same answer fills the list.** The one search returns this song's records *and* the rest of the
  hits, so "Available" is not a second lookup. This song's records come first; the rest follow, dimmed, and
  are never matched automatically — but they can be chosen by hand, which is the whole point of the list.
- **Remembered as a whole.** The matched record and the list are cached together — fifteen minutes in the
  process, 90 days in MongoDB, a miss for 12 hours — and two callers asking for the same song at the same
  time share the call already in flight. Opening the list is usually reading an answer that already
  exists; a song looked up once costs nothing to look at again, and a choice costs no extra call either.
- **Busy is not empty.** When the provider refuses, the answer remembered for that song — lyrics and list
  — is served with a retry symbol beside the "Available" pill. Nothing is invented, no other song is
  substituted, and a failure is written to no cache at all. A miss that was recorded *during* an outage
  (the sticky failure state) is now ignored rather than believed for twelve hours.
- **Desktop no longer hands the screen over.** Playing a row on a desktop used to open the lyrics focus
  layout and move the Library the person was browsing. On a desktop nothing moves now: the row plays where
  it sits. Phones keep the takeover, which is the layout they are built for. Focus is asked for rather than
  assumed — the expand glyph or the Lyrics button opens the big stage, and a bare `/music` opens the plain
  two-column screen with the lyrics at their normal size.
- **The list is a list again.** Every record renders as a row (timed/plain glyph, title, artist when it
  differs, length, a dot for the record in use) and the same set is offered as a dropdown below it, so the
  whole list can be seen at once and chosen in one gesture. Selecting only marks it; the tick saves it,
  through the same store the admin panel uses, audited as `lyrics.choose`. The panel still offers no reset
  control — that lives in the admin Lyrics tab.
- **Dead code removed with the cascade:** the `list=1` source list (its picker was retired a release ago
  and nothing had called it since), `collectCandidates`, and the route's last use of `musicSources`. The
  admin Lyrics tab, the `clear` action and the audit trail are unchanged.

## The lyrics panel: a list, a tick, and nothing to read but the lyrics (2026-10-16)

Requested: *"in mobile there is no dropdown for available lyrics … i dont want albumart in lyrics panel …
i dont want the remove lyrics button and those wordings … very minimalistic like 'available' … when i
select the lyrics dont immediately add to that song, i select small ok button … as much as communicate
with symbols and buttons are enough."*

- **The artwork is gone from the Lyrics view.** The sleeve was chrome around a lyric, and on a locked
  screen it was a shrunken disc next to the words. Now the Lyrics view renders no artwork at all — the
  disc belongs to the Artwork view, where it keeps the size it has always had. (That also retires the
  sleeve's blur rule under the touch lock: there is no sleeve to blur.)
- **The record list lives in the header, behind one word: "Available".** The old list sat in the footer
  row, which is hidden on short screens — a phone in landscape showed nothing at all, which is exactly
  the report. The control is in the header now, so it exists at every size and orientation, and the list
  it opens renders *inside* the panel: never clipped by it, never floating over another section.
- **Two steps, so nothing is written while you look.** Tapping a record only marks it (the row
  highlights); nothing is saved until the tick is pressed. The tick writes the choice, closes the list
  and reloads the lyrics. It is disabled until you pick a record that is not the one already in use.
- **No wording.** The status line, "Resume follow", "Remove my lyrics", "Edit my lyrics", "Saved for
  everyone", "records available", "showing now" and the per-record "Synced"/"Plain" words are all gone.
  A record's timing is a glyph now — a waveform for timed, three lines for plain — and the record in use
  is marked with a dot. The footer is three symbols: paste, follow (only when you have scrolled off the
  playing line), refresh. The panel's only words are its heading, "Lyrics", and "Available".
- **Silence is not dishonesty.** When a save fails there is no sentence to print, so the tick turns red
  for four seconds and the reason is announced to screen readers, not painted over the lyrics. The
  paste form keeps its own help line (a form is not chrome).
- **Unchanged underneath:** the choice is still saved for everyone through the same store the admin panel
  uses, audited (`lyrics.choose`), shown in the admin Lyrics tab, and re-read from the provider on the
  server. The API keeps its `clear` action, but the panel deliberately offers no reset control — the
  owner asked for no words and no extra buttons, so a choice is changed by choosing another record.

## Lock mode keeps the sleeve, and lyrics you can choose (2026-10-16)

Requested: *"when i enter lock mode the albumart is very small. fix that"* and a way to replace the
"Wrong lyrics?" button with the records the provider actually has.

- **Lock mode no longer resizes the artwork.** Focus used to shrink the sleeve to a thumbnail —
  `60px` on desktop, `48×48` on phones — so locking the screen turned the record into an icon. Both
  rules are deleted rather than overridden: focus changes what is *sharp*, never how big the record
  is. The artwork disc keeps `min(36dvh,360px)` / `min(43dvh,400px)` and the lyrics sleeve keeps its
  own size, exactly as they are unlocked, on every breakpoint — and the phone rule that re-flowed the
  now-playing row under focus goes with them, so the unlocked arrangement survives too.
- **"Wrong lyrics?" is gone; a picker took its place.** The old button refused one record *on this
  device* and hoped the retry chose better. Now the same row offers every record LRCLIB has for the
  song — each option reads **Title — Artist · Synced or Plain · 3:42** — and the one showing is marked.
- **The choice is saved for everyone.** Picking a record fetches that record from the provider on the
  server (the browser never sends lyric text), saves it through the same store the admin panel uses,
  and records it in the audit trail (`lyrics.choose`, `lyrics.clear`, with the before/after lyrics).
  It sticks across devices, appears in the admin Lyrics tab as saved lyrics, and undo restores what
  was there before. The list also offers **Automatic — let the app match it again**, which clears the
  pin (`lyrics.clear`).
- **Nothing is forced through the matcher.** The strict identity check would refuse a live cut or a
  different album; the picker lists those records anyway, because the owner can read the title, artist,
  album and length and decide. The matcher's verdict is recorded in the saved note, not used to hide
  the option.
- **"Remove my lyrics" now clears either kind of saved lyrics** — a paste from this device, or a
  record chosen for everyone — and both go back to the automatic match. The list carries the same
  exit as its last option, so the two controls cannot disagree about what "remove" means.
- **One row on every screen.** The footer is one `select` that takes the leftover width and wraps to
  its own line only if the row is too narrow; the quiet states (looking, one record only, lookup
  failed) stay on the existing row, so the panel does not jump around. A paste saved on this device is
  cleared when it would hide the record you just chose.
- Covered by `test-lyrics-pipeline.cjs` (every record collected, labelled with title and timing, saved
  and audited), `test-music-pocket.cjs` (no focus rule may resize the sleeve, and every unlocked size
  is asserted to survive) and `test-admin-controls.cjs` (the new write path records both branches).

## Focus mode — a locked screen with nothing written on it (2026-10-16)

Requested: *"those symbol and wordings should be removed from that lyric panel — that lock symbol and
wordings."* The lock button worked; the overlay it drew was in the way.

- **The guard is now silent.** Gone: the lock glyph, the "Focus locked" heading, the paragraph under it,
  the "Swipe down to unlock" hint (and the 3.6 s timer that brought it back on every touch), the
  "Slide to unlock →" label, and the "Escape … or the Back button" footer. What is left is the blurred
  surround, the lyrics (or the sleeve), the Artwork/Lyrics toggle, and one drag handle at the bottom.
  The swipe's feedback is the vignette thinning as you pull — the gesture answers for itself.
- **The same on every screen size**, and it never comes back: no first-run hint, no onboarding copy.
- **The exits are unchanged** — swipe down anywhere, slide the handle right, Escape, or Back — and the
  handle still carries an accessible label and the region an accessible name, so removing the words from
  the screen did not remove them from assistive tech.
- **The wake-lock outcome moved to the shell's status line.** The guard used to be where a browser that
  cannot hold the screen awake said so; that announcement now comes from `MusicShell` (visible only in
  the two failure cases: unsupported, or refused). Removing the caption must not remove the honesty.
- Covered by `test-music-pocket.cjs`: the six removed phrases and the lock glyph are asserted **absent**
  from the guard's code, the hint timer is gone with them, no CSS rules are left orphaned, and the
  wake-lock announcement is asserted to live in the shell.

## Admin controls — order, audit, orphans, bulk, health (2026-10-16)

Requested: *"The Home tab shows the movie list in alphabetical order which is not useful — it shows
what order shows in homepage"* and every improvement that would make the panel more powerful and
efficient.

- **The Home tab now mirrors the home page.** Sort defaults to the real home order (pinned first,
  then the scraped order — the same comparator the viewer's payload is built with), with Movies/Series
  sections, whole-catalogue counts plus "in this view", and a `#position` badge on every row. Counts
  no longer change meaning as you filter.
- **Every tab records what it changed, and Undo puts it back.** A new append-only `AdminAction`
  collection stores actor/action/target with `before` and `after` snapshots; a new **History** tab
  lists them, remembers which rows are undoable, and says why when they are not. Re-scrapes, purges
  and imports are recorded too — marked irreversible rather than offered a fake undo. The audit write
  can never veto the change it describes.
- **Orphaned overrides are reported.** An override is keyed by the raw scraped title, so a forum
  rename silently disables it; the Home tab now lists them with what they were doing and the closest
  live rows to re-bind to, each suggestion explaining itself.
- **Bulk edits show their work first**: pick rows (or "select this view"), preview every before →
  after and every skipped no-op, then apply. Each changed row is separately undoable. Duplicate rows
  are grouped with a suggested keep and merged by hiding (never deleting), carrying corrections over.
  The whole override set exports to JSON and imports back in a merge mode that is undoable row by row.
- **A Health tab** with per-subsystem numbers and honest ages, plus **dry runs that write nothing**:
  the catalogue diff (what a sync would add, remove, change and — the part nobody could see before —
  which overrides it would orphan) and a live-source diff listing channels whose catalog placement,
  EPG override or favourite would not come back.
- **Ordering stays mirror-only.** The rank-based drag reorder from the plan was dropped on request:
  there is no rank field and no persisted manual order, so the panel keeps showing what viewers get.
- New: `models/AdminAction.js`, `lib/{adminAudit,adminModels,catalogOrphans,catalogBulk}.js`,
  `app/api/admin/{history,health}/**`, `app/api/admin/catalog/{bulk,duplicates,orphans,overrides/export,overrides/import}/**`,
  `app/api/admin/catalog/sync {mode:'dry'}`, `app/api/admin/tv/dry-run`,
  `components/admin/{HistoryTab,HealthTab,BulkBar,OrphanPanel,DuplicatePanel,OverrideTransfer}.js`,
  `scripts/test-admin-controls.cjs` (in `npm run verify`), `docs/ADMIN-CONTROLS.md`.

## Music focus mode — blur, lock, wake (2026-10-16)

Requested: *"remove the exit focus button in the mobile UI's lyrics panel … when I click the button all
UI is blurred, only lyrics or album art depends what I choose … and the mobile screen won't turn off."*

- **The lock button is now focus mode.** One press does three things: every layer except the lyrics (or
  the sleeve, in artwork mode) blurs, touches lock, and the browser is asked to keep the screen awake.
  Nothing is destroyed — unlocking restores the layout you were in, including the library.
- **The Artwork/Lyrics choice decides what stays sharp**, and the toggle itself stays sharp *and live*
  above the touch guard (`z-index:170` over the guard's `150`) so the choice can be changed without
  unlocking. It is the only interactive element while locked; the guard is a `region`, not an
  `aria-modal` dialog, because claiming modality while leaving a control outside would lie to AT.
- **Four ways out:** swipe down anywhere (the vignette fades as you pull), slide the puck right,
  Escape, or Back. Focus pushes exactly one history entry, so Back leaves focus instead of leaving
  Music; a gesture exit hands that entry back. A locked screen with no exit would have been a trap.
- **The mobile Lyrics panel has no exit button any more** (`mc-lyrics-exit` is gone from the component,
  and the mobile rule that revealed it is deleted). On a phone, the Library button leaves focus and the
  gestures above leave locked focus. The desktop expand glyph is unchanged.
- **Screen awake** is `lib/wakeLock.js`: requested inside the click (the API requires a user gesture),
  released when focus ends or the section is left, re-taken when the tab returns. iOS before 16.4 and
  refusals are surfaced, so the screen says "This browser will not hold the screen awake" instead of
  promising something it cannot do. No silent-video hack.
- **Removed as verified-dead while in there:** `MusicEngine`'s older `pocketMode` / `listeningMode`
  prototype, its second wake-lock implementation and the `muLockView` helper it fed — that memo was
  computed and never read, and nothing outside the engine referenced any of it. Leaving a second,
  unrelated pocket implementation beside the new one is how two behaviours start fighting.
- **New guard:** `scripts/test-music-pocket.cjs` (in `npm run verify`) drives the wake lock for real and
  pins the blur map, the layering, the four exits and the removals. Writing it found a real bug: a
  visibility change arriving while a lock request was still unanswered fired a **second** request, and
  the extra sentinel was unreachable — a leaked wake lock. The controller now allows one request at a
  time. The two opt-in Playwright music passes were updated to leave focus the way mobile now does.

## The ring — one progress bar for the whole app (2026-10-13, second pass)

Requested design: *"the section in background with blur, our logo blink, and the ring light along
with the logo works as progress bar; when the light completes the circle … show the page."*

### What it does now
- **The section blurs, it does not disappear.** On a tap the pressed item dims, the content that is
  already on screen goes `blur(18px) brightness(.5)` with a 1.028 scale, and the rail and dock stay
  sharp and pressable — the shell must never look like it died. Next keeps the outgoing page mounted
  for the whole transition, so the section you are *leaving* is what blurs; when the new page commits
  (still blurred) the reveal is one transition, not two jumps.
- **One object: `components/RingLogo.jsx`.** A 3px ring with a magenta→cyan gradient and a lit head
  travelling clockwise from 12 o'clock, around the real logo, which blinks on a 1.6s breath and
  brightens as the arc approaches the end. Boot splash and every section switch draw the same thing.
- **The arc is the progress bar, and it cannot lie.** `lib/loadProgress.js`:
  - a time floor creeps forward so the ring never looks frozen (half pace while a request is in flight);
  - the floor is **capped at 92%** — time alone can never complete the circle;
  - only real signals close it: the section mounted *and* its `/api` requests settled (or it asked for
    nothing), then the last 8% sweeps over 250 ms — **that sweep is what lifts the blur**, so the
    circle closing and the page appearing are the same instant;
  - a 4s escape hatch closes it anyway if a request never answers, and the section keeps its own
    skeleton honestly rather than holding the ring hostage.
- **The 200 ms rule still holds.** Nothing is shown for the first 200 ms, so a warm or prefetched
  switch shows no ring and no blur at all — the content just arrives. Warm routes stay instant.
- **Boot hand-off = the ring closing.** The splash minimum is 500 ms and the arc closes over the next
  250 ms, so the app appears at 750 ms *because the circle completed*, not because a timer expired.
  A slow gate still says something true at 2.6 s.
- `prefers-reduced-motion`: no blink, no shimmer, the reveal is instant, the arc still completes.

### Wiring, in three places
- `components/SectionLink.jsx` starts a load the instant Next reports pending — it is the only code
  that knows a switch was *asked for*, which is why the section you are leaving is the one that blurs.
  A cancelled tap can only cancel its own load (load ids), and the pending state is still the single
  indicator on the pressed item.
- `components/useLoadVeil.js` is the shell's coarse view (subscribe to events, never frames);
  `components/LoadVeil.jsx` subscribes to frames and draws the arc. It sits above the content and
  **below** the rail (z-40) and dock (z-60), with `pointer-events:none`.
- The veil lives *outside* the keyed route wrapper on purpose: inside it, the ring would unmount and
  remount on the commit — a blink at exactly the worst frame.
- `api` tracking counts same-origin `/api` requests only (byte proxies, `/api/auth` and `/api/health`
  excluded), installed at module scope so the first section's requests are counted too.

### Scope: every route, no exceptions
- The ring now covers **Watch, the embed browser and Admin** as well. Those three were briefly
  excluded because they own their whole screen, and the owner asked for them too, so the exclusion
  was removed rather than left behind as a dead switch (`suppressed` / `NO_VEIL` are gone from
  `lib/loadProgress.js`).
- Admin returns before the shell branch in `AuthGate` (no rail, no dock, no keyed wrapper), so it
  carries its own copy of the veil — otherwise "every route" would quietly have meant "every route
  except the one at the bottom of the rail".
- Worth knowing: Watch and Admin already print their own loading text ("Resolving…", the admin
  gate), so on those two the ring and that text are briefly on screen together. Blur is unchanged —
  those pages have no `.jv-route-content` wrapper, so nothing there is blurred, only ringed.

### Checks
- `scripts/test-loading-system.cjs` grew real behavioural tests (it loads `lib/loadProgress.js` and
  `lib/bootPhase.js` for real): the arc never exceeds the cap, an in-flight request keeps the ring
  open, the close lands on 1, the splash hands off at exactly 750 ms, the 200 ms rule, the abort-tag
  rule, the origin check, and CSS/source guards for the ring, the blur and the hook order.
- Writing that test found and fixed one real bug: `shouldTrack` was scoring **any** host's `/api/…`
  as section data, so a provider call to someone else's API could have held the ring open.

## Loading & switching — one system for every route (2026-10-13)

**The complaint:** "every section takes time to load … when I switch it shows like some
UI glitch." Three things caused that, and all three are gone.

1. **No transition.** Tapping a section unmounted the old page instantly, so the screen
   changed in one frame and *looked* like a glitch even when it was fast. The shell now
   owns the rail, the dock and the palette, and the page content is keyed by pathname
   (`components/AuthGate.js` → `.jv-route-content`), so a switch is a 200 ms content-only
   crossfade with the rail perfectly still. Steps back and forward animate the same way.
2. **The wrong placeholder.** Every route shared one poster-shaped skeleton and a floating
   "Opening X…" pill, so Live TV flashed posters and the pill competed with the skeleton —
   two indicators for one wait. The pill is deleted; pending feedback is now the pressed
   rail/dock item itself (`.is-pending` + `aria-busy`). `components/Skeletons.jsx` gives
   each section a fallback shaped like its real grid (shelf / channels / cards / posters /
   player) and `app/*/loading.js` picks the matching one.
3. **The 200 ms rule.** Nothing is shown for the first ~180 ms, so a warm or prefetched
   section shows no loader at all; only a genuinely slow route gets a skeleton. The delay
   lives in CSS (`.jv-skeleton-stage`, `animation-delay:.18s`), so a fast render cannot
   skip it. Rail and dock items also warm their route once the browser goes idle
   (`idleWarm`, skipped on save-data and 2G).

**App open** is now a branded splash (`components/BootSplash.js`, timing in
`lib/bootPhase.js`): the real logo, a progress line, and a **500 ms minimum** so it reads
as intentional rather than as a flash. It shares one background container with the unlock
card, so resolving the gate never flashes black or jumps the card. Past 2.6 s the note
turns honest ("still checking your access") instead of spinning forever.

Scope: every route obeys the same rules — Home, Live TV, Music, ExTRaS, Vault, Stremio,
`/my-list`, `/classics`, `/admin`, Watch and the unlock screen. Music keeps its own rail and
dock (`ownsOwnChrome`) so it cannot end up with two of either.

- `prefers-reduced-motion` turns the fades and shimmer off.
- New guard: `scripts/test-loading-system.cjs` (in `npm run verify`) fails if the pill
  returns, a page grows its own rail, the crossfade or the CSS delay disappears, or a
  section's skeleton stops matching its grid.
- `RELEASE-MANIFEST.json` is now generated (`scripts/make-manifest.cjs`, with `--check`);
  it had been hand-edited and was still listing routes deleted in the previous cleanup.

**Two real defects found while proving the above** (both were invisible in the build,
which only warned):

- `components/admin/LyricsTab.js` imported `lyricsSongKey` from `lib/lyricsMatch.js`,
  where it does not exist — the helper lives in the server-side `lib/lyricsStore.js`. The
  Admin lyric-key preview therefore printed `undefined`. It now uses `lyricCacheKey` from
  the pure matcher, which is the same key by definition.
- `scripts/check-source.cjs` now also verifies that every **named** import exists in the
  target module, not just that the path resolves. That check immediately caught
  `scripts/live-doctor.mjs` importing `buildPlaybackHeaders` — a function that was private
  in `lib/liveTv.js`, so the diagnostic tool could not even start. The function is now
  exported, and the usage line points at its real path.

## Cleanup — deploy-ready trim (2026-10-12)

- Deleted the legacy music UI that nothing imported: `MusicCurtains`, `MusicLyrics`,
  `MusicScreens`, `MusicBits`, `lyricLook`, `MusicRouteLink` (~90 KB). The live music
  screens are `MusicShell` + `CanvasLyrics`; `MusicProvider` lost its legacy re-export.
- Deleted `lib/player/liveEngine.js` + `lib/player/capabilities.js`: no importer, so the
  "planned live engine" never ran. Live playback is planned in `usePlaybackEngine.js`.
- Removed developer endpoints that shipped in production: `/api/seed` (already broken — it
  called the deleted `/api/zinkmovies/details`) and `/api/debug-scrapers`, plus the modules
  they exclusively owned (`lib/autoScraper.js`, `lib/providers.js`).
- Pruned six tests that asserted removed behaviour or could not run; added `npm run verify`
  and `docs/TESTING.md`, which documents every script and the opt-in Playwright suites.
- Docs corrected where they described removed modules (`LIVE-PLAYER`, `LIVE-COMPATIBILITY`,
  `DATABASE-MAINTENANCE`); the three pre-v5 lyric notes are now marked historical in favour
  of `docs/lyrics-pipeline.md`. `RELEASE-MANIFEST.json` no longer lists the removed routes.

# Fixed Canvas Music — 2026-10-08

- Approved desktop library/player split and mobile library sheet.
- Five correctly mapped categories: New, Tracks, Albums, Artists, Playlists.
- Persistent transport, bounded lyric follow, Bloom/Cinema/Noir, queue/settings overlays.
- Removed competing global dock/theme toggle only on Music.
- Removed five retired presentation files and approximately 63 KB of unused music CSS; preserved other sections and global mini-player.
- Added independent facet state, timeout/retry and stale-response guards.
- No new playback service or fake lossless/audio-analyser claims.

# 11.0.0 — unified playback and durable curation

## Requested behaviour

- Home, Vault, ReTro and Stremio catalogue entries use one Watch surface, with entry-specific approved priorities and preserved legacy links.
- Separate provider, episode and resolution controls; current episode survives source/quality switching.
- Hybrid recovery: native/Shaka errors use bounded alternatives; opaque iframe changes are explicit. Manual provider selections do not silently drift.
- Unmatched Home items enter Watch and support local TMDB/IMDb identity matching.
- Live stays dedicated. Explicit same-channel alternative groups, direct/targeted-relay transport and locked manual sources.
- Durable Live manual mapping/unmapping, protected empty lineups and guide overrides, non-destructive health state, source tombstones and unpublished new candidates.
- Lyrics-first Music redesign, independent collection/navigation/queue state, stale-response guards, persistent audio focus, inline errors and position-preserving bitrate changes.

## Correctness and maintainability

- Removed three independent on-demand playback implementations; retained compatibility redirects.
- Corrected grouped player callbacks, native-HLS policy handling, downward gestures, delayed recovery generation checks and watchdog placement.
- Fixed type-aware Vault matching/global quality badges, correct episode history URLs, cross-tab version notifications, Stremio raw-row paging and empty-pin persistence.
- Protected ReTro metadata/removal overrides, retained stream type, seeded registries only once and preserved other sources when a source is withdrawn.
- Fixed key normalization/HTTPS licence handling, source-level headers/filter retention, deep-check metadata propagation, ambiguous EPG prefix handling and owner guide context.
- Failed/empty Home scrape no longer overwrites the previous good catalogue. Related song searches are no longer passed off as a verified album tracklist.
- Player HTTP transport, media focus, Watch priorities, Music presentation/orchestration/attachment and public-destination fetch validation are separate modules.

## Security and operations

- Signed, expiring, realm-specific sessions; old indefinite hashes are retired. Password/epoch rotation revokes sessions; missing viewer configuration fails closed.
- Independent owner gate and owner-only service/data mutations. Cross-origin owner mutations rejected; local viewer favourites remain browser-only.
- Shared public-IP/DNS pinning with redirect validation, sensitive-header stripping, bounded waits, playlist read limits and final-base rewriting.
- Content Security Policy and consistent 7860/PORT handling. Separate scheduler and keepalive controls; Node 22 standalone container.
- Next 16.3.8 and compatible dependency updates. npm audit reports zero known vulnerabilities at verification time.
- Portable source/import checker, deterministic regression suite, browser fixtures and deployment documentation.

## Important limits

Third-party playback/entitlement/DRM, production MongoDB, multiple replicas, browser background restrictions and Docker runtime need deployment acceptance. The remote Worker adapter is not an active relay. Existing choices already deleted by the old logic require backups or manual reapplication. See docs/VERIFICATION.md.
