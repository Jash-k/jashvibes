---
title: JaSH ViBeS
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
app_port: 7860
---

# JaSH ViBeS — Hugging Face Spaces Deployment Guide

JaSH THEATRE is a Tamil-first personal streaming prototype built with:

- **Next.js App Router**
- **React**
- **Tailwind CSS**
- **MongoDB Atlas + Mongoose**
- **Secure server-side ScreenScape proxy API route**
- **Sandboxed iframe player page**

The homepage displays **Tamil** content first. Other languages/categories are shown inside dropdown sections.

> Important: This app is for personal educational use. Only add media sources and streams that you are legally allowed to access and display.

---

## 1. Project Structure

Core files:

```txt
app/
  api/
    stream/
      route.js              # Secure ScreenScape proxy endpoint
  watch/
    [id]/
      page.js               # Client-side iframe player page
  globals.css               # Tailwind global styles
  layout.js                 # Root layout and metadata
  page.js                   # JaSH THEATRE landing/home page
lib/
  db.js                     # Cached MongoDB connection helper
models/
  Media.js                  # Mongoose Media schema
Dockerfile                  # Hugging Face Spaces Docker deployment
package.json                # Next.js scripts and dependencies
README.md                   # Deployment instructions and Space config
```

---

## 2. Hugging Face Space Configuration

This README starts with Hugging Face Spaces YAML front matter:

```yaml
---
title: JaSH THEATRE
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
app_port: 7860
---
```

Because this project is a **Next.js Docker app**, it must use:

```yaml
sdk: docker
```

Do **not** use:

```yaml
app_file: app.py
```

`app_file: app.py` is for Python/Gradio-style Spaces, not Docker-based Next.js deployments.

---

## 3. Environment Variables — Simple Mode

You only need **3 required secrets** for normal deployment:

```env
DB=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
TMDB=your_tmdb_v3_api_key
PASS=choose_your_private_theatre_password
```

That is enough for:

- password entry screen
- homepage/search/latest TMDB metadata
- MongoDB cache/saved provider metadata
- all built-in embed providers with default domains
- TamilMV listing cache using the default domain

Optional only if you need them:

```env
PROVIDERS=tamilott,screenscape,vidlink,vidnest,videasy,vidzee,vidrock,vixsrc,oneembed,vidsrcsbs,vidsrc
TAMILMV=https://www.1tamilmv.report/
TAMILMV_CACHE_LIMIT=90
OTT=https://tamilott.vercel.app/tamil_movies.json,https://tamilott.vercel.app/tamil_dubbed.json

# Clean Embed Browser
EMBED=https://piratexplay.cc/language/tamil/
ELABEL=PirateXPlay Tamil
# or multiple:
EMBEDS=PirateXPlay Tamil|https://piratexplay.cc/language/tamil/,Example|https://example.com
```

`OTT` is for TamilOTT playback matching and accepts one URL or multiple comma-separated URLs. It expects items with `stream_title`, `stream_url`, and optional `omdb.Title`, `omdb.Year`, `omdb.Type`, `omdb.Poster`. If unset, the built-in TamilOTT JSON defaults are used; set `OTT=off` to disable playback matching.

The homepage also has an **OTT Catalog** button. It uses LIFO ordering from:

```txt
Default: https://tamilott.vercel.app/tamil_movies.json
Switch:  https://tamilott.vercel.app/tamil_dubbed.json
```

Optional overrides:

```env
OTT_MOVIES=https://tamilott.vercel.app/tamil_movies.json
OTT_DUBBED=https://tamilott.vercel.app/tamil_dubbed.json
```

Old/long names still work for backward compatibility:

```txt
DB also accepts MONGODB_URI or DB_URI
TMDB also accepts TMDB_API_KEY
PASS also accepts SPACE_PASSWORD or APP_PASSWORD
PROVIDERS also accepts EMBED_PROVIDER_PRIORITY
TAMILMV also accepts TAMILMV_BASE_URL
OTT also accepts TAMILOTT_JSON_URL
EMBED also accepts CLEAN_EMBED_URL, EXTERNAL_SITE_URL, SITE_URL
ELABEL also accepts CLEAN_EMBED_LABEL, EXTERNAL_SITE_LABEL, SITE_LABEL
EMBEDS also accepts CLEAN_EMBED_SITES, EMBED_SITES
```

Do **not** add secrets to variables beginning with `NEXT_PUBLIC_`.

---

## 4. MongoDB Atlas Setup

### Step 1: Create a MongoDB Atlas database

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas).
2. Create a free or paid cluster.
3. Create a database user with username and password.
4. Allow network access.

For simple testing, you can add this IP allowlist entry:

```txt
0.0.0.0/0
```

For production, restrict access where possible.

### Step 2: Copy your connection string

It should look similar to:

```txt
mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/jash_theatre?retryWrites=true&w=majority
```

Use this as your `MONGODB_URI`.

---


---


---


---


---


---


---


---


---


---


---


---

## 1TamilMV Daily Listing Scraper

The homepage now includes a daily cached listing scraper inspired by:

```txt
https://github.com/firofame/1tamilmv/blob/main/scrape.js
```

It separates scraped listings into:

```txt
Movies
Series
TV Shows
```

Configure the current 1TamilMV domain with a Hugging Face/Railway secret or variable:

```env
TAMILMV_BASE_URL=https://www.1tamilmv.report/
```

If the site domain changes, only update `TAMILMV_BASE_URL` and redeploy/restart.

The app caches scraped results in MongoDB for 24 hours, so the homepage does not scrape on every page load. Endpoints:

```txt
GET  /api/tamilmv                  # returns cached data, refreshes if older than 24 hours
GET  /api/tamilmv?refresh=1&token=YOUR_TOKEN
POST /api/tamilmv                  # force scrape with token
GET  /api/cron/tamilmv?token=YOUR_TOKEN
```

Optional secrets:

```env
SCRAPE_TOKEN=private_refresh_token
CRON_SECRET=private_cron_token
TAMILMV_MAX_POSTER_FETCHES=8
```

For a true daily schedule on Hugging Face Spaces, use an external cron service to call:

```txt
https://YOUR_SPACE_URL/api/cron/tamilmv?token=YOUR_CRON_SECRET
```

once per day. Without an external cron, the app still refreshes automatically when a user opens the homepage after the cache is older than one day.

Scraped forum listings are shown as catalog/listing cards. Playback still uses TMDB/source providers; scraped listings without a TMDB ID are not directly playable until matched/resolved.


### TamilMV TMDB poster overrides

If a scraped TamilMV title matches the wrong TMDB record or has no poster, add manual overrides:

```env
TAMILMV_TMDB_OVERRIDES=Cooku With Comali:114574|tv,House of Dragon:94997|tv,Mammattiyaan Stars:123456|tv
```

Format:

```txt
Title:TMDB_ID|movie_or_tv
```

After changing overrides, refresh:

```txt
/api/tamilmv?refresh=1
```

## MovieZon-Style Local Provider Workflow

The project now uses a MovieZon-inspired provider workflow inside this Next.js app. Instead of deploying MovieZon separately, the app has local provider modules with a shared contract:

```txt
provider id
provider name
stream URL builder
stream type: embed or video/hls
fallbacks
health/config status
```

Current local/external providers:

```txt
TamilOTT JSON
ScreenScape Embed
VidLink
VidNest
Videasy
VidZee
VidRock
VixSrc
1Embed
VidSrc SBS
VidSrc Mirrors
```

Provider registry endpoint:

```txt
/api/providers
```

Example response includes provider list, enabled state, mode, and priority order.

Recommended priority example:

```env
EMBED_PROVIDER_PRIORITY=screenscape,vidlink,sangilikaruppu,vidsrcsbs,vidsrc
```

For Samsung TV, try this order if one embed fails:

```txt
ScreenScape → VidLink → VidSrc SBS → VidSrc Mirrors → CinePro
```

CinePro remains the advanced direct-source backend for HLS/video responses.

## Sangilikaruppu Zone API Provider

This app now supports your external provider API as a selectable source:

```txt
https://sangilikaruppu-zone.hf.space
```

Configure it with:

```env
SANGILIKARUPPU_API_BASE_URL=https://sangilikaruppu-zone.hf.space
SANGILIKARUPPU_PROVIDER=netmirror
```

Supported compatible endpoints inside this app:

```txt
GET /api/search?q=title
GET /api/details/:provider/:id?type=movie|tv
GET /api/stream/:provider/:id?type=movie|tv&season=1&episode=1&variant=variantId
GET /api/providers
```

The watch page source dropdown now includes:

```txt
Sangilikaruppu Zone
```

When the external API returns direct MP4/HLS links with required headers, this app uses a signed local proxy route:

```txt
/api/zone/proxy
```

This keeps headers such as `Referer` and `User-Agent` server-side and makes browser/TV playback more compatible.

You can also directly test:

```txt
/api/resolve?provider=sangilikaruppu&type=movie&tmdbId=1291608
/api/stream/netmirror/1291608?type=movie
/api/v2/stream/auto/1291608?type=movie&provider=sangilikaruppu
```

## CinePro Route Modes

CinePro source playback supports three route modes:

```txt
Compatible Proxy: Browser → Hugging Face → Railway CinePro → Video Server
Direct CinePro:   Browser → Railway CinePro → Video Server
Raw Video Direct: Browser → Video Server
```

Use **Direct CinePro Fast** first if your Railway deployment has good CORS/range headers.

Use **Raw Video Direct** only when the extracted upstream video server allows browser CORS. This is the fastest path, but it often fails because browsers cannot send provider-required `Referer`/`Origin` headers.

Use **Compatible Proxy** when direct modes fail. It is slower but most compatible because this app rewrites playlists and normalizes CORS.

## Optional CinePro Provider

CinePro Core can be used as an optional provider. It is an OMSS-compatible backend that returns direct sources such as HLS/proxy URLs.

Add this secret if you run a CinePro Core instance:

```env
CINEPRO_BASE_URL=https://your-cinepro-core.example.com
```

The app calls CinePro server-side:

Movie:

```txt
GET {CINEPRO_BASE_URL}/v1/movies/{tmdbId}
```

TV episode:

```txt
GET {CINEPRO_BASE_URL}/v1/tv/{tmdbId}/seasons/{season}/episodes/{episode}
```

When CinePro is selected in the watch page, the app uses a native `<video>` player for direct/HLS sources instead of an iframe.

Recommended architecture:

- Hugging Face single-container: use CinePro as an external `CINEPRO_BASE_URL`
- VPS/Docker Compose: run this app + CinePro Core together behind one domain

If your CinePro/Railway logs show:

```txt
[Redis] Connection error: ECONNREFUSED 127.0.0.1:6379
```

set CinePro to memory cache unless you have a separate Redis service:

```env
CACHE_TYPE=memory
```

If you want Redis-backed CinePro caching, create a Redis service and set:

```env
CACHE_TYPE=redis
REDIS_HOST=<your-redis-host>
REDIS_PORT=6379
REDIS_PASSWORD=<your-redis-password-if-any>
```

Do not leave `CACHE_TYPE=redis` pointing to localhost on Railway/Hugging Face, because there is no Redis server running at `127.0.0.1:6379` inside the CinePro container.


## VixSrc embed provider

VixSrc is included as an embed-only provider. The app calls the VixSrc TMDB API server-side and redirects the player iframe to the returned VixSrc embed page.

```txt
Movie: /api/vixsrc?type=movie&tmdbId={tmdbId}
TV:    /api/vixsrc?type=series&tmdbId={tmdbId}&season={season}&episode={episode}
```

This implementation does not extract direct HLS/video files; it only uses VixSrc's own embed page.

## 1Embed provider

1Embed is included as a direct TMDB embed provider.

```txt
Movie: https://1embed.cc/embed/movie/{tmdbId}
TV:    https://1embed.cc/embed/tv/{tmdbId}/{season}/{episode}
```

Optional starting server:

```env
ONEEMBED_SERVER=cedar
# supported by 1Embed: cedar, buke, mbox, nexo, fasel
```

## VidSrc Mirrors env configuration

VidSrc mirror domains can change. Configure the primary and fallback domains without code changes:

```env
VIDSRC_MIRROR_BASE_URL=https://vsembed.ru
VIDSRC_FALLBACK_DOMAINS=https://vidsrcme.su,https://vidsrc-embed.ru,https://vidsrc-embed.su,https://vsrc.su
VIDSRC_DEFAULT_SUBTITLE_LANG=en
VIDSRC_AUTOPLAY=1
VIDSRC_AUTONEXT=1
# Optional external .srt/.vtt subtitle URL with CORS enabled
VIDSRC_SUBTITLE_URL=
```

Current URL formats used:

```txt
Movie primary: /embed/movie/{tmdbId}?ds_lang=en&autoplay=1
TV primary:    /embed/tv/{tmdbId}/{season}-{episode}?ds_lang=en&autoplay=1&autonext=1
Movie fallback: /embed/movie?tmdb={tmdbId}&ds_lang=en&autoplay=1
TV fallback:    /embed/tv?tmdb={tmdbId}&season={season}&episode={episode}&ds_lang=en&autoplay=1&autonext=1
```

The resolver does a quick server-side HTML health check for VidSrc Mirrors and chooses the first reachable mirror. The watch page also shows **Try Next Mirror** when fallback URLs are available.

Supported/current domains include:

```txt
https://vsembed.ru
https://vidsrcme.su
https://vidsrc-embed.ru
https://vidsrc-embed.su
https://vsrc.su
```

## Current Source List and Samsung TV Mode

MovieZon has been removed from the active source selector. The watch page now supports:

```txt
Auto Priority (TamilOTT first)
TamilOTT JSON
ScreenScape
VidLink
VidNest
Videasy
VidZee
VidRock
VixSrc
1Embed
VidSrc SBS
VidSrc Mirrors
```

The watch page includes **Samsung TV Mode**, **Block Popups**, **Try Next Mirror**, and **Open Source Directly** controls.

If Samsung TV browser shows:

```txt
function not supported
```

use **Open Source Directly**. Some TV browsers block embedded players but allow the same player when opened as a top-level page.

## VidLink Sandbox Note

VidLink may show a message like:

```txt
please disable sandbox
```

or render a black screen if the iframe has a `sandbox` attribute.

The player now handles this automatically by removing the iframe `sandbox` attribute for all embed providers. This is required for VidLink and is also more compatible with Samsung TV browsers.

## Password-Protected Hugging Face Space

The app now has a private password screen before users can enter the theatre.

Add this as a Hugging Face **Secret**:

```txt
SPACE_PASSWORD=your_private_password
```

Flow:

```txt
1. User opens the Space
2. Password screen appears
3. Password is verified server-side against SPACE_PASSWORD
4. If correct, a non-password access token is saved in localStorage
5. On the same TV/mobile/browser, the app opens automatically next time
```

The raw password is never stored in localStorage. The browser stores only a server-generated SHA-256 access fingerprint. Use the floating **Lock** button to forget saved access on that device.

## Manual Source Switching

The watch page now lets you manually select a playback source at runtime:

```txt
Auto Priority
ScreenScape
VidLink
MovieZon Local Router
```

Use this when one embed is slow. For example, if ScreenScape loads slowly, switch to VidLink without leaving the watch page.

The resolver supports a `provider` query parameter:

```txt
/api/resolve?type=movie&tmdbId=597&provider=vidlink
/api/resolve?type=series&tmdbId=1396&season=1&episode=1&provider=screenscape
/api/resolve?type=movie&tmdbId=597&provider=moviezon
```

The local MovieZon router is not a separate deployment. It is a local routing layer that uses the provider priority/fallback modules inside this same repo.

## One-Roof Provider Module Architecture

The app now keeps playback provider modules inside this same Next.js repo. You do not need to deploy MovieZon-api separately for the current embed-based flow.

Local provider module file:

```txt
lib/providers/embedProviders.js
```

Current built-in embed providers:

```txt
ScreenScape Embed
VidLink
```

Provider priority can be configured with:

```env
EMBED_PROVIDER_PRIORITY=screenscape,vidlink
```

or:

```env
EMBED_PROVIDER_PRIORITY=vidlink,screenscape
```

### Local MovieZon-compatible endpoint

This repo now also exposes a MovieZon-style endpoint inside the same deployment:

```txt
/api/v2/stream/auto/:tmdbId?type=movie|tv&season=1&episode=1&lan=tam
```

Example movie:

```txt
/api/v2/stream/auto/597?type=movie&lan=eng
```

Example TV:

```txt
/api/v2/stream/auto/1396?type=tv&season=1&episode=1&lan=eng
```

It returns a MovieZon-like response containing:

```json
{
  "ok": true,
  "success": true,
  "available": true,
  "streamType": "embed",
  "embedUrl": "https://...",
  "streamUrl": "https://...",
  "embedFallbacks": ["https://..."],
  "providers": []
}
```

### VidLink formats used

Movie:

```txt
https://vidlink.pro/movie/{tmdbId}
```

TV:

```txt
https://vidlink.pro/tv/{tmdbId}/{season}/{episode}
```

### ScreenScape formats used

Movie:

```txt
https://screenscape.me/embed?tmdb={tmdbId}&type=movie&lan=tam
```

TV:

```txt
https://screenscape.me/embed?tmdb={tmdbId}&type=tv&s=1&e=1&lan=tam
```

## Current Playback Flow: Direct ScreenScape Embed

The old ScreenScape scraper-search flow has been removed from active playback. The watch page now builds direct embed URLs from TMDB IDs.

Movie embed format:

```txt
https://screenscape.me/embed?tmdb=597&type=movie&lan=eng
```

TV embed format:

```txt
https://screenscape.me/embed?tmdb=1396&type=tv&s=1&e=1&lan=eng
```

In the app:

```txt
/watch/movie/:tmdbId
/watch/series/:tmdbId
```

The internal resolver returns only the embed URL to the frontend:

```txt
/api/resolve?type=movie&tmdbId=597&lan=tam
/api/resolve?type=series&tmdbId=1396&season=1&episode=1&lan=tam
```

The generated embed source is saved in MongoDB for reference/future use.

No ScreenScape API key is required for this embed URL format. TMDB is still used for homepage/latest/search metadata.

## Latest Releases and Search with TMDB

The homepage now uses TMDB for metadata:

- Latest Tamil Movies
- Latest Tamil Series
- Search movies and series

The heading is:

```txt
JaSH ViBeS
```

TMDB is used for posters, titles, release dates, ratings, and descriptions only. TMDB does **not** provide streaming URLs.

Required secret for TMDB metadata:

```txt
TMDB_API_KEY
```

Alternatively, you can use:

```txt
TMDB_BEARER_TOKEN
```

### How playback works after clicking a movie or series

When you click a TMDB title, the app opens:

```txt
/watch/movie/TMDB_ID
/watch/series/TMDB_ID
```

Then it calls:

```txt
/api/resolve?type=movie&tmdbId=TMDB_ID
```

The resolver checks MongoDB for a matching document:

```json
{
  "tmdbId": 12345,
  "type": "movie"
}
```

Then it tries configured sources one-by-one by priority. If a source returns a stream URL, playback starts automatically.

### Example MongoDB source document

```json
{
  "title": "Example Tamil Movie",
  "category": "Tamil",
  "type": "movie",
  "tmdbId": 12345,
  "releaseDate": "2026-06-01T00:00:00.000Z",
  "synopsis": "Optional local synopsis.",
  "posterUrl": "https://image.tmdb.org/t/p/w500/example.jpg",
  "sources": [
    {
      "provider": "ScreenScape",
      "label": "Source 1",
      "externalId": "/api/zinkmovies/details?url=VALID_PROVIDER_URL",
      "priority": 1,
      "isActive": true
    },
    {
      "provider": "ScreenScape",
      "label": "Source 2",
      "externalId": "/api/netmirror/VALID_ID_OR_PATH",
      "priority": 2,
      "isActive": true
    }
  ]
}
```

> Important: For legal and technical reasons, the app cannot automatically invent playable streams from TMDB. You must configure authorized source records in MongoDB for titles you are allowed to stream.

### Weekly/latest updates

You do not need to redeploy every week. The homepage fetches latest releases from TMDB at runtime through:

```txt
/api/latest
```

That route uses no-store/server-side fetching and cache headers for periodic revalidation. New official TMDB releases appear automatically when TMDB data updates.


---


---


---

## Optional MovieZon-api Integration

You can use this repo as an external stream resolver service:

```txt
https://github.com/Kalaitechtubee/MovieZon-api
```

Deploy MovieZon-api separately as a Node/Express service, then add this secret to JaSH ViBeS:

```txt
MOVIEZON_API_BASE_URL=https://your-moviezon-api.example.com
```

The resolver calls MovieZon server-side only:

```txt
GET /api/v2/stream/auto/:tmdbId?type=movie|tv&season=1&episode=1
```

If MovieZon returns `streamUrl`, `embedUrl`, or a playable fallback, the watch page marks **MovieZon** green and saves a `moviezon:` source in MongoDB for future playback.

Example saved source:

```json
{
  "provider": "MovieZon",
  "label": "peachify",
  "externalId": "moviezon:movie:1007757:s1:e1",
  "priority": 0,
  "isActive": true
}
```

MovieZon is tried before title-based ScreenScape scraper search because it resolves by TMDB ID directly.

## Auto-save Playable Sources to MongoDB

If a clicked TMDB title is not already in MongoDB, the resolver now does this:

```txt
1. Search ScreenScape scrapers by TMDB title
2. Try to extract a playable source
3. If playback works, save that source into MongoDB
4. Next time, use the saved MongoDB source first
```

When this succeeds, the watch page shows:

```txt
Saved in MongoDB for future playback
```

The saved document uses this shape:

```json
{
  "title": "TMDB title",
  "category": "Tamil",
  "type": "movie or series",
  "tmdbId": 123456,
  "sources": [
    {
      "provider": "Detected provider",
      "label": "Matched scraper title",
      "externalId": "/api/provider/details?url=ENCODED_URL",
      "priority": 1,
      "isActive": true
    }
  ]
}
```

If the scraper only finds the title but cannot extract a playable stream, it will not save it as playable yet.

## Scraper Availability UI

On the watch page, the app now shows all scraper/provider statuses:

- **Green** = configured source is available and returned a playable stream
- **Red** = configured source was tried but failed
- **Yellow** = currently checking
- **Gray** = no MongoDB source configured for that scraper

If you click a TMDB movie such as `Blast 2026` and see:

```txt
Metadata found, but no authorized streaming sources are configured for this title yet.
```

that means TMDB metadata exists, but MongoDB does not yet have a source document for that exact `tmdbId` and `type`.

Example MongoDB document for a movie source:

```json
{
  "title": "Blast",
  "category": "Tamil",
  "type": "movie",
  "tmdbId": 123456,
  "sources": [
    {
      "provider": "NetMirror",
      "label": "NetMirror Source",
      "externalId": "/api/netmirror/VALID_NETMIRROR_PATH",
      "priority": 1,
      "isActive": true
    },
    {
      "provider": "ZinkMovies",
      "label": "ZinkMovies Source",
      "externalId": "/api/zinkmovies/details?url=VALID_ZINKMOVIES_URL",
      "priority": 2,
      "isActive": true
    }
  ]
}
```

Replace `123456` with the real TMDB ID shown on the watch page.

## Initial Tamil Content Setup

If the homepage says:

```txt
No Tamil content found
```

it means your MongoDB `media` collection does not yet have documents with:

```json
{
  "category": "Tamil"
}
```

This project includes a protected seed route:

```txt
/api/seed
```

### Option 1: Insert demo Tamil cards

Open this URL after deployment:

```txt
https://YOUR_SPACE_URL/api/seed?token=YOUR_SEED_TOKEN
SPACE_PASSWORD
```

This inserts demo Tamil catalog cards so the homepage is no longer empty.

### Option 2: Import Tamil metadata from ScreenScape

Open:

```txt
https://YOUR_SPACE_URL/api/seed?source=screenscape&token=YOUR_SEED_TOKEN
SPACE_PASSWORD
```

This attempts to fetch recent ZinkMovies metadata from ScreenScape and imports items that mention Tamil.

Required secrets for this option:

```txt
MONGODB_URI
SCREENSCAPE_API_KEY
TMDB_API_KEY or TMDB_BEARER_TOKEN
MOVIEZON_API_BASE_URL optional
SEED_TOKEN
SPACE_PASSWORD
```

> Note: Imported metadata depends on what ScreenScape returns. Some entries may still need their `externalId` adjusted depending on the provider endpoint you want to use for playback.

## 5. Media Collection Format

The app reads documents from the MongoDB `media` collection.

Example Tamil document:

```json
{
  "title": "Sample Tamil Movie",
  "category": "Tamil",
  "synopsis": "A sample Tamil movie for the JaSH THEATRE homepage.",
  "posterUrl": "https://example.com/poster.jpg",
  "externalId": "/api/netmirror/example-content-id"
}
```

Example other-language document:

```json
{
  "title": "Sample Hindi Movie",
  "category": "Hindi",
  "synopsis": "This appears inside the Hindi dropdown section.",
  "posterUrl": "https://example.com/poster.jpg",
  "externalId": "/api/netmirror/example-content-id"
}
```

### Field explanation

| Field | Purpose |
|---|---|
| `title` | Media title. Required. |
| `category` | Used as language/category. `Tamil` appears on homepage. Other values appear in dropdowns. |
| `synopsis` | Short description. |
| `posterUrl` | Poster image URL. |
| `externalId` | ScreenScape API path used by the backend proxy. |

---

## 6. How Streaming Resolution Works

The browser never calls ScreenScape directly.

Flow:

```txt
Browser /watch/[id]
        ↓
Internal Next.js API route: /api/stream?mediaId=MongoObjectId
        ↓
MongoDB lookup finds externalId
        ↓
Server-side fetch to ScreenScape using SCREENSCAPE_API_KEY
        ↓
API returns only { streamUrl }
        ↓
Browser renders streamUrl inside sandboxed iframe
```

The API key stays server-side in:

```js
process.env.SCREENSCAPE_API_KEY
TMDB_API_KEY or TMDB_BEARER_TOKEN
MOVIEZON_API_BASE_URL optional
SEED_TOKEN
SPACE_PASSWORD
```

---

## 7. Local Development

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
SCREENSCAPE_API_KEY=your_screenscape_api_key_here
TMDB_API_KEY=your_tmdb_v3_api_key_here
# or use TMDB_BEARER_TOKEN instead of TMDB_API_KEY
MOVIEZON_API_BASE_URL=https://your-moviezon-api.example.com
SEED_TOKEN=choose_a_private_seed_password
```

Run locally:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

---

# 8. Deploy to Hugging Face Spaces

Hugging Face Spaces supports Docker apps. This project includes a `Dockerfile` configured for Spaces.

Spaces expect web apps to listen on port:

```txt
7860
```

The provided `package.json` uses:

```json
"start": "next start -H 0.0.0.0 -p ${PORT:-7860}"
```

and the `Dockerfile` exposes port `7860`.

---

## Option A: Deploy from the Hugging Face website

### Step 1: Create a Space

1. Go to [Hugging Face Spaces](https://huggingface.co/spaces).
2. Click **Create new Space**.
3. Choose a name, for example:

```txt
jash-theatre
```

4. Select **Docker** as the Space SDK.
5. Choose public or private visibility.
6. Create the Space.

### Step 2: Upload project files

Upload or push these files/folders to the Space repository:

```txt
app/
lib/
models/
Dockerfile
package.json
package-lock.json
next.config.mjs
jsconfig.json
tailwind.config.js
postcss.config.js
README.md
.dockerignore
```

### Step 3: Add Hugging Face secrets

In your Space:

1. Open **Settings**.
2. Go to **Variables and secrets**.
3. Add the following as **Secrets**, not public variables:

```txt
MONGODB_URI
SCREENSCAPE_API_KEY
TMDB_API_KEY or TMDB_BEARER_TOKEN
MOVIEZON_API_BASE_URL optional
SEED_TOKEN
SPACE_PASSWORD
```

Example:

```txt
MONGODB_URI = mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
SCREENSCAPE_API_KEY = your_screenscape_api_key_here
TMDB_API_KEY = your_tmdb_v3_api_key_here
MOVIEZON_API_BASE_URL = https://your-moviezon-api.example.com
SEED_TOKEN = choose_a_private_seed_password
SPACE_PASSWORD = choose_your_private_theatre_password
```

### Step 4: Wait for build

Hugging Face will build the Docker image automatically.

When the build completes, your app will be available at:

```txt
https://huggingface.co/spaces/YOUR_USERNAME/jash-theatre
```

or through the Space app URL shown in the Space UI.

---

## Option B: Deploy using Git

Install Git LFS if needed:

```bash
git lfs install
```

Clone your Hugging Face Space repository:

```bash
git clone https://huggingface.co/spaces/YOUR_USERNAME/jash-theatre
cd jash-theatre
```

Copy this project into the cloned folder, then commit and push:

```bash
git add .
git commit -m "Deploy JaSH THEATRE Next.js app"
git push
```

Hugging Face will automatically rebuild the Space.

---

## 9. Required Hugging Face Settings

Use these settings:

| Setting | Value |
|---|---|
| Space SDK | Docker |
| App port | 7860 |
| Node version | Node 20 from Dockerfile |
| Secrets | `MONGODB_URI`, `SCREENSCAPE_API_KEY` |

---

## 10. Testing the Deployment

After the Space builds successfully:

1. Open the app.
2. Confirm the heading says:

```txt
JaSH THEATRE
```

3. Confirm Tamil content appears on the homepage.
4. Confirm other languages appear inside dropdown sections.
5. Click a media card.
6. Confirm `/watch/[id]` opens.
7. Confirm the player calls:

```txt
/api/stream?mediaId=...
```

8. Confirm the browser does **not** show `SCREENSCAPE_API_KEY` anywhere in DevTools.

---

## 11. Common Issues

### Hugging Face says: `Missing configuration in README`

Make sure the first lines of `README.md` are exactly YAML front matter like this:

```yaml
---
title: JaSH THEATRE
emoji: 🎬
colorFrom: red
colorTo: gray
sdk: docker
pinned: false
app_port: 7860
---
```

The YAML block must be at the very top of the file with no blank line before it.

### Do I need `app_file: app.py`?

No. This is a Docker/Next.js project. `app_file: app.py` is not required and should not be used.


### Build fails: `Cannot find module 'tailwindcss'`

This happens if Docker installs only production dependencies before `npm run build`. Tailwind is needed during the build step.

The included `Dockerfile` fixes this by installing dependencies before setting `NODE_ENV=production`:

```dockerfile
RUN npm install
RUN npm run build
ENV NODE_ENV=production
```

If you edited the Dockerfile, make sure `NODE_ENV=production` is not set before `npm install`.

### Build fails: `Cannot find module '@/lib/db'`

Make sure `jsconfig.json` exists:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

### MongoDB connection fails

Check:

- `MONGODB_URI` is added as a Hugging Face secret.
- MongoDB username/password are correct.
- MongoDB Atlas network access allows the deployment to connect.
- Database name is included in the URI.

### ScreenScape request fails

Check:

- `SCREENSCAPE_API_KEY` is added as a Hugging Face secret.
- Your `externalId` value is correct.
- Your ScreenScape account has access to the endpoint you are calling.

### No Tamil content appears

Make sure your MongoDB document has:

```json
{
  "category": "Tamil"
}
```

The homepage only shows Tamil content directly. Other categories are placed in dropdowns.

### App does not open on Hugging Face

Make sure the app listens on `0.0.0.0` and port `7860`.

This project already does that with:

```json
"start": "next start -H 0.0.0.0 -p ${PORT:-7860}"
```

---

## 12. Security Notes

This prototype follows these security rules:

- MongoDB URI is server-only.
- ScreenScape API key is server-only.
- Frontend only calls internal Next.js API routes.
- Provider response is reduced to a clean `{ streamUrl }` response.
- The iframe uses sandboxing:

```jsx
sandbox="allow-scripts allow-same-origin"
allowFullScreen
```

Do not add secrets to client components, browser JavaScript, or variables beginning with `NEXT_PUBLIC_`.

---

## 13. Useful Commands

Local dev:

```bash
npm run dev
```

Production build:

```bash
npm run build
```

Production start locally on port 7860:

```bash
PORT=7860 npm run start
```

Docker build locally:

```bash
docker build -t jash-theatre .
```

Docker run locally:

```bash
docker run -p 7860:7860 \
  -e MONGODB_URI="mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority" \
  -e SCREENSCAPE_API_KEY="your_screenscape_api_key_here" \
  jash-theatre
```

Then open:

```txt
http://localhost:7860
```
