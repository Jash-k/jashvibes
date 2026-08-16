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

> **v6.5** — live-cricket match feeds and all background polling revoked (the Render free-tier usage spike it caused got the service suspended). /sports is now static Live-TV + FanCode streams; match-center scorecards fetch once per open.
> **v6** — API firewall (all routes authenticated), gesture player, personal library. Personal, single-tenant deployment.

---

## ✨ Features

- **Movies & Series** — TamilMV daily catalog + TMDB metadata, MiX (TamilOTT) catalog, multi-provider embed playback with per-provider health checks.
- **▶ Continue Watching & ❤ My List** — automatic watch history with playback-position resume (direct streams), favorites, per-title server memory. Stored in `localStorage` — no account, no DB cost.
- **Gesture video player** — double-tap seek ±10s (stacks), vertical swipe = volume (right) / brightness (left), horizontal swipe = scrub, long-press = 2× speed, screen lock, quality/subtitle/speed panels, external `.srt/.vtt` upload.
- **Live TV** — Jio (ClearKey/Shaka), Sony Ten/Sports Jio re-stream source, M3U sources, manual 6-catalog admin panel (Live Service). New default sources self-seed with a one-time background sync; only the curated Tamil cricket feeds auto-publish, everything else needs manual mapping.
- **Music (ராக வானம்)** — JioSaavn search, charts, albums, artists, playlists, Spotify import.
- **Sports** — FanCode/Willow **Cricket Live TV** channels with an in-page player, plus other-sports FanCode live streams (separate section). Cricket match-center scorecards load on demand. Nothing polls in the background — every sports page fetch runs once on load (free-tier friendly).
- **Classics** — VOD M3U catalogs with TMDB matching.
- **Stremio** — in-app catalog/meta/stream browser. Telegram chunk-stream sources are relayed through `/api/stream-proxy`, which emulates HTTP Range so seeking works; single-screen theatre mode on the watch page.
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
PROVIDERS=omega,vidlink,videasy,vidzee,vidrock      # embed priority order
TAMILMV=https://www.1tamilmv.report/                 # current scraper domain
OTT=https://tamilott.vercel.app/tamil_movies.json,https://tamilott.vercel.app/tamil_dubbed.json
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
  page.js                   # home: Recent / MiX catalogs + library rows
  watch/[type]/[tmdbId]/    # VOD watch page (provider select, S/E picker)
  my-list/                  # favorites + continue-watching library
  live/ music/ sports/ classics/ stremio*/ embed-browser/
  api/                      # ~70 routes (all session-protected)
components/
  VideoPlayer.jsx           # gesture player (hls.js + native)
  LibraryRows.js            # home-page Continue Watching / My List
  AuthGate.js               # unlock screen + lock button
lib/
  serverAuth.js             # token create/verify (shared with middleware logic)
  watchStore.js             # localStorage library
  providers/ tmdb.js liveTv.js musicApi.js tamilmvScraper.js ...
models/                     # Mongoose schemas
public/                     # PWA manifest, service worker, icons
```

For personal/educational use only. Host only sources you are authorized to access.
