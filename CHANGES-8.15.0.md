# v8.15.0 — Music: Light Curtains, rebuilt end to end

Complete project archive: `jashvibes-v8.15.0.zip`.

Picked from the generated concepts in `docs/concepts/music/` (board **31 · Light Curtains**), on two rules from the
brief: the new design must not be merged with the old UI, and the existing lock mode has to survive.

## Added

| Path | What it is |
|---|---|
| `lib/musicCore.js` | The section's pure half, moved out of the page so it can be tested without a browser: `QUALITY_LABELS`, `QUALITY_ORDER`, `trackKey`, `chooseBestQuality`, `isHlsUrl`, `formatTime`, `dedupeQueue`, `emptySearchResults`, `normalizeSearchResults`, `searchResultCount`, `splitArtistText`, `artistChipsFromTrack`, `parseLrcTimestamp`, `parseSyncedLyrics`, `plainFromSyncedLyrics`, plus the new model — `MU_TABS`, `MU_CHIPS`, `muTabs`, `muLyricRows`, `muCurtainPosition`, `muCurtainVars`, `muQualityChips`, `muLockView`, `MU_MINI_DRAG_CLOSE_PX`. No React, no fetch. |
| `components/music/Curtains.jsx` | The primitives the design is made of: `CurtainField`, `MuPanel`, `MuTabs`, `MuHeading`, `MuTile`, `MuTrackRow`, `MuTrackList`, `NowPlayingPanel`, `LyricsPanel`, `TransportStrip`, `MiniCapsule`, `LockVeil`, `MuNote`. Props in, markup out; no fetching, no storage. |
| `components/music/MusicCurtains.jsx` | The whole section: the retained logic (queue, quality, prefetch, wake lock, pocket mode, lyrics, import, song CRUD, session cache) with a new render written against the primitives above. |
| `tests/music-curtains.test.js` | 20 tests: the model (tab counts including `0`, tappable-only-when-timed, curtain position clamping, hue stability, quality chip order, every lock state), and the shipped files (old UI deleted, palettes that belong to other pages intact, exactly two blurred surfaces, theme tokens measured for contrast, lock machine present, mini capsule rules, no nested buttons). |
| `tests/auth-session-check.test.js` | 3 tests for the reload lockout fix described below. |
| `docs/concepts/music-ideas.md`, `docs/concepts/music/*.png` | The 36 concept boards and their write-up; 7 PNGs kept (the picked family plus the reference), the rest pruned on request. |

## Removed

| Path | Why |
|---|---|
| the render of `app/music/page.js` (1697 lines) | The old magenta UI. `palette-music-magenta`, the page's own sticky aside, `VinylArt`, `SectionHeader`, `HorizontalRow`, `TrackTile`, `AlbumTile`, `ArtistTile`, `PlaylistTile`, `TrackList`, `IconButton`, `SidebarButton` — deleted rather than restyled. The file is now a four-line wrapper. |
| `.palette-music-magenta` + `html.day-mode .palette-music-magenta` in `app/globals.css` | Nothing used them once the section was replaced. `.palette-deepsea`, `.palette-nordic` and `.palette-cybergrape` belong to other pages and a test keeps them alive. |

## Changed

| Path | What changed |
|---|---|
| `app/globals.css` | One new block, `.jv-mu-*` (~280 lines): the `--mu-*` token set, the three curtain shafts, panels, tabs, tiles, rows, transport, lyrics with its single light column, the mini capsule, the lock veil and bar, breakpoints at 900 / 560, `prefers-reduced-motion`, and a flat `@supports not (backdrop-filter…)` fallback. |
| `app/api/auth/route.js` | `GET /api/auth` — answers whether the HttpOnly session cookie is valid, nothing else. Takes no password and reads no body. |
| `middleware.js` | The `/api/auth` limiter now applies to **POST** only (`methods: ['POST']`, checked before the bucket is charged). |
| `components/AuthGate.js` | The saved-session check on load asks the `GET` first and only falls back to the token POST; a `GET` with no new token must not blank the stored one. |
| `package.json` | version `8.14.0` → `8.15.0`. |

## Why the auth change is in a design release

`/api/auth` is rate limited to 12 per 5 minutes to stop password guessing. The unlock screen verified its saved token
through that same endpoint on *every* page load, so half a dozen reloads on a phone locked the owner out of their own
single-tenant app — and it did the same to my browser probes. A cookie-only `GET` costs one comparison, so reloads are
free while password attempts keep their budget.

## Measured (headless Chrome, current build, night and day, 1440×900 and 390×844)

| Check | Result |
|---|---|
| Layout | 42 tiles on the shelves; every panel non-zero (playing `1180×435`, transport `1146×67`, tabs `1180×55`, lyrics `1146×206` open); `scrollWidth - innerWidth = 0`; phone `playing 366×862`, `transport 181`, `art 240` |
| Rail | `elementFromPoint(60, 420)` → `A.jv-rail-item`; `<main>` carries `jv-rail-shift` |
| Tabs | `▣ Albums 0` / `◎ Artists 14` / `♬ Playlists 0`; clicking Artists loads 14 tiles **from the facet endpoint**; empty Albums reads “the source returned no albums … or search a name above” with a `retry`; `aria-selected` follows |
| Playback through the new UI | `paused:false`, `t 3.73 → 5.74` of `dur 30`, title `Test Tone`, playing row marked `is_on:1`, quality chips `["320k*","160k"]` |
| Progress = the curtains | rail `scaleX 0.1187` at t 3.73/30 (12.4 %), background bead `--mu-pos: 0.1895` at t 5.74/30 (19.1 %) |
| Lyrics | 3 rows, states `past, past, current`, **`light: 1`** node total, `blur: blur(18px) saturate(1.15)`, tap-to-seek `8.3 → 4.2 s`; an unsynchronised file renders rows that are *not* tappable |
| Blur budget | 1 blurred surface with lyrics closed, 2 with them open, never 3 (a test pins the count) |
| Contrast | `--mu-ink` 17.57:1 (night) / 18.35:1 (day); `--mu-ink-dim` 7.24:1 / 5.98:1, both against the composited panel, not the bare background |
| Pocket mode | veil up, `elementFromPoint` over the transport returns `jv-mu-veil-inner`, ring `conic-gradient(… 54% …)` at 0.7 s of the 1.3 s hold, released early = still veiled, held = gone |
| Listening mode | bar reads “Wake Lock blocked by browser/battery settings, touch lock is active” with `hold 1.5s to leave`; hold leaves, short press does not |
| Mini capsule | appears on scroll `560×54` with title and rail, ✕ dismisses it |
| Suite | `npm test` **334/334** (`music-curtains` 20, `auth-session-check` 3), `npm run lint:player` 0 errors, `npx next build` ✓ (`/music` 19 kB / 125 kB) |

The music upstream (`saavnapi.onrender.com`) answers 404 from this sandbox and there is no MongoDB here, so playback,
lyrics and the playlist import were driven through the app's own code path with stubbed song and lyric responses and
a generated 30-second tone. Everything else above ran against the real endpoints.

## Deploy

Unpack over the app directory; no new dependency, no migration. `next build` then `next start` — restart rather than
reuse the running process, or the page's own JS chunks 400 and `/music` looks blank. `MONGODB_URI` is still needed for
imported playlists; without it the Playlists tab says so instead of pretending to be empty.
