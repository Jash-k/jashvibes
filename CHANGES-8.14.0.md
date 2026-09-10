# v8.14.0 — one anime destination, and “playable” is now proven in your browser

Complete project archive: `jashvibes-v8.14.0.zip`.
For what v8.13.1 changed, see `## v8.13.1` in `README.md`; this file covers v8.14.0 only.

Two things were asked: remove the `/anime` section and keep only Tamil anime, and make Tamil anime playback
actually play. The second turned out to be a layout bug hiding behind a green test suite, and the rest is about
making the word “playable” mean something your device can confirm.

## Removed

| Path | Why |
|---|---|
| `app/anime/page.js` | The `/anime` TMDB animation grid. Deleted, not hidden — one anime destination was the request. |
| `app/api/anime/route.js` | Its only consumer was that page. |
| `lib/animeCatalog.js` | TMDB `with_genres=16` paging for the section above. |
| `tests/anime-catalog.test.js` | Tests for deleted code. |

`/anime` answers `307 → /anime/tamil` (`ANIME_REDIRECT` in `next.config.mjs`, deliberately **not** permanent so it
can be revisited) because the URL sits in bookmarks and caches; `GET /api/anime` is now `404`. `NAV_ITEMS`
(`components/navItems.js`) has 7 entries and no `href: '/anime'`, so no nav item lights up for a section that is
gone — `tests/home-rail.test.js` asserts both halves of that.

## Added

| Path | What it is |
|---|---|
| `lib/animeTamilProbe.js` | Client-safe, no network at import. `verifyFromBrowser(url, {kind, timeoutMs, fetchImpl})` walks manifest → first variant → one chunk of the first segment with `mode: 'cors'`, `credentials: 'omit'`, an `AbortSignal`, and **no `Range`** (a range request forces a preflight whose refusal says nothing about the stream), and answers `{ok:true, via}` / `{ok:false, why}` / `{ok:null, why:'took too long…'}`. An aborted read is never reported as “not a playlist”. `preFlightNote(verdicts, pickedLabel)` words the refusals: “is not allowed to fetch”, “answered HTTP 403”, “did not answer in time”, “switched to X”. |

## Changed

| Path | What changed |
|---|---|
| `components/anime/AnimeTamil.jsx` | Before a player mounts, the tab itself probes up to `MAX_PROBES = 3` rows in ladder order; the row label runs `reading… → checking… → play`; a ticket ref cancels probing if the sheet closes or another episode is picked mid-flight; `playStates` gains `checking`; `checkingNote` renders which hosts were skipped and why. `source.kind` is the row's kind, at both failover sites and the manual pick — and a hand-picked source clears `checkingNote`, because a stale warning under a working player is a lie. |
| `lib/animeTamilFeed.js` | Proven rows carry `kind: playKindFor({url, proven})` (`'progressive'` or a media extension → `'direct'`, else `'hls'`) instead of leaving the caller to guess. |
| `lib/animeTamilView.js` | `playerLineup` rows carry `kind`, and `format` says `HLS` or `Direct file` truthfully. |
| `app/globals.css` | `.jv-an-player` gains `flex: 0 0 auto` and `min-height: 120px`. The sheet body is `display: flex; flex-direction: column` with a definite height, and a block child sized only by `aspect-ratio` resolves to **0 px** there — so the stream attached, decoded and advanced inside an invisible box, which is exactly “click play and nothing happens”. A comment names the collapse so nobody tidies it away. |
| `next.config.mjs` | `ANIME_REDIRECT`. A config change needs rebuild **and** restart. |
| `tests/anime-tamil.test.js` | 66 → **76**: the browser pre-flight, “the sheet plays what it claims” (`kind` on every lineup row, five `setCheckingNote('')` sites), the player rule keeping `flex: 0 0 auto` + the floor, and “the anime section is one destination now”. |
| `tests/home-rail.test.js` | Realigned with the deletion: the `🌸` entry is gone, `/anime/tamil` owns the anime tab, `lit('/anime')` is `[]`. |

## Measured (headless Chrome against the live source, current build)

| What | Result |
|---|---|
| `/anime` | `307`, `location: /anime/tamil`; the page lands with 24 cards; rail reports exactly one lit entry `[🏴‍☠️ Tamil anime]`; `/api/anime` → `404` |
| Player box, before | `.jv-an-player` `615 × 0` with a playing video inside (`readyState 4`, clock advancing, `1280×720`) |
| Player box, after | desktop `615 × 345`, phone (390×844) `362 × 203`, video filling the box, in view |
| What the candidates were worth | `as-shipped` 0 · `align-self: flex-start` 0 tall *and* 0 wide · `min-height` alone 306 (wrong shape) · `flex: 0 0 auto` **345** ✓ · both 345 ✓ |
| Clean playback, Daemons S1 · E18 | tab fetched `master.m3u8 → index-v1-a1.m3u8 → seg-1-v1-a.ts` *before* mounting the player, then `playing: true`, `t 6.4 s`, `1280×720`, host `gate-1-an.vmnow.online`, notes `[]`, console errors `[]` |
| Vidmoly edge refused in-page | ladder moved to TurboVid and printed “Vidmoly — this browser was not allowed to fetch it (CORS or network); TurboVid is being tried.”; playback still recovered, because hls.js loads over XHR — so a blocked pre-flight **downgrades** a row, it never deletes one |
| `--autoplay-policy=user-gesture-required` | `paused:false, muted:true, t 13.94` — the engine catches `NotAllowedError`, boots muted, plays; a real gesture restores sound |
| Suite | `npm test` **311/311**, `npm run lint:player` 0 errors, `npx next build` ✓ (`/anime/tamil` 10.8 kB / 160 kB, no `/anime` route) |

## Deploy notes

Unpack over the app directory; nothing new to install and no data migration — `lib/animeTamilProbe.js` is the only
new module. `MONGODB_URI`, `ACCESS_CODE`, `JWT_SECRET` and `TMDB_API_KEY` are unchanged; `next build` then
`next start` (restart, do not reuse the old process — stale chunk hashes serve `400` for the page's own JS, which
looks like a blank `/anime/tamil`). `.env.example` documents the variables; `KOYEB.md` and `ENVIRONMENT.md` still
apply.
