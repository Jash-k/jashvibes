# JaSH ViBeS 🎬

Tamil-first private streaming hub — movies & series, live TV, music, and retro classics in one Next.js app —
with a full **admin control room** (`/admin`) that manages every section.

> Personal, single-tenant deployment. Host only sources you are authorized to access.

---

## Sections

| Section | Route | What it does |
|---|---|---|
| **Home** | `/` | TamilMV daily catalog + TMDB posters, ⌘K search, Continue Watching & My List |
| **Live** | `/live` | Live TV channels + XMLTV guide |
| **Music** | `/music` | Albums · Artists · Playlists, synced lyrics (play-only) |
| **ReTro** | `/classics` | Vintage Tamil cinema from VOD M3U catalogs + TMDB matching |
| **Stremio** | `/stremio` | Your Stremio addon as an in-app catalog + direct-file player |
| **Admin** | `/admin` | The control room — CRUD over every section (see below) |

One unified player (JashPlayer) everywhere: resume, quality picker, subtitles, gestures, PiP, A-B loop, DVR detection.

---

## Admin control room

Enter from the **⚙ Admin** gear at the bottom of the desktop rail (also in the ⌘K palette), or open `/admin` directly.
It opens with its own password — **`ADMIN_PASS`**, unique and separate from the theatre password. Unset = the whole
admin surface stays hidden and its APIs answer `503`.

| Tab | What you control |
|---|---|
| **Home** | Every scraped title with its **complete raw title before parsing** (expandable rows + copy), TMDB **match picker** (search posters or paste a link/id), **remove from home** (restorable, survives re-syncs), **pin to top**, permanent **title/year/quality overrides**, **Sync now / Purge cache** buttons, and **Kill admin sessions** |
| **Music** | All playlist management (Spotify import, rename, reorder, hide, delete) — `/music` itself is play-only |
| **TV** | The full Live TV service panel (sources, manual mapping, catalog order, EPG bindings, backups) + one-click **health sweep** |
| **ReTro** | CRUD over the classics VOD **sources** (add/edit/enable/delete + sync), items browser with removal |
| **Stremio** | Addon **registry** CRUD with manifest **health checks**, and the **global shelf pins** (same order on every device) |

Admin sessions last **12 h**; "Kill admin sessions" revokes every admin cookie instantly (no redeploy).
Removing a home title hides it via an override list — deletes would be undone by the next TamilMV sync,
so hidden rows are always restorable from the **Hidden** filter.


---

## Deploy on Render (free tier)

1. Push this repo to GitHub.
2. Render dashboard → **New → Blueprint** → pick the repo (`render.yaml` is detected automatically).
3. Fill the env vars it prompts for (see table below), then **Apply**.
4. Done — health checks run against `/api/health`, and the built-in keep-alive pings it every 10 min so the instance never sleeps.

### Environment variables

**Required**

| Key | Example |
|---|---|
| `DB` | `mongodb+srv://USER:PASS@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority` |
| `TMDB` | your TMDB v3 API key |
| `PASS` | your private unlock password |
| `ADMIN_PASS` | the admin control room password (unique; unset = admin disabled) |

**Optional**

| Key | Purpose |
|---|---|
| `LIVE_TV_PASS` | separate password for the /live Service panel (unset = disabled) |
| `SESSION_EPOCH` | change any string to revoke every issued session instantly |
| `SESSION_TTL_DAYS` | session cookie lifetime (default `180`) |
| `TAMILMV` | scraper domain when the default moves |
| `PROVIDERS` | embed provider priority order |
| `STREMIO` | your Stremio addon manifest URL |
| `VOD` | ReTro M3U sources (`Name\|url,...`) |
| `EMBEDS` | /embed-browser buttons (`Label\|url,...`) |
| `SAAVN` | music API mirror |
| `LIVE_EPG_URL` | custom XMLTV guide feed (default: Pocket-EPG) |
| `JIO_LIVE_COOKIE` | Jio fallback token |
| `CRON_SECRET` / `SCRAPE_TOKEN` / `SEED_TOKEN` / `SYNC_TOKEN` | tokens for admin/cron routes |
| `KEEPALIVE` / `KEEPALIVE_MINUTES` | keep-alive on/off + interval |
| `LIVE_SYNC_MINUTES` | live sources auto-sync interval (default 60, `0` = off) |

See `.env.example` for the full annotated list. The ReTro `VOD` sources and Stremio `STREMIO`/`STREMIO_WATCH`
addons now act as **first-run seeds only** — manage them from the admin panel after that.

---

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000
```

Production check:

```bash
npm run build
npm run start        # binds 0.0.0.0:${PORT:-7860}
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run start` | production server |

---

## Security model

- `middleware.js` authenticates **every `/api/*` request** against a session token (SHA-256 of `jash-theatre:PASS[:SESSION_EPOCH]`).
- Session travels as an HttpOnly cookie (`jash_access`), or `x-jash-token` / `?token=` for external tools (DevTools → Cookies to fetch it).
- Exempt: `/api/auth` (rate-limited login), `/api/health` (probes), `/api/cron/tamilmv` (own `CRON` secret).
- Rate limits on expensive routes; proxies block private/loopback hosts; admin routes fail closed.

---

## Structure

```txt
app/            pages (/, /live, /music, /classics, /stremio, /watch, /admin) + ~60 API routes
components/     AuthGate, rail/dock nav, CommandPalette, player/, live/, music/, admin/
lib/            scrapers, providers, player policy modules, auth, stores
models/         Mongoose schemas
public/         PWA manifest, service worker, icons
middleware.js   API auth firewall + rate limiting
render.yaml     Render Blueprint (Node runtime, free tier)
```

**Stack:** Next.js 15 (App Router) · React 19 · Tailwind CSS 3 · Mongoose 8 · Shaka Player 4
