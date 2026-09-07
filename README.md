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

## v8.6.0
- Live TV guide (R1 layout): `lib/liveEpg.js` parses an XMLTV feed (gzip accepted) straight out of the buffer — `Buffer.indexOf` scanning, never a 65 MB `toString()` — resolves each lineup channel to a feed channel (`tvgId` → exact normalised name → unique >7-char prefix), and keeps one **day index per process cache** (`globalThis.__jashLiveEpg`, keyed by day start only, single-flight, stale-while-error). Keying by day rather than day+lineup is the part that matters on a free tier: a search or a catalog filter changes the lineup, and a lineup-keyed cache would re-download and re-parse the whole feed per keystroke. Resolution itself is 0.8 ms for 42 channels, so `GET /api/live-epg/guide` answers in ~8 ms warm, ~1 s cold (3.3 MB gzip → 1,182 channels / 37k programme blocks, ~15 MB heap, once an hour). Nothing is written to MongoDB — a listing is derived data, so a restart just rebuilds it. `?lookup=` serves the manual-binding picker and `POST {action:'refresh'}` (service password) re-downloads through the same single-flight cache, so it cannot stack up. Every read failure degrades to `200 {ok:false}` plus the last known listing: a dead guide feed must not take the streams with it.
- `/live` restructured to the R1 design: the player shell, a programme card (now / minutes left / category / synopsis / up next) and a horizontally scrolling **today** strip (past blocks dimmed and labelled "ended", red now-line) live in the left pane; the channel rail rows now print their real now-title + progress bar + next programme instead of the hardcoded `LIVE HD` line. On phones (below `sm`) the card collapses into the sticky strip beside the video (`max-sm:w-[54%]` flex row — one `<video>`, no remount, no second player surface) with a ⤢ toggle back to the stacked layout, persisted in `localStorage` as `jash_live_guide_row` because the choice is per-device. `lg:min-h-0` + `lg:top-[calc(var(--live-header-h,84px)+1rem)]` stop the sticky left pane from clipping its own card, which is what "the desktop template was a scaled phone layout" actually looked like in the DOM. The quick-actions row (`‹ Pre` / `↩ Return` / `Nxt ›`, Last viewed, Fullscreen, Copy stream URL) stays in the left pane, so a phone reaches it right under the strip and a desktop reads it in one column with the card. Keyboard is unchanged and un-ambushed: outside the player frame the page answers `n`/`→`, `p`/`←` and `f`; inside it `lib/player/commands.js` owns the keys (there `n`/`p` are brightness and PiP), which is the split the page already documented — no new bindings were added, and no `?controls=dock` flag exists in this app despite earlier design notes assuming one. Every guide control is a plain `<button>`/`<input>`, so the global `:focus-visible` ring in `app/globals.css` gives TV-remote and Tab focus without extra CSS.
- Guide data reaches the UI through one hook (`useLiveGuide` in `components/live/LiveGuide.js`): one request for the whole lineup, a 60 s ticker that pauses while `document.hidden`, stale responses dropped by request id, and a distinct copy for every non-happy state (not linked / nothing scheduled today / feed failed / loading) so an empty card never reads as a broken player. Episode stills are deliberately not fetched from the feed (`<icon>` points at a third-party CDN with intermittent 404s): the card is logo + text, which is also what keeps a smart-TV wrapper from stalling on images.
- `npm test` 100 tests (new `tests/live-epg.test.js`, `tests/live-guide-ui.test.js` — the latter locks the layout contract: one player, the phone row variants, the whole-lineup fetch, the 200-not-500 error path, and "no model import in the guide read path"), `npm run lint:player` clean over `lib/liveEpg.js components/live app/api/live-epg app/live tests`, `next build` ✓, and `.env.example` documents `LIVE_EPG_URL` / `LIVE_EPG_TTL_MS` / `LIVE_EPG_TIMEOUT_MS` / `LIVE_EPG_TZ_MINUTES`. sw v61.

## v8.5.0
- Player unification round 2 (real-device pass): the bar is now play, -10, +10, time, volume (desktop), one burger and fullscreen on every device. The burger carries the current quality label and opens a sheet whose first section is the rendition list, so quality is one tap from the bar; freeze frame, PiP, AirPlay, stats and the audio/subtitle/source pickers live in that sheet, and the A-B loop, ambient-dim and lock controls were removed outright (keyboard commands only, declared desktop-only in `lib/player/commands.js`). The sheets now anchor inside the player frame instead of above it - they are siblings of the bar, and an outside-above anchor meant the frame's `overflow-hidden` clipped the whole menu, which is why clicking settings on desktop looked like nothing happened. `tests/player-commands.test.js` now proves each `button`/`menu` claim matches a real `data-jash-command`, which is what the old "settings does nothing on mobile" bug slipped past. Seeking (the important one): `readSeekWindow` treated `video.seekable` as the legal seek range for every source - but for a plain file `seekable` is only what has been buffered so far, so `clampToSeekWindow` silently rewrote "seek to 58:00" into "seek to 4s" on Telegram-Stremio MP4s, with no error to retry. A finite `duration` is now the seek range (live and DVR still use `seekable`), a refused seek is re-issued once (`seekVerifyRef`), `lib/player/recovery.js` will not start the ladder while the element is seeking, and every rung carries the position through a reload, so a slow host buffers instead of restarting the file at 0:00. The 3G/data-saver nudge (`DataSaverChip`, `useNetworkInfo`, `prefs.dataSaver`) is removed — pointless on single-rendition files.

- Player unification (see `docs/PLAYER.md`): `components/player/JashPlayer.js` + `usePlaybackEngine` replace DirectWatchPlayer, UniversalVideoPlayer, VideoPlayer.jsx (hls.js) and two hand-rolled Shaka copies inside /live and /watch. /live, /watch, /stremio-watch, /classics and /sports/player now share one resume rule (20s floor, last 15s refused, ≥95% counts as finished), one progress writer (5s · pause · fullscreen · pagehide · ended — Continue Watching finally fills from /classics and /stremio-watch too), one error mapping with the specific fix (retry / next source / drop DRM / refresh token / copy URL), one recovery ladder (retry-streaming → reanchor → reload → drop-drm → rotate-source, 12s ceiling) and one 37-command input table with a parity test that checks each command against a real control (`data-jash-command`), so nothing can claim a button that a phone cannot see. Seeking into an undownloaded byte range no longer trips the stall watchdog into a reload, which used to restart the file at 0:00. Source-specific behaviour moved to policies: `lib/player/policy/liveTv.js` (Jio token dance, ClearKey, header/segment rewriting, Pocket proxy) and `lib/player/policy/stream.js` (ReTro Widevine/ClearKey + Stremio headers). New: /player-lab fixture harness, subtitle delay + size, A-B loop, stats panel, ambient dim, Live Service → Tools player-report queue. Deleted the `hls.js` dependency (nothing else used it) and added `eslint` + react plugins as devDependencies so `npm run lint:player` runs from a clean clone. 79 tests in `tests/player-*.test.js` (`npm test`), `npm run lint:player` clean (0 errors, 0 warnings). sw v60.
