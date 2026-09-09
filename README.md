---
title: JaSH ViBeS
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
app_port: 7860
---

# JaSH ViBeS 🎬🎵📺

Tamil-first private streaming hub — movies, series, live TV, music, sports and classics in one Next.js app.

> **v8.9.0** — the homepage is *only* Rail OS now: no header remnants. It reads rail → focused title → **two rows, Movies and Series**, each with its own "Load more". Search is the ⌘K palette alone. The rail/dock list is Home · Live · **Anime 🌸** · Music · Sports · ReTro · **Stremio** (My List is out of the nav), and `/anime` is a new TMDB Animation destination served from a 30-minute process cache.
> **v8.8.0** — the homepage is **Rail OS**: a fixed left rail on desktop and TV (phones keep the bottom dock, and both read one `components/navItems.js` list), one **focused title** you aim with arrows/Tab/remote instead of an autoplaying hero carousel, a slim bar for brand + search + embed utilities, and an "on air now" line that reads localStorage rather than asking the server. Layout chosen from six mockups in `docs/concepts/`.
> **v8.7.1** — correction to 8.7.0's diagnosis, measured against the real source: the addon's `/dl/` endpoint *does* answer byte ranges (`206` + `Content-Range`, `Accept-Ranges: bytes`, CORS open). Files that still restart are **Matroska without a usable seek index** — Chromium scans forward instead of jumping, which is why the Stremio app (mpv, which bisects ranges to build its own index) seeks fine. The clamp and the ladder hold were right; the accusation was not, so the copy now blames the file, not the host.
> **v8.7.0** — the player answers three complaints from real use: a sheet that "opened and froze" (the backdrop was locking the *page*, not the player), streams that restart at 0 after a seek (hosts with no `Accept-Ranges` are now detected from evidence and seek-clamped instead of reloaded), and a new **Aspect ratio** control in the burger (Fill / 16:9 / 4:3 / 2.39:1 / 9:16 / Stretch, remembered per device). Forum release names are tokenised properly, which is what restores the title *and* the poster on rows like "ImmortalCombat".
> **v8.5.0** — every video surface now runs one engine and one chrome (`components/player/JashPlayer.js` + `usePlaybackEngine` + `lib/player/*`): same resume rules, same error cards, same recovery ladder, same 37-command keyboard/gesture parity. The four old players and the `hls.js` dependency are deleted; `/player-lab` is the fixture harness. See `docs/PLAYER.md`.
> **v6.5** — live-cricket match feeds and all background polling revoked (the Render free-tier usage spike it caused got the service suspended). /sports is now static Live-TV + FanCode streams; match-center scorecards fetch once per open.
> **v6.5.4** — internal keep-alive: the server pings its own `/api/health` every 10 minutes so the Render free tier never sleeps (auto URL via `RENDER_EXTERNAL_URL`; disable with `KEEPALIVE=0`). Stremio works out of the box via the built-in Global Stremio addon default.
> **v6** — API firewall (all routes authenticated), gesture player, personal library. Personal, single-tenant deployment.

---

## ✨ Features

- **Movies & Series** — TamilMV daily catalog + TMDB metadata, manual Match-to-TMDB for unmatched posters, multi-provider embed playback with per-provider health checks, plus your Stremio addon as a direct-file server inside the watch page (Auto chain: Stremio → Mirchi → embeds, with an on-page quality dropdown).
- **▶ Continue Watching & ❤ My List** — automatic watch history with playback-position resume (direct streams), favorites, per-title server memory. Stored in `localStorage` — no account, no DB cost.
- **Unified player (JashPlayer)** — one engine for /watch, /live, /classics, /stremio-watch and /sports: Shaka for HLS/DASH (native HLS on Safari when no headers are needed), double-tap seek ±10s (stacks), vertical swipe = volume (right) / brightness (left), horizontal swipe = scrub, long-press = 2× speed, one settings sheet (quality inline) holding audio/subtitles/sources/speed/freeze/A-B loop/PiP/AirPlay/ambient/stats/lock, external `.srt/.vtt` import with delay + size, PiP (Android + iOS), AirPlay, wake-lock, A-B loop, freeze frame, canvas snapshot, wheel volume / shift-wheel speed, stats overlay, 37-command shortcut map, live-vs-DVR detection and an auto-retry ladder that ends in a specific, actionable error card. See `docs/PLAYER.md`.
- **Live TV** — Jio (ClearKey/Shaka), Sony Ten/Sports Jio re-stream source, M3U sources, manual 6-catalog admin panel (Live Service). New default sources self-seed with a one-time background sync; only the curated Tamil cricket feeds auto-publish, everything else needs manual mapping. The panel has a 7th tab, **Guide (EPG)**: feed age, how much of the lineup resolves to the XMLTV feed, a refresh button, and a per-channel binding picker. `/live` itself shows what is on now, how far through it is, what comes next and today's blocks — on desktop beside the channel rail, on a phone folded into the strip next to the video.
- **Music (ராக வானம்)** — JioSaavn search, charts, albums, artists, playlists, Spotify import.
- **Sports** — FanCode/Willow **Cricket Live TV** channels with an in-page player, plus other-sports FanCode live streams (separate section). Cricket match-center scorecards load on demand. Nothing polls in the background — every sports page fetch runs once on load (free-tier friendly).
- **Classics** — VOD M3U catalogs with TMDB matching.
- **Stremio** — in-app catalog/meta/stream browser with direct playback and a single-screen theatre mode on the watch page. Series stream requests are pinned to the IMDb base id + selected season/episode so the episode you picked is the one that plays.
- **PWA** — installable, offline page, day/night toggle, fullscreen landscape lock.

---

## 🔒 Security model (v6)

The password gate is no longer cosmetic — **`middleware.js` authenticates every `/api/*` request** against the session token (`SHA-256("jash-theatre:" + PASS)`):

| Credential | Where | Use case |
|---|---|---|
| `jash_access` **HttpOnly cookie** | set by `/api/auth` on unlock | the web app itself (automatic) |
| `x-jash-token` / `x-service-token` header | manual | scripts, service panel |
| `?token=<accessToken>` query | manual | external tools/cron needing access |

- **Exempt:** `/api/auth` (login; rate-limited 12/5 min/IP), `/api/health` (probes), `/api/cron/tamilmv` (own `CRON` secret).
- **Rate limits** on expensive routes (`/api/resolve`, `/api/search`, `/api/v2/stream`, `/api/match-resolve`, `/api/sports/dynamic`, `/api/stremio/stream`).
- **Fail-closed admin routes:** `/api/seed`, `/api/debug-scrapers`, `/api/vod/sync`, `/api/tamilmv?refresh=1` all require a valid session even when their optional tokens are unset.
- Security headers (`X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Frame-Options: DENY` for APIs), no `X-Powered-By`.
- Proxies block private/loopback hosts (anti-SSRF).

Get your access token for external tools: browser DevTools → Application → Cookies → `jash_access`.

---

## ⚙️ Environment variables

Only **3 required**:

```env
DB=mongodb+srv://USER:PASS@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
TMDB=your_tmdb_v3_key_or_v4_bearer
PASS=choose_a_strong_private_password
```

Common optional ones:

```env
LIVE_TV_PASS=tv2010                                  # Live TV service panel password (default tv2010); also works at the main unlock
PROVIDERS=stremio,mirchi,vidlink,videasy,vidzee,vidrock      # embed priority order
TAMILMV=https://www.1tamilmv.report/                 # current scraper domain
# Manual poster-to-TMDB matches persist in MongoDB (title_matches collection)
CRON_SECRET=token_for_/api/cron/tamilmv              # external scheduler
SCRAPE_TOKEN=token_for_forced_tamilmv_refresh
SEED_TOKEN=token_for_/api/seed
SYNC_TOKEN=token_for_/api/vod/sync                   # (SYNC / VOD_SYNC_TOKEN)
SAAVN=https://your-saavn-mirror                      # music API mirror(s)
STREMIO=https://your-stremio-addon/manifest.json
VOD=Name|https://.../list.m3u                         # classics sources
EMBEDS=Label|https://embed-site.example/             # embed browser buttons
JIO_LIVE_COOKIE=__hdnea__=st=...~exp=...             # optional Jio fallback token
LIVE_EPG_URL=https://your-xmltv-feed/epg.xml.gz       # live guide feed (default: Pocket-EPG)
LIVE_EPG_TTL_MS=3600000                                 # how long a parsed guide day is reused
```

Legacy aliases (`MONGODB_URI`, `TMDB_API_KEY`, `SPACE_PASSWORD`, …) still work. Never commit real secrets; `.env*` files are git-ignored.

---

## 🚀 Run

```bash
npm install
npm run dev          # http://localhost:3000
```

**Docker / Render / Hugging Face Spaces** (port 7860):

```bash
docker build -t jashvibes .
docker run -p 7860:7860 -e DB="..." -e TMDB="..." -e PASS="..." jashvibes
```

Render free tier: New Web Service → Docker → set the 3 env vars → deploy. The container binds `0.0.0.0:7860` automatically.

---

## 🗂 Structure

```txt
middleware.js               # API auth firewall + rate limiting  (v6)
app/
  page.js                   # home: Latest Releases + Match-to-TMDB posters + library rows
  watch/[type]/[tmdbId]/    # VOD watch page (provider select, S/E picker)
  player-lab/               # /player-lab: player fixture harness (noindex, dev tool)
  my-list/                  # favorites + continue-watching library
  live/ music/ sports/ classics/ stremio*/ embed-browser/
  api/                      # ~70 routes (all session-protected)
components/
  player/JashPlayer.js      # the one video player: chrome (controls, menus, gestures)
  player/usePlaybackEngine.js  # element + Shaka + recovery + resume + subtitles
  player/PlayerMenus.js     # quality / audio / subtitles / sources / context sheets
  LibraryRows.js            # home-page Continue Watching / My List
  AuthGate.js               # unlock screen + lock button
lib/
  player/                   # pure modules: kind, errors, recovery, resume, subtitles, prefs,
                            # labels, commands + policy/{liveTv,stream}.js  (unit-tested)
  serverAuth.js             # token create/verify (shared with middleware logic)
  watchStore.js             # localStorage library
  providers/ tmdb.js liveTv.js musicApi.js tamilmvScraper.js ...
models/                     # Mongoose schemas
public/                     # PWA manifest, service worker, icons
```

For personal/educational use only. Host only sources you are authorized to access.

## v7.7.0
- Custom DirectWatchPlayer on the watch page direct streams (Stremio/Telegram files): branded control bar (gradient scrubber + buffered bar + hover tooltip), -/+10s buttons, speed 0.5-2x, stream-source picker, PiP, fullscreen + mobile landscape lock, ambient theater dim + wake-lock, keyboard shortcuts, double-tap seek + hold-2x mobile gestures, buffering spinner, resume toast with Restart, next-episode pill, subtitles menu when tracks exist, auto-fallback rotates direct sources on stall/error. sw v47.

## v7.7.1
- stremio-watch DASH branch now uses DirectWatchPlayer too (was bare native controls) — every direct-video surface in the app has the custom player. sw v48.

## v7.7.2
- FIX: isDirectPlayerType now accepts streamType "direct" and matches .mkv/.mp4 mid-path (Telegram bot URLs carry trailing " ⁍ Quality..." text after the extension). Those files were being opened in a plain <iframe> (Chrome native media viewer) — hence native controls despite the custom player. sw v49.

## v8.0.0
- Seekable-window seeking in BOTH players (VideoPlayer + DirectWatchPlayer): all seek math clamps against video.seekable, fixing "seek restarts from first" on Stremio providers with live-style (Infinity-duration) manifests; plain-file reconnect reload now restores position.
- Center-pulse flash for ±10s seeks (same style as play/pause).
- Cursor resurrection: native cursor restored inside all player surfaces + fullscreen; CursorFX reticle/glow pauses over players (fixes invisible cursor in fullscreen and over embed provider players).
- jv-native-cursor class wired onto watch + stremio-watch player shells. sw v50.

## v8.0.1
- HOTFIX: TDZ ReferenceError in VideoPlayer.jsx (mediaWindow const was declared after seekBy used it in a useCallback dependency) — crashed the whole /stremio-watch route on first render. Moved declaration above both consumers. sw v51.

## v8.1.0
- VideoPlayer.jsx removed; ONE unified player everywhere: new UniversalVideoPlayer (Shaka DASH, Shaka/native HLS, plain files) + DirectWatchPlayer UI now drives /stremio-watch (both branches) and /sports/player. Stremio page button pad removed (player has ±10/30 via buttons+gestures+keyboard). DirectWatchPlayer gains onError prop. sw v52.

## v8.2.0
- Live TV player replaced Shaka-stock-UI with DirectWatchPlayer LIVE mode (LIVE badge, no scrubber unless DVR>120s, prev/next channel in bar, PiP/fullscreen/ambient); volume+speed now persist across channel switches (was: key={id} remount reset element volume).
- Floating QuickNav pill on every page (Home/Stremio/Live/Music/Sports/List) above MobileDock on phones, bottom-center desktop, 45% opacity until approached.
- Watch page stream menu labels: parse "1080p 2.9GB" from URL filenames (fallback meta->Source N) matching stremio-watch style.
- Running time always visible: elapsed shows regardless; total only when finite (Telegram MKVs with Infinity/NaN duration no longer degrade wrongly). sw v53.

## v8.3.0
- Ultra-slim header on Live TV, Stremio catalog, Stremio-watch, Classics, Music, Sports: BrandLogo gains size="mini" (32-36px; hero was up to 117px), paddings halved, captions shrunk. QuickNav floating pill removed entirely. sw v54.

## v8.3.1
- Live TV Jio token sources refreshed: sportlive18 jio-tv-auto-update-playlist (GitHub-Actions-fresh cookie.json + star2.json per-channel scoped cookies) added ahead of the dead/expired allinonereborn endpoints (jtv-fetch/jstr4web/2 now 404; jstrweb2 token expired). getJioStarAccessRecords learned the array shape [{name, stream_url, cookie}]. sw v55.

## v8.4.0
- Player UI visibility pass: brighter control bar (black/92 base), ALL buttons/icons + time numbers pure white (menus/ambient included); red LIVE pill + gradient scrub/title accents kept. Mobile auto-hide now 5s idle (desktop 3s), never hides while paused/scrubbing/holding/menu-open, and any tap on the control bar resets the timer. New SlimTopStrip brand band (mini logo to Home + small page title) on pages without a branded header. sw v56.

## v8.4.1
- SlimTopStrip now renders on EVERY page (titles for live/stremio/music/sports/classics added). Touch UX: single video taps only show/refresh controls; hide via idle timer only. sw v57.

## v8.4.2
- One header per page again (SlimTopStrip only on unbranded pages: home/watch/my-list/match/etc). Live first-play fix: autoplay-safe boot starts muted (browser policy blocks unmuted autoplay), retries if still paused after 4s, restores sound on first playing (desktop) or first tap (mobile). sw v58.

## v8.4.3
- BrandLogo resilient fallback chain (logo.png -> logo-source.webp -> JV monogram) fixes invisible mini logo when /public/brand is missing from file-wise deploys. sw v59.
## v8.11.1 — Catalog Shelf: the rail was eating the page, and Apply sent stale filters

Two fixes on `/stremio`, both found on the real screen rather than in the test suite.

**Nothing hides behind the left rail any more.** `.jv-st-page` carried its own `padding` shorthand, and
because it sits later in `globals.css` than `.jv-rail-shift` at the same specificity, it overrode the
78/188 px of left clearance the rail needs — the ruler, the `SORT`/`LANG` chips and the first poster column
were being drawn underneath the opaque rail. `.jv-st-page` now declares no padding at all (measured with headless
Chrome against the built CSS: `padding-left` is 188 px at ≥1280, 78 px at ≥1024, 0 on mobile where the rail is a
dock), and the gutters moved to the inner `.jv-st`, the way `.jv-dec-page` / `.jv-dec` already do. The header also
keeps 46 px of right-hand room so the fixed day/night toggle cannot sit on top of `N catalogs pinned`, and the
dock clearance follows to `.jv-st`.

**Filters do what they say.** Pressing `Apply` set the filters in state and then fetched — from a ref that a
`useEffect` only syncs after the render, so the request that went out carried the *previous* filters while the chip
already showed the new one. `run()` now takes the filters for that fetch (`run(catalog, { filters })`) and the ref
is only a fallback for reloads; the first Apply after picking a genre or language is no longer a page behind.
On top of that, the option lists are the addon's: a manifest that declares `extraSupported: [{ name: "genre",
value: { options: [...] } }]` now drives both what gets sent and what the chip reads back (`filterOptions` /
`optionLabel` in `lib/stremioShelf.js`), with the app's own list used only when a catalog declares nothing — so a
catalog that writes `action` no longer gets our guess of `Action` and answers with an empty page.

Regression guards: 4 new tests in `tests/stremio-shelf.test.js` (203 total, all passing) — one that fails if
`.jv-st-page` ever declares padding or margin again, one that fails if the apply handler goes back to a bare
`run()`, one that a manifest-declared option list has to satisfy, and one that reads the query the catalog
server actually received and requires the filter to be on it.

## v8.11.0
- **/stremio is the Catalog Shelf**, built from idea 1 of `docs/concepts/stremio-redesign.html` (six mockups, each with
  desktop + mobile side by side: `docs/concepts/stremio-idea-*.png`). One tab per pinned catalog across the top, fuchsia
  underline on the one you are in, that catalog's filters as chips under it, and a poster grid whose last cell is
  `load more`. The rail is mounted on the page; phones keep the dock.
- **The old chrome is deleted, not hidden**: the "Authorized Addon / Catalogs" hero card, the `<select>` + Add picker,
  the five-field filter form with Apply/Clear, the chip row with `×` remove whose click focused nothing
  (`activeCatalog` was computed and never rendered), the horizontal rails with `‹ ›` arrows and a `More` button,
  `MasonryGrid`, `BrandLogo`, the `← Home` chip. `EmbedSiteLinks` is the one exception — /embed-browser has no other
  link anywhere, so it moved into the catalogs sheet (`.jv-st-embeds`) instead of being dropped with the card.
- **Filters cannot lie any more.** `/api/stremio/catalog` returns `{ items, count, hasMore }` with no total, and a Stremio
  catalog only honours the extras in its own `extraSupported`. The old page sent `search`/`genre`/`language`/`sort` to
  every catalog, so a catalog that ignored one showed an unfiltered list under chips claiming otherwise. New rule, in
  `lib/stremioShelf.js`: `buildShelfQuery` sends an extra only when the catalog declares it (aliases `search|query`,
  `sort|order`, `language|lang`, `genre|genres`) and returns the refusals, which the chip strip prints as
  `genre ignored here`. Filters are stored per catalog, so "Highest Rated" on one tab cannot silently describe another.
- **One press, one request.** Arrival reads the manifest and then page 1 of the focused catalog only — the old mount
  looped over every pinned catalog. `load more` appends one page at `skip = items.length`, dedupes across skip
  boundaries by `type:id`, stops at 40 pages and says so, and a failed reload keeps the rows already on screen.
- Tab counts are what this device loaded (`25 · more`), never a promised total. Pinned catalogs stay in
  `jash:stremio:selectedCatalogs:v2` (an existing shelf survives the change); focused tab + filters in
  `jash:stremio:shelf:v1`. Nothing here writes to Mongo, polls, or fetches per render.
- Dark surface in both themes: every `.jv-st*` rule that sets a size also sets its own colour (`html.day-mode main`
  paints `color:#102018 !important`), no `!important` anywhere on the surface, focus rings on every control for the TV
  wrapper, a reduced-motion block, and 104 px of bottom padding on phones so the dock never sits on the last row.
- `lint:player` now covers `app/stremio` and `lib/stremioShelf.js` (it watched `app/stremio-watch` only). 199/199 tests,
  build ✓ `/stremio` 9.91 kB / 116 kB, `next start` smoke 200 on /stremio, /classics, /live, /. sw v73.

## v8.10.2
- **The empty decade tabs are gone.** v8.10.0 filled every gap between the oldest and newest title with a zero so
  "nothing here" would be visible — which on screen was a `1940s` you could not press, dimmed and labelled `empty`.
  `buildDecades` now returns only decades that actually hold titles, and the `tab.empty` flag, its disabled state,
  its `empty` caption and its CSS are deleted rather than restyled. The arrow-key walk no longer has to step over
  dead tabs either.
- Completeness did not get weaker: the ruler is still provable, because the decade counts plus the `No year` bucket
  have to equal what the same query counted (`accounted` / `unaccounted`), and the test asserts the exact list of
  decades for both a gappy histogram and the 490-title fixture.

## v8.10.1
- **The decade numerals were missing — my bug, and now a test.** The page never stored the `facets` that came back with the rows, so `facets.years` stayed empty and the ruler could only ever print
  `Everything`. `app/classics/page.js` now stores facets from the response, and there is a small first request — `readFacets`, one row at `limit=1` — whose only job is to buy the ruler: counts per decade,
  the year span next to the heading, and which decade to open on. Two tests pin it: one that the page contains the store, one that `readFacets` returns a ruler from a page-1 payload.
- **Rebuilt to the mock, not to the old page.** The nav rail is now mounted on this route (and the 188px left gap finally has something in it); the ruler is big numerals with an amber underline on the live
  decade instead of filled pills; the chosen decade is written again behind the rows as a ghost at 5%; every row carries its year and source in the right gutter, the title in a bookish serif and the score
  as a large amber figure; the year group headers, the search box, the source/genre/rating selects and the `jv-dec-tool` pills are deleted rather than restyled. The control surface is `RATING ↓`, `YEAR ↑`,
  `SYNC` and a status chip — that is all.
- **Initial load is no longer thirteen requests.** The page opens on the newest decade that has titles (one or two requests) instead of Everything, and the walk paints each page as it lands instead of
  waiting for the end: the first 60 rows appear after request one, and the count ticks up underneath. Everything is still one tab away and still loads fully — it just isn't the front door. `loadAllPages`
  now hands `items` to `onProgress` per page, which is the whole fix.
- **This surface is dark in both themes.** Like the homepage banner, `html.day-mode .jv-dec-page` restates the near-black, and every text-bearing rule declares its own colour — because `html.day-mode main`
  is an `!important` blanket and anything that inherits gets painted dark-on-dark. The day-mode test walks the stylesheet block and fails if a rule sets a font without a colour, or if the component reaches
  for a Tailwind `bg-*`/`text-*` utility.
- `npm test` is 168 (24 for the Decade Room, including the 490-title fixture over HTTP that asserts every decade tab's rows equal that decade's slice and that the buckets add up to the archive).

## v8.10.0
- **ReTro is now the Decade Room** (idea 3 from `docs/concepts/classics-redesign.html`). The ruler of decades is the
  navigation: pick 1980s and the page becomes that decade as a spine of titles grouped by release year, oldest or
  newest first. The old page was a grid of 24 rows behind a 6-field filter slab, so "the filter doesn't show all my
  movies" was true in two ways: the default was `source: 'Aha'`, which hid every ErosNow title, and even the decade
  chips only narrowed page 1 of a paged grid.
- **A decade now reads to the end.** `loadAllPages` in `lib/classicsDecade.js` walks `/api/vod` at 60 rows a page
  (the route's own ceiling) until it stops promising more, dedupes rows that shift between pages, and only then
  hands the list to the component. The header sentence — `All 118 loaded — nothing from this decade is hidden behind
  a page` — comes from `shelfStatus`, and it claims completeness only when the rows on screen equal the `total` the
  same query reported. If a sync lands mid-walk the count moves, so the page says `16 still to fetch` and shows a
  **Keep loading** button instead of lying. 25 pages is the stop-loss; the button raises it.
- **Nothing is silently invisible.** Titles with no year (unmatched on TMDB) get their own **No year** tab, because
  a year window drops them; _(v8.10.2: decades with zero titles are no longer offered at all — a tab you cannot press is not a fact, it is a bug.)_; and the **Everything** tab counts what the *current filters* allow, from the same
  histogram the decade tabs use, so the ruler always adds up.
- `/api/vod` gained what the ruler needs and nothing more: `facets.years` (a per-year count over the filter
  *without* the year window, one `$group` in the same round trip), `undated=1` for the no-year tab, and
  `archiveTotal` / `filteredTotal` for the completeness math. No new endpoint, no poll, no Mongo write.
- One fetch per view, not two: the session cache (`jash:classics:v2`) restores decade, filters, rows and scroll
  position and the fetch effect skips exactly that first run — the old page fetched on mount *and* again from the
  filter effect.
- Keyboard and remote first: the ruler is a `tablist` with arrow/Home/End and a roving tabindex, focus follows the
  decade you chose, rows are plain links, and every state (loading, error, empty, first sync) has a retry or a way
  out. Day mode has an explicit value for everything the page paints — checked by a test that parses the CSS and
  fails if a painted class has no `html.day-mode` twin, with thumbnails the only exemption.
- `npm test` is 166. `tests/classics-decade.test.js` (22) runs the real `loadAllPages` against a 412-title fixture
  served over HTTP that mirrors the route's filtering and paging, and asserts that every decade tab's rows equal the
  fixture slice for that decade, that decade counts plus the no-year bucket equal the shelf, and that no title lives
  outside every tab.

## v8.9.2
- **The hero stopped talking about live TV.** The banner printed a `Star Vijay HD · …` pill in its top-right corner
  because v8.8.0 wired an "on air now" chip into `RailFocus`, but the banner is a *movie or series* poster chosen
  from the catalogue — so the page read as one product wearing another's badge, and the channel line was the
  least trustworthy sentence in the app: it could only ever be as fresh as your last visit to `/live`. The chip,
  its red dot and its CSS are deleted, and so is the localStorage contract that fed it (`lib/liveNow.js`) plus the
  publisher in `/live` — a feature with no reader is not a feature, it is a second place to be wrong.
- `RailFocus` now takes `slide` and `eyebrow` only; the homepage no longer reads or writes guide state at all. Live
  TV is one tap in the rail, where the guide actually knows what is on.
- Tests are 144: the five that exercised `liveNow` went with the file, and one replaced them — a guard that the
  hero contains no `onAir` prop, no `href="/live"`, no `.jv-focus-onair`/`.jv-focus-dot` rule and no `liveNow`
  state on the page, so this cannot be reintroduced as "just a small badge".

## v8.9.1
- **Day mode washed the artwork out and the title looked blurred — same root cause.** The light theme repaints
  anything carrying a Tailwind background or text utility, and my `html.day-mode .jv-focus` rule turned the banner
  into a `#f4f4f5` slab with near-black type over a dark poster, so the art disappeared and the type had nothing
  to sit on. The blur was a 26 px text shadow doing contrast work it was never meant to do. The banner is now
  treated as artwork, not chrome: it keeps its own dark panel and white title in *both* themes (a poster's light
  does not change when the app's chrome does), the art sits at 0.72 instead of 0.6, and the title carries a tight
  2 px edge shadow over a real gradient shade layer. `npm test` guards the built CSS for the day-mode background,
  the opacity and the largest shadow blur, so this cannot quietly come back.
- **The small cards inside the hero are gone** — the strip, its roving tabindex and its arrow-key handling. A
  thumbnail rail inside a banner is a control inside a control, and it doubled up with the two rows below, which
  are now the only browser. The secondary `Details` button went with it: same href as *Watch now*, so it was
  decoration — and it carried Tailwind text colours the day theme would have repainted anyway.
- `RailFocus` takes one `slide` instead of a list. The homepage aims it at whatever you are half-watched into
  (`Resume · 34%`), otherwise the freshest entry in the scrape, and the eyebrow says which of the two it is.
- `npm test` is 149: two structural assertions that described the deleted strip were rewritten to the new
  contract rather than dropped.

## v8.9.0
- **Rail OS alone: the old header is deleted, not folded in.** Gone from `app/page.js`: the brand block (logo, `JaSH ViBeS` wordmark, "last update" line), the inline search field, the Sync button, the embed-provider pills, the `Latest Releases` card, the Movies|Series tab pair, the masonry grid + skeleton, and the Continue Watching / My List section — 935 lines of page down to 28 kB of source with no dead state left behind (`activeTab`, `updatedAt`, `syncStatus`, `sentinelRef` and the `currentItems`/`currentPaging` aliases are all removed, because a half-removed header is still a header). What the page renders is `RailNav` → `RailFocus` → two catalogue rows → the ⌘K palette.
- **Two rows instead of a tab switcher, and it costs nothing extra.** The single `/api/tamilmv?page=1&limit=15` call already returns `movies` *and* `series`, so the tabs were hiding half of what had been downloaded. `CatalogRow` renders one horizontal snap strip per group with its own count read-out and its own **Load more**, wired to the per-group `?group=movies|series` paging the infinite-scroll sentinel used to walk — so the `IntersectionObserver` and its 700 px rootMargin are deleted, and a remote or a thumb can walk a row deliberately. Each row keeps the `🎯 Match` affordance because it reuses `MediaCard` inside a fixed-width tile (`.jv-row-tile`, 8.75rem → 10.5rem at `sm`).
- **Search is the palette.** There is no field on `/` any more, so the rail's Search button calls `setPaletteOpen(true)`; `CommandPalette` already binds ⌘K/Ctrl+K globally and hits the same `/api/search`. The row read-out ("N more in the scrape") is a `<span>`, not a dead link — an anchor to `/?row=movies` that only re-rendered the same page was the alternative, and it is the kind of thing a redesign leaves behind.
- **Nav: seven destinations, one list.** `components/navItems.js` is Home · Live · **Anime (🌸)** · Music · Sports · ReTro · **Stremio**, with `My List` deliberately absent (the library is where you go to *resume*, and the focus panel links `/my-list?tab=history` whenever something is half-watched). `MobileDock` derives `gridTemplateColumns` from the array — seven labels in a hardcoded `grid-cols-6` would have wrapped the last one off-screen — both shells render `item.emoji` when present, `isNavItemActive()` is the single active-state rule, and Stremio keeps `hard: true` (a document reload, because a soft route change keeps a stale addon manifest alive).
- **`/anime` is a real destination, not a filter over what loaded.** The daily scrape carries no genres, so `lib/animeCatalog.js` asks TMDB `discover/{movie|tv}` for `with_genres=16` + `with_original_language=ja` (that language clause is what makes "anime" mean Japanese animation rather than every cartoon in the index), `sort_by=popularity.desc`, clamped to 10 pages. Cached in `globalThis.__jashAnimeCatalog` for 30 minutes with single-flight de-dupe and stale-while-error, nothing in MongoDB, so a restart just refetches; `GET /api/anime` answers **200 `{ok:false}`** when TMDB misbehaves, so the page shows "listing unavailable · Retry" rather than a red screen or a 5xx. The page makes one request per toggle or page, aborts the previous one, and its Retry bumps a `nonce` — setting `type` to the value it already has makes React bail out and the effect would never re-run. Bundle: `/anime` 3.1 kB / 109 kB.
- **`/embed-browser` was not orphaned by deleting the pills.** Those buttons were the only link to that page anywhere in the app, so they moved rather than vanished: `components/EmbedSiteLinks.jsx` now renders under the addon header on `/stremio`, where "which sources can I play" is the question being asked. Side effect worth having: the homepage no longer fetches `/api/embed-sites` at all (it did on every visit, for buttons almost nobody pressed). `/` is 13.2 kB / **119 kB** first load, down from 173 kB.
- **No manual-sync UI anywhere now**, by request. The catalogue still refreshes hourly via `GET /api/cron/tamilmv`; to force it, `GET /api/tamilmv?sync=1&manual=1` (session cookie or `?token=`). A pre-existing `activeCatalog` unused-var in `app/stremio/page.js` was left alone — that path is not in `lint:player` scope and touching it is not this change's business.
- Tests: `tests/home-rail.test.js` (15, rewritten for the new contract: nothing orphaned by the deleted header, palette-only search, two rows each paging their own group, strip CSS + day-mode + reduced motion), new `tests/anime-catalog.test.js` (5: discover params, page clamping, item shape, settle-with-no-key, route degradation), and `tests/live-service-panel.test.js`'s "no client-side filter rail" test now asserts rows-per-group instead of tabs. `npm test` 147, `npm run lint:player` clean plus an explicit eslint pass over `app/page.js`, `app/anime/page.js`, `app/api/anime/route.js`, `lib/animeCatalog.js`, `components/EmbedSiteLinks.jsx`, `app/stremio/page.js`, `components/navItems.js`, `components/MobileDock.jsx`, `components/rail/`, `next build` ✓, and `next start` smoke: `/`, `/anime`, `/stremio`, `/live`, `/my-list` all 200 with no server errors. The built home chunk carries no `embed-sites`, no `Latest Releases`, no `tmdb-search` and exactly one "Load more" per row; 🌸 ships as `\uD83C\uDF38` in `navItems`. sw v67.

## v8.8.0
- **Rail OS, picked from six mockups** (`docs/concepts/homepage-concepts-sheet.jpg`, full-res tiles alongside it). The old homepage spent ~12rem on a wordmark, six ghost buttons and a self-advancing carousel — on a phone that pushed the first real title below the fold, and on a smart-TV box the carousel's `setInterval(…, 50)` was redrawing every frame of a rotation nobody on a personal app asked for. `app/page.js` no longer contains `setInterval` at all.
- **One nav list, two shells.** `components/navItems.js` is the only copy of the six destinations; `MobileDock.jsx` renders it as the bottom bar below `lg`, and the new `components/rail/RailNav.jsx` renders the same array as a fixed rail at `lg+` (`hidden lg:flex` against the dock's `lg:hidden`), with `aria-current="page"`, a gradient active bar, 3rem-tall targets and labels that appear only when there is room (`xl`). They used to be two hardcoded arrays, which is how a section ends up reachable on one device and missing on the other. Stremio and the dynamic embed-provider buttons stayed in the bar's utility cluster instead of joining the rail: they are utilities, not destinations, and the six destinations the rail replaces are exactly the six the mobile dock already carries — put Stremio in the rail only and a phone loses it, which a test now checks. The page pays for the rail with `.jv-rail-shift` (`padding-left: 78px` at `lg`, `188px` at `xl`), so a phone never gets phantom padding.
- **`RailFocus` replaces `HeroCarousel`.** The strip of tiles is a roving-tabindex `listbox`: `←/→/↑/↓`, `Home`, `End` move the ring, `scrollIntoView` keeps it centred, and the big panel behind it is that title's own backdrop with its title, year, kind and quality chip. When the item is half-watched the CTA reads `Resume · 57%` (history comes from `getHistory()` through `useLibraryVersion()`, so it updates without polling) and unfinished titles lead the strip with a "Where you left off" note; a release with no TMDB match still gets a tile and says why, because hiding it would hide the thing to fix. Focus slides are capped at 14 and deduped by href.
- **"On air now" costs nothing.** `lib/liveNow.js` is a 2-field localStorage contract: `/live` publishes the guide row it already fetched, the homepage reads it once after mount (in an effect, not during render — the server has no storage, and a render-time read would fight hydration) and prints nothing older than 2 hours, because a stale "now" is a lie about the present tense. A homepage request to `/api/live-service/channels` + `/api/live-epg/guide` for one line of text is exactly the free-tier tax this app has to keep paying to other features, so it does not exist here; `tests/home-rail.test.js` fails if `/` ever learns the string `live-epg` or `live-service`. _(The chip this fed was removed in v8.9.2; the no-guide-request rule stays.)_
- **Three URL builders became one.** `/watch/{type}/{tmdbId}` was spelled out in `MediaCard`, in the hero and in the search dropdown — the last of those also dropped the season/episode query. `watchHref(item)` in `app/page.js` is now the only shape (quality hint included, `?` vs `&` handled once), and search rows without a `tmdbId` are filtered instead of linking to `/watch/movie/undefined`. A test asserts the literal appears exactly once.
- Day-mode and `prefers-reduced-motion` are handled for every new class (`.jv-rail*`, `.jv-focus*`, the on-air chip), the focused title keeps the old hero's `text-shadow` legibility trick over artwork, and the now-unused `.jv-hero*` rules are deleted from `app/globals.css` (`jv-hero` appears 0 times in the built stylesheet). New `tests/home-rail.test.js` (13 tests: the `liveNow` contract as real behaviour, the shared nav list, one-nav-per-breakpoint, no autoplay, keyboard aiming, single href builder, theme guards). `npm test` 140, `npm run lint:player` + the new files clean, `next build` ✓ (`/` is 13.2 kB / 123 kB first load, down from the carousel build), built chunks carry `jv-rail-item`/`jv-focus-*` and no `jv-hero`. Layout verified against the built CSS/JS and an SSR smoke (`/`, `/live`, `/my-list` all 200, no server errors); not verified in a real browser — there is no Playwright in this sandbox, so aim-and-ring feel is yours to check. sw v66.

## v8.7.1
- **"In Stremio seeking works perfectly, so why does the app blame the host?" — it was wrong, and it has been measured.** Probed the default Global Stremio addon the app actually plays from: `GET /stream/movie/tt36931126.json` → one stream, `url` on the addon's own `…koyeb.app/dl/thalaajith/<token>/…mkv` (so the bytes come from the user's addon deployment, not from Telegram), and against it: `Range: bytes=0-` → `206` with `content-range: bytes 0-963985796/963985797`; `bytes=20000000-20001023` → `206`; the same range requested three times → `206` each time (no single-use token); a tail range where Matroska keeps its `Cues` → `206`; `accept-ranges: bytes`, `access-control-allow-origin: *`, `access-control-expose-headers: Content-Length, Content-Range, Accept-Ranges`. That is a model range-serving origin. So 8.7.0's status line — "this host ignores byte-range requests" — was false for the very source the complaint came from.
- **The real cause is the container index.** The files are `video/x-matroska` (`content-type` says so), and in Matroska/WebM seeking depends on the `Cues` element; when it is absent or written after the data, Chromium's demuxer cannot map a time to a byte offset, so a forward seek becomes a **linear scan from where it is** — the reader walks toward the target, which on a 964 MB file is indistinguishable from "it restarted at 0" ([Mozilla 696519](https://bugzilla.mozilla.org/show_bug.cgi?id=696519), [657791](https://bugzilla.mozilla.org/show_bug.cgi?id=657791): *"Chrome is able to seek in such files, but it looks like they're doing a linear scan"*; seeking only in the already-downloaded part is the documented browser limit). Stremio desktop/Android never hits this because mpv/FFmpeg build their own index by bisecting with range requests, and its local service re-serves the file — the player is doing the work the browser refuses to. `behaviorHints` is absent from this addon's streams, so it never even flagged "not web ready", and our `mapStremioStream` hands `stream.url` to the element raw (`crossOrigin` is only set when a source asks for it, ruled out here; `el.src` is never rewritten — no token we could be breaking).
- **What changed in code.** The mitigation stays (it is the correct response to *both* causes: clamping a doomed jump prevents the reload that would re-read the file, and the 20 s ladder hold stops the restart loop), and the naming and copy now tell the truth: `noRangeRef`/`noRangeHoldRef` are `coarseSeekRef`/`coarseSeekHoldRef`, `clampSeekTarget(…, { noRange })` is `{ coarse }`, and every string says the **file** has no seek index the browser can use rather than accusing a server. `docs/PLAYER.md` records both causes, the mpv difference and the `curl -r` recipe to re-measure before anyone "fixes" the wrong one again. `tests/player-aspect-seek.test.js` (11) now fails if the misleading sentence comes back. `npm test` 127 tests, `npm run lint:player` clean, `next build` ✓. sw v65.
- **Not changed, on purpose:** no server-side range proxy. The browser-side fix for a cueless file is `mkvmerge --clusters-in-meta-seek`-style re-muxing, which we cannot do to someone else's upload; piping 964 MB through a 512 MB free-tier container to manufacture ranges Stremio's localhost service manufactures for free would burn egress and memory on every single seek — the exact class of background traffic that got the service suspended before.

## v8.7.0
- **The shortcut/settings sheet "opens and freezes" was a modal layer, not a stuck render.** `Menu`'s dismissal layer was `fixed inset-0 z-40` — an invisible click-catcher over the *whole document* — while the panel (`z-50`) sits inside the player frame and is clipped by its `overflow-hidden` when it grows too tall (the shortcut list is 37 rows). When the panel was clipped or the sheet failed to paint, the site stayed unclickable with nothing on screen to click, and Escape only closed it while the player still held focus — which a click on the channel rail or a track row takes away. Now: the backdrop is `absolute inset-0 bg-black/35` (inside the player, and *visible*, so a stray click's owner is legible), both sheets cap their height against the frame (`max-h-[min(70%,calc(100%-8rem))]`, scroll region likewise) so the header and its close button can never be clipped away, the panel takes focus on mount (`tabIndex={-1}` + `focus()`), and `JashPlayer` owns a document-level capture-phase Escape while `menu`/`contextMenu` is set.
- **Seek behaviour is now honest about hosts that ignore `Accept-Ranges`.** Two files from two hosts behave oppositely on the same UI, and nothing in the URL predicts which: a Telegram/Stremio direct MP4 that does honour ranges seeks anywhere, one that does not restarts the *download* — `currentTime` lands at 0, the file plays, the stall watchdog reads that as death, the ladder reloads, and the reload restarts the file. That loop was the "starts from 0" report. The engine now earns a verdict instead of guessing: `seekVerifyRef` keeps the time that was **asked** (not the clamped one it settled for), retries once, and a second consecutive miss on a finite non-live file sets `noRangeRef`. From then on `clampSeekTarget(el, target, { noRange: true })` keeps forward seeks inside what has actually downloaded (buffer end − 5 s, never behind `currentTime`; backwards stays free), `noRangeHoldRef` holds the recovery ladder for 20 s so a "stall" that is explained is not "fixed" by a reload, the status line says why the scrubber moved less than asked, and the track shows "scrub limited to downloaded" (`engine.seekRefused`). The verdict resets when a *new* source loads, not when the same one reloads. `readSeekWindow` still prefers a finite `duration` — the round-4 rule was right, and a range-supporting host must keep full-file seeking. **Attribution corrected in 8.7.1**: the mechanism shipped, the label did not — see that entry.
- **Aspect ratio changer in the burger.** `lib/player/aspect.js` holds the modes (Auto / Fill / 16:9 / 4:3 / 2.39:1 / 9:16 / Stretch) and returns inline style for the `<video>` — `cover` to crop the bars, `fill` to squeeze, a forced `aspectRatio` + `contain` + `margin:auto` to letterbox inside the frame, `{}` for Auto so the class default survives untouched. It is deliberately *not* the `aspect` prop a page passes (`'fill'` from `/live`, `/watch`, `/classics`, `/sports/player`, `/stremio-watch`): that sizes the **box**, this chooses the **picture**, and they are separate keys so a page layout can never override a viewer's eye. Stored as `prefs.aspect` (`DEFAULTS.aspect = 'auto'`, validated through `isAspectMode` so a value from a future build falls back instead of blanking the frame) and announced in the sheet next to Speed, which is where `tests/player-command-parity.test.js` expects a control to be — no new command is claimed, because there is no new key binding.
- **"ImmortalCombat" was one glued word because only `-` was a separator.** A 1tamilmv row's title came from the URL slug (`…ImmortalCombat.2025.[Tamil].1080p…`), `titleCaseSlug` split on `-` only, and `parseReleaseMetadata` preferred the human anchor text *only if it contained a year* — so `Immortal (G.V. Prakash)` was discarded in favour of the slug. One normaliser now owns it (`lib/releaseTitle.js`): strip the file extension, split on `[-_.+]+`, break `camelHumps` at `([a-z0-9])([A-Z])` while leaving acronym runs (`KGF`, `WEB-DL`) alone, keep the year and quality tokens so the year/quality parser still reads them. The visible title wins whenever any real words are left (`looksLikeHumanTitle`), no year required, and the same humaniser runs on the href-derived text used for matching. Fixing the spacing also fixes the poster: `normalizeMatchTitle` removes punctuation and noise words but **cannot invent a space**, so a glued title never matched TMDB and the `mapped.title || item.title` override could not arrive. Titles are re-derived on the next catalog sync (`/api/tamilmv` `$set`s the whole payload), so the row corrects itself hourly or on Sync — the site itself is unreachable from this sandbox, so the shape is proven against real release strings, not against a live scrape.
- `tests/release-title.test.js` (5) and `tests/player-aspect-seek.test.js` (11) cover all four: slug→words, acronym safety, visible-over-slug, no page-wide blocker, frame-capped sheets, document Escape, `clampSeekTarget` with and without ranges, the 20 s hold, the per-source reset and the aspect style/prefs/menu wiring. `npm test` 127 tests, `npm run lint:player` clean, `next build` ✓ (`/live` 20.3 kB / 172 kB). sw v64.

## v8.6.2
- Second live symbol, finished properly: besides the top-bar/live-badge overlap fixed in 8.6.1, the tuned channel's row in the rail carried a red `animate-ping` dot — the same "this is live" idea a third time, next to a row already drawn with a red border, a gradient wash and a white title. It is deleted; the player owns the one live marker. `tests/live-guide-ui.test.js` now asserts `/live` contains no `animate-ping` and no `jv-badge-live`.
- Continue Watching is for on-demand titles only. Live TV channels were being written into the history store (`/live` passed `library={{ watchKey: 'live:…' }}`, and the progress writer upserted a row for it) — so the homepage row filled with "Untitled" channel entries, each claiming you watched 40 minutes of a simulcast, and they ate slots of the 60-row budget that real titles need. Three layers now agree on it: `/live` passes `persist: false` (the contract `JashPlayer` already had), `usePlaybackEngine` refuses to persist whenever `derivePlaybackModel(el).live` is true — which also covers a DVR-windowed simulcast and any future live surface that forgets the prop — and `lib/watchStore.js` refuses live/`tv:`/`channel:`/`match:`/`sports:` keys on write, filters them on read (Continue Watching *and* My List, plus `isFavoriteItem`, so a heart can never show "saved" for a row the list cannot display), and prunes rows an older build already stored, writing the cleanup back once. Movies and series are untouched: `movie:` / `series:` / `stremio:` keys keep resuming exactly as before, because the point was to stop channels, not to lose your place in a film. New `tests/library-continue-watching.test.js` (6 tests) covers the write refusal, the read filter, the legacy prune, My List and the engine's live check. sw v63. `npm test` 111 tests.

## v8.6.1
- Live service panel no longer freezes on a first source load. The freeze was never the network — `GET /api/live-service/channels` answered fine, the panel then mounted every row, and a fresh M3U is 5,000 rows × ~12 buttons, which blocks the main thread for seconds. The Manual-mapping list is now **paged by the API** (`limit`/`page`/`q`, which the route already supported and nothing used: 200 rows per page), and the search box plus the Mapped/Unmapped and category selects are sent as `q`/`mapped`/`category` instead of re-filtering the loaded page — so a channel on row 4,300 is now reachable *and* typing costs one debounced request (320 ms) instead of a re-render of everything. `channelRowsFiltered` stands down when the mounted page already answers to the current controls, so nothing is ever filtered twice by two different rule sets. The mapped and main-preview lists cap at 400 rows with a "Show 400 more · N still hidden" button inside `startTransition`, so revealing rows never blocks typing. Prev/Next is a real pager with the range shown.
- Panel → Preview showed a black box and nothing else. `JashPlayer`'s `compact` variant rendered its root without a size while every child of it (video, spinner, overlays, bar) is `position: absolute` — so the box collapsed to 0px inside the `aspect-video` slot. The compact root now carries `h-full w-full` (the caller's box is the contract) and the preview wrapper is `relative aspect-video`. A channel with no stream URL now says "… has no stream URL to preview" instead of showing an empty frame, and a failed preview still gets the inline Retry.
- Two LIVE symbols on one channel: the player drew the red ping + "LIVE" in the top bar *and* `LiveBadge` in the control row for a non-seekable stream, and the card under the player repeated it a third time with a static "Live" pill. The header row now appears only when the control bar is showing a DVR track instead of the badge (`live && canSeek`), so every mode has exactly one live marker, and the card's pill is deleted. During loading you see the spinner and one LIVE, not a pair.
- The homepage "Quick Filter Rail" (4K / Tamil / High rated) is removed, filter state and all — it re-filtered only what had loaded so far, so a page boundary could make the catalog look empty. Movies/Series tabs and the search field are the filters, and both ask the provider.
- `tests/live-service-panel.test.js` (5 tests) locks all four: no 5,000-row fetch, filters go to the API and never double-filter, the compact player fills its box, one live marker per player, no filter rail on `/`. `npm test` 105 tests, `npm run lint:player` clean, `next build` ✓, `next start` smoke: `/`, `/live`, `/player-lab`, `/api/live-epg/guide` all 200 and the live chunk no longer contains `jv-badge-live`. sw v62.

## v8.6.0
- Live TV guide (R1 layout): `lib/liveEpg.js` parses an XMLTV feed (gzip accepted) straight out of the buffer — `Buffer.indexOf` scanning, never a 65 MB `toString()` — resolves each lineup channel to a feed channel (`tvgId` → exact normalised name → unique >7-char prefix), and keeps one **day index per process cache** (`globalThis.__jashLiveEpg`, keyed by day start only, single-flight, stale-while-error). Keying by day rather than day+lineup is the part that matters on a free tier: a search or a catalog filter changes the lineup, and a lineup-keyed cache would re-download and re-parse the whole feed per keystroke. Resolution itself is 0.8 ms for 42 channels, so `GET /api/live-epg/guide` answers in ~8 ms warm, ~1 s cold (3.3 MB gzip → 1,182 channels / 37k programme blocks, ~15 MB heap, once an hour). Nothing is written to MongoDB — a listing is derived data, so a restart just rebuilds it. `?lookup=` serves the manual-binding picker and `POST {action:'refresh'}` (service password) re-downloads through the same single-flight cache, so it cannot stack up. Every read failure degrades to `200 {ok:false}` plus the last known listing: a dead guide feed must not take the streams with it.
- `/live` restructured to the R1 design: the player shell, a programme card (now / minutes left / category / synopsis / up next) and a horizontally scrolling **today** strip (past blocks dimmed and labelled "ended", red now-line) live in the left pane; the channel rail rows now print their real now-title + progress bar + next programme instead of the hardcoded `LIVE HD` line. On phones (below `sm`) the card collapses into the sticky strip beside the video (`max-sm:w-[54%]` flex row — one `<video>`, no remount, no second player surface) with a ⤢ toggle back to the stacked layout, persisted in `localStorage` as `jash_live_guide_row` because the choice is per-device. `lg:min-h-0` + `lg:top-[calc(var(--live-header-h,84px)+1rem)]` stop the sticky left pane from clipping its own card, which is what "the desktop template was a scaled phone layout" actually looked like in the DOM. The quick-actions row (`‹ Pre` / `↩ Return` / `Nxt ›`, Last viewed, Fullscreen, Copy stream URL) stays in the left pane, so a phone reaches it right under the strip and a desktop reads it in one column with the card. Keyboard is unchanged and un-ambushed: outside the player frame the page answers `n`/`→`, `p`/`←` and `f`; inside it `lib/player/commands.js` owns the keys (there `n`/`p` are brightness and PiP), which is the split the page already documented — no new bindings were added, and no `?controls=dock` flag exists in this app despite earlier design notes assuming one. Every guide control is a plain `<button>`/`<input>`, so the global `:focus-visible` ring in `app/globals.css` gives TV-remote and Tab focus without extra CSS.
- Guide data reaches the UI through one hook (`useLiveGuide` in `components/live/LiveGuide.js`): one request for the whole lineup, a 60 s ticker that pauses while `document.hidden`, stale responses dropped by request id, and a distinct copy for every non-happy state (not linked / nothing scheduled today / feed failed / loading) so an empty card never reads as a broken player. Episode stills are deliberately not fetched from the feed (`<icon>` points at a third-party CDN with intermittent 404s): the card is logo + text, which is also what keeps a smart-TV wrapper from stalling on images.
- `npm test` 100 tests (new `tests/live-epg.test.js`, `tests/live-guide-ui.test.js` — the latter locks the layout contract: one player, the phone row variants, the whole-lineup fetch, the 200-not-500 error path, and "no model import in the guide read path"), `npm run lint:player` clean over `lib/liveEpg.js components/live app/api/live-epg app/live tests`, `next build` ✓, and `.env.example` documents `LIVE_EPG_URL` / `LIVE_EPG_TTL_MS` / `LIVE_EPG_TIMEOUT_MS` / `LIVE_EPG_TZ_MINUTES`. sw v61.

## v8.5.0
- Player unification round 2 (real-device pass): the bar is now play, -10, +10, time, volume (desktop), one burger and fullscreen on every device. The burger carries the current quality label and opens a sheet whose first section is the rendition list, so quality is one tap from the bar; freeze frame, PiP, AirPlay, stats and the audio/subtitle/source pickers live in that sheet, and the A-B loop, ambient-dim and lock controls were removed outright (keyboard commands only, declared desktop-only in `lib/player/commands.js`). The sheets now anchor inside the player frame instead of above it - they are siblings of the bar, and an outside-above anchor meant the frame's `overflow-hidden` clipped the whole menu, which is why clicking settings on desktop looked like nothing happened. `tests/player-commands.test.js` now proves each `button`/`menu` claim matches a real `data-jash-command`, which is what the old "settings does nothing on mobile" bug slipped past. Seeking (the important one): `readSeekWindow` treated `video.seekable` as the legal seek range for every source - but for a plain file `seekable` is only what has been buffered so far, so `clampToSeekWindow` silently rewrote "seek to 58:00" into "seek to 4s" on Telegram-Stremio MP4s, with no error to retry. A finite `duration` is now the seek range (live and DVR still use `seekable`), a refused seek is re-issued once (`seekVerifyRef`), `lib/player/recovery.js` will not start the ladder while the element is seeking, and every rung carries the position through a reload, so a slow host buffers instead of restarting the file at 0:00. The 3G/data-saver nudge (`DataSaverChip`, `useNetworkInfo`, `prefs.dataSaver`) is removed — pointless on single-rendition files.

- Player unification (see `docs/PLAYER.md`): `components/player/JashPlayer.js` + `usePlaybackEngine` replace DirectWatchPlayer, UniversalVideoPlayer, VideoPlayer.jsx (hls.js) and two hand-rolled Shaka copies inside /live and /watch. /live, /watch, /stremio-watch, /classics and /sports/player now share one resume rule (20s floor, last 15s refused, ≥95% counts as finished), one progress writer (5s · pause · fullscreen · pagehide · ended — Continue Watching finally fills from /classics and /stremio-watch too), one error mapping with the specific fix (retry / next source / drop DRM / refresh token / copy URL), one recovery ladder (retry-streaming → reanchor → reload → drop-drm → rotate-source, 12s ceiling) and one 37-command input table with a parity test that checks each command against a real control (`data-jash-command`), so nothing can claim a button that a phone cannot see. Seeking into an undownloaded byte range no longer trips the stall watchdog into a reload, which used to restart the file at 0:00. Source-specific behaviour moved to policies: `lib/player/policy/liveTv.js` (Jio token dance, ClearKey, header/segment rewriting, Pocket proxy) and `lib/player/policy/stream.js` (ReTro Widevine/ClearKey + Stremio headers). New: /player-lab fixture harness, subtitle delay + size, A-B loop, stats panel, ambient dim, Live Service → Tools player-report queue. Deleted the `hls.js` dependency (nothing else used it) and added `eslint` + react plugins as devDependencies so `npm run lint:player` runs from a clean clone. 79 tests in `tests/player-*.test.js` (`npm test`), `npm run lint:player` clean (0 errors, 0 warnings). sw v60.
