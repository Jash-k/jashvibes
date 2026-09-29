# JaSH ViBeS — vault-first home + watch embeds removed

## New click flow (homepage movie/series)

1. User clicks a poster (or Watch now / search result)
2. Client calls `GET /api/vault/match?tmdbId=&imdbId=&title=&year=`
3. Match cascade: **TMDB → IMDb → title+year**
4. **Hit** → `/vault?play=<id>` (vault embed player, works for movies **and** series)
5. **Miss** → `/watch/{type}/{tmdbId}` (watch page)

## Watch page source chain (locked)

```
Stremio direct files  →  Direct MP4 (moviesda)  →  Global Mirchi
```

Removed from watch:

- onestream / moviesda **iframe** tier
- VidLink / VidEasy / VidZee / VidRock / VidSrc (server cards + auto fallback)
- `embeds.json` index read

Vault page (`/vault`) is unchanged — it still plays durable onestream embeds.
That is intentional: vault *is* the embed archive.

## Files touched

| File | Change |
|---|---|
| `lib/vaultMatch.js` | **new** — match helper |
| `app/api/vault/match/route.js` | **new** — match API |
| `app/page.js` | vault-first card + hero click |
| `components/rail/RailFocus.jsx` | `onWatchOpen` intercept |
| `components/CommandPalette.jsx` | vault-first search open |
| `app/watch/[type]/[tmdbId]/page.js` | servers = Auto / Stremio / Mirchi (+ Direct MP4 card) |
| `app/api/resolve/route.js` | auto chain + block third-party / iframe |
| `lib/providers/embedProviders.js` | DEFAULT_PRIORITY = mirchi only |
| `lib/player/sourcePriority.js` | ranks without onestream tier |
| `lib/moviesdaSource.js` | MP4 index only (no embeds.json) |
| `lib/moviesda/resolve.js` | `mp4Only` default, skip onestream candidates |

## Deploy

```bash
unzip jashvibes-updated.zip
cd jashvibes
npm install
# deploy as usual (Render / your host)
```

No new env vars required. Existing `TMDB_*`, Stremio, and session auth stay the same.
