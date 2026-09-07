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
- **Unified player (JashPlayer)** — one engine for /watch, /live, /classics, /stremio-watch and /sports: Shaka for HLS/DASH (native HLS on Safari when no headers are needed), double-tap seek ±10s (stacks), vertical swipe = volume (right) / brightness (left), horizontal swipe = scrub, long-press = 2× speed, screen lock, quality/audio/subtitle/speed sheets, external `.srt/.vtt` import with delay + size, PiP (Android + iOS), AirPlay, wake-lock, A-B loop, freeze frame, canvas snapshot, wheel volume / shift-wheel speed, stats overlay, 37-command shortcut map, live-vs-DVR detection and an auto-retry ladder that ends in a specific, actionable error card. See `docs/PLAYER.md`.
- **Live TV** — Jio (ClearKey/Shaka), Sony Ten/Sports Jio re-stream source, M3U sources, manual 6-catalog admin panel (Live Service). New default sources self-seed with a one-time background sync; only the curated Tamil cricket feeds auto-publish, everything else needs manual mapping.
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

## v8.5.0
- Player unification (see `docs/PLAYER.md`): `components/player/JashPlayer.js` + `usePlaybackEngine` replace DirectWatchPlayer, UniversalVideoPlayer, VideoPlayer.jsx (hls.js) and two hand-rolled Shaka copies inside /live and /watch. /live, /watch, /stremio-watch, /classics and /sports/player now share one resume rule (20s floor, last 15s refused, ≥95% counts as finished), one progress writer (5s · pause · fullscreen · pagehide · ended — Continue Watching finally fills from /classics and /stremio-watch too), one error mapping with the specific fix (retry / next source / drop DRM / refresh token / copy URL), one recovery ladder (retry-streaming → reanchor → reload → drop-drm → rotate-source, 12s ceiling) and one 37-command input table with a parity test so no command ships keyboard-only on touch devices. Source-specific behaviour moved to policies: `lib/player/policy/liveTv.js` (Jio token dance, ClearKey, header/segment rewriting, Pocket proxy) and `lib/player/policy/stream.js` (ReTro Widevine/ClearKey + Stremio headers). New: /player-lab fixture harness, subtitle delay + size, A-B loop, stats panel, ambient dim, data-saver cap, Live Service → Tools player-report queue. Deleted the `hls.js` dependency (nothing else used it) and added `eslint` + react plugins as devDependencies so `npm run lint:player` runs from a clean clone. 76 assertions in `tests/player-*.test.js` (`npm test`), `npm run lint:player` clean (0 errors, 0 warnings). sw v60.
