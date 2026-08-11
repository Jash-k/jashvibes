# JaSH Theatre Environment Variables - Short Setup

Use only these **3 required** Hugging Face secrets for normal deployment:

```env
DB=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/jash_theatre?retryWrites=true&w=majority
TMDB=your_tmdb_v3_api_key
# or multiple TMDB v3 keys:
TMDB_KEYS=key_1,key_2,key_3
PASS=choose_your_private_theatre_password
```

Optional:

```env
PROVIDERS=tamilott,vidlink,vidnest,videasy,vidzee,vidrock,vixsrc,oneembed,vidsrcsbs,vidsrc
TAMILMV=https://www.1tamilmv.report/
TAMILMV_CACHE_LIMIT=90
OTT=https://tamilott.vercel.app/tamil_movies.json,https://tamilott.vercel.app/tamil_dubbed.json
OTT_MOVIES=https://tamilott.vercel.app/tamil_movies.json
OTT_DUBBED=https://tamilott.vercel.app/tamil_dubbed.json

# Music / ராக வானம் (JioSaavn only)
SAAVN=https://saavnapi.onrender.com
MUSIC_LANG=Tamil
LYRICS_API=https://lrclib.net
SPOTIFY_PROXY=https://spotubedl-api.onrender.com/api/metadata
SPOTIFY_IMPORT_MAX_TRACKS=120
SPOTIFY_IMPORT_CONCURRENCY=2
SPOTIFY_IMPORT_MAX_PLAYLISTS=25

# Clean Embed Browser - one site
EMBED=https://piratexplay.cc/language/tamil/
ELABEL=PirateXPlay Tamil

# Clean Embed Browser - multiple sites
EMBEDS=PirateXPlay Tamil|https://piratexplay.cc/language/tamil/

# Live TV custom source list, optional. If unset, built-in Tamil-preferred sources are used.
TV=Jio Tamil|https://jtvxweb.pages.dev/jstr4web.json,StreamLive|https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamlive.m3u


# Tamil Classics VOD M3U sources. Keep private tokens in env only.
VOD=ErosNow|https://raw.githubusercontent.com/USER/REPO/main/VOD_ErosNow.m3u,Aha|https://raw.githubusercontent.com/USER/REPO/main/VOD_Aha.m3u
# or separate:
VOD_EROS=https://raw.githubusercontent.com/USER/REPO/main/VOD_ErosNow.m3u
VOD_AHA=https://raw.githubusercontent.com/USER/REPO/main/VOD_Aha.m3u
```

Backward-compatible old names still work:

| Short | Old names also accepted |
|---|---|
| `DB` | `MONGODB_URI`, `DB_URI` |
| `TMDB` | `TMDB_API_KEY`, `TMDB_KEY`, `TMDB_V3_API_KEY` |
| `TMDB_KEYS` | `TMDB_API_KEYS`, `TMDB_V3_KEYS` |
| `TMDB_TOKEN` | `TMDB_TOKENS`, `TMDB_BEARER_TOKEN`, `TMDB_BEARER_TOKENS` |
| `PASS` | `SPACE_PASSWORD`, `APP_PASSWORD` |
| `PROVIDERS` | `EMBED_PROVIDER_PRIORITY` |
| `TAMILMV` | `TAMILMV_BASE_URL` |
| `OTT` | `TAMILOTT_JSON_URL` |
| `OVERRIDES` | `TAMILMV_TMDB_OVERRIDES` |
| `SCRAPE` | `SCRAPE_TOKEN` |
| `CRON` | `CRON_SECRET` |
| `EMBED` | `CLEAN_EMBED_URL`, `EXTERNAL_SITE_URL`, `SITE_URL` |
| `ELABEL` | `CLEAN_EMBED_LABEL`, `EXTERNAL_SITE_LABEL`, `SITE_LABEL` |
| `EMBEDS` | `CLEAN_EMBED_SITES`, `EMBED_SITES` |

All provider domains have safe defaults, so you do not need to add VidSrc/VidLink/VidNest/Videasy/VidZee/VidRock variables unless a domain changes.

# Authorized Stremio addon section
# Set this only to an addon/source you own or are authorized to use.
STREMIO=https://your-authorized-addon.example.com/stremio/YOUR_TOKEN/manifest.json
# Optional: comma-separated hosts allowed for direct stream URLs. If unset, only the addon host is allowed.
STREMIO_ALLOWED_HOSTS=your-authorized-addon.example.com
# Optional escape hatch for your own private app only:
# STREMIO_ALLOW_ANY_HOST=1

# Stremio timeout for slow addon cold starts / large responses
STREMIO_STREAM_TIMEOUT_MS=180000
