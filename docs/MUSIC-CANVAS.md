# Fixed Canvas Music — release notes

## Layout and source mapping
- Desktop (>900px): app rail, Library on left, current artwork/lyrics on right, shared transport below.
- Mobile (≤900px): player canvas; Open Library reveals the bounded library sheet above persistent mini-player. Close/Return to player restores player. Short screens shrink artwork.
- New → `/api/music/new`, albums + tracks.
- Tracks → `/api/music/trending`, trending song selection (not a promise of a complete song catalogue); favourites filter and song search.
- Albums → `/api/music/albums`; selection → `/api/music/album`.
- Artists → `/api/music/artists`; selection → `/api/music/artist` top songs + available albums.
- Playlists → `/api/music/playlists` plus imported lists; selection → `/api/music/playlist`.
- Search → existing `/api/music/search`, results mapped to selected category.
- `tab` and mobile `library` state are URL-backed. Collection contents and query are local state.

Only panel contents scroll. Browsing and opening collections do not replace the queue. Playing a track/Play all explicitly queues its collection; Add to queue appends. Existing media focus, readiness/recovery, quality-position retention and streaming integrations are preserved. The global app dock is omitted only on Music.

## Focus mode (the lock button in the transport)

One button, three effects, and one thing that must stay truthful:

- **Blur.** Every layer except what you chose to look at blurs (`filter: blur(16px) brightness(.6)`):
  topbar, library, now-playing text, the Lyrics panel's own header and footer, transport, rail, dock.
  In **lyrics** mode the sleeve blurs too and the lines stay sharp; in **artwork** mode the sleeve stays
  sharp. Blurring is applied per layer rather than to an ancestor, because `filter` creates a stacking
  context — blurring `.mc-player` would trap the Artwork/Lyrics toggle under the lock layer.
- **The one live control.** The Artwork/Lyrics toggle is deliberately raised above the lock layer
  (`z-index:170` vs the guard's `150`) so you can change what focus shows without unlocking. It is the
  only interactive element while locked, and the touch guard is not an `aria-modal` dialog precisely
  because that control is meant to be used.
- **Touch lock, and nothing written on it.** `PocketLock` draws one thing — the drag handle at the
  bottom. There is no lock glyph, no "Focus locked", no swipe hint, no footer: a caption printed over the
  lyrics you locked the screen to look at defeats the point. The swipe's own feedback is the vignette
  thinning as you pull. Four ways out — swipe down anywhere, slide the handle right, Escape, or the Back
  button. Focus pushes exactly one history entry, so Back leaves focus instead of leaving the Music
  section; a gesture exit gives that entry back. The handle keeps an accessible label and the region keeps
  an accessible name, because the words were on screen, not gone from assistive tech.
- **Screen awake.** `lib/wakeLock.js` requests Screen Wake Lock inside the click (the API needs a user
  gesture), releases when focus ends, and re-takes it when the tab becomes visible again. Unsupported
  browsers (iOS before 16.4, some in-app browsers) and refusals are announced through the shell's status
  line ("This browser will not hold the screen awake") — the shell, not the guard, because the guard
  prints nothing now. Silence there would be the one lie this state must not tell. No silent-video
  fallback.

The mobile Lyrics panel has **no exit button**: the Library button leaves focus, and the gestures above
leave locked focus. The desktop expand glyph remains. The earlier `listeningMode` / `pocketMode`
prototype in `MusicEngine` (plus its second wake-lock implementation and the unused `muLockView` helper)
was dead code and has been removed.

Lyrics refresh, line-tap seek, follow/resume, timing offset and font-size controls are available. Plain lyrics are labelled and not fabricated as synchronized. Three appearance modes replace the ten legacy modes; old lyric source-selection/translation UI is not retained. Current automatic lyric service remains unchanged. Appearance is stored under a new local storage key. Decorative spectrum is opt-in and is not an audio analyser; reduced-motion hides it.

## Verification for this release
- `npm ci` succeeded.
- `npm run check` parses 220 source modules with no unresolved local imports.
- Production webpack build passed, including after dependency audit fixes.
- Production dependency audit reported zero known vulnerabilities after compatible transitive updates.
- Production standalone server started; health endpoint responded.
- Fixture Chromium browser checks passed at 1440×900, 390×844, 320×568, 844×390: five tabs, collection opening/back, browse-without-play, explicit Play all using generated WAV, queue preserved on tab switch, queue contents, settings Escape close, lyrics focus, no page JS errors, body dimensions and transport within viewport.
- Browser tests use deterministic responses, placeholder artwork and generated WAV audio—not real copyrighted media or production upstreams.
- Real DB persistence, upstream availability, DRM, Docker runtime, Safari/iOS background audio and remote-control interaction were not tested.
- Older verification claims in repository documentation describe prior releases and are not new tests of this release.

To rerun fixture browser checks: install optional test tooling with `npm install --no-save --package-lock=false @playwright/test`, `npx playwright install --with-deps chromium`, start the built production server on port 7860 with test-only passwords and `LIVE_SYNC_MINUTES=0`, then run `npm run test:music`. `MUSIC_SCREENSHOTS` can specify a local output directory. Do not deploy fixture credentials.

## Deployment
The ZIP is a complete source repository, not a prebuilt binary. Use Node 22 LTS, your host's environment secrets, a working MongoDB and permitted upstream sources. `.env.example` contains placeholders only. Build `npm ci && npm run build`, launch `npm start`; PORT defaults to 7860. Existing Dockerfile and host configuration remain included. Back up your production DB before deploying. UI/source modifications were local; no GitHub push was made.
