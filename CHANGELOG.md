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
