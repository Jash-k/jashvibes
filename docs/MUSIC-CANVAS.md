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
