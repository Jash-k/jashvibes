# Sports Section — Complete Analysis & Live-Stream Plan (round 2)

**Goal:** your FanCode + Willow sources play as live sports streams inside `/sports`, on Android TV, Samsung (Tizen) & LG (webOS) TV browsers, PC and mobile.
**Current design:** "Single Feed" (v8.12.0, idea 6 of round 19) — one column of match cards, expand-in-place hub with 4 tabs.

---

## 1. What exists today (file-by-file)

| File | Lines | Role |
|---|---|---|
| `components/sports/SportsFeed.js` | 1,021 · 45 hooks | The whole page: mast, feed cards, in-place hub (Live Score / Video / Info / Scorecard tabs), channels aside, sources sheet |
| `lib/sportsFeed.js` | 1,433 | Data layer: fetches **BCCI** (`scores2.bcci.tv`), **ICC** (`assets-icc.sportz.io`), **FanCode dump** (GitHub JSON, default `doctor-8trange/zyphx8`), merges + dedupes into one shape, TTL-caches (20s live / 5min idle) |
| `lib/sportsFeedView.js` | 374 | Pure display logic: `stateChip`, `countdownLine`, `channelReadiness`, `scorecardRows`, `hubTabs` |
| `app/api/sports/feed` · `hub` · `channels` | 3 routes | merged board · per-match panels · sports channels from live-TV catalog + 2 env slots |
| `app/sports/hub/[source]/[id]` | 27 | deep-linkable hub (`?tab=`) |
| `lib/player/policy/liveTv.js` | — | playback ladder the hub player uses: direct → ClearKey → `/api/live-proxy` (Cookie/Referer/UA) |
| `tests/sports-hub.test.js` | 875 | merge/dedupe, hub URL shape, readiness states, empty-panel lines, source guards |

### How your two sources plug in **today**

**FanCode** — two separate paths already exist:
1. **The dump (matches + streams):** `lib/sportsFeed.js` reads the FanCode JSON dump; each row's `auto_streams[]` carries a *signed HLS master* + `cookie` + `Referer`/UA headers + `cookie_valid` expiry. `normalizeFancode()` attaches these as `variants` per match, and the hub's Video tab plays them via `JashPlayer` + `createLiveTvPolicy` (cookies travel through `/api/live-proxy`). Label shows token expiry honestly. `FANCODE_DUMP_URL` env overrides the dump location.
2. **A standing channel:** `SPORTS_FANCODE_URL` (+ `_NAME`, `_LOGO`, `_COOKIE`, `_UA`, `_REFERER`, `_KEY_ID`/`_KEY` or `_LICENSE_KEY` for DRM) becomes a permanent "FanCode" channel in `/api/sports/channels`.

**Willow** — one path: `SPORTS_WILLOW_URL` (+ same suffix knobs) becomes the "Willow by Cricbuzz" channel. It is played by the same ClearKey/proxy ladder. `public/willow.svg` already exists for branding.

**Readiness is honest** (`channelReadiness`): `ready` → plays direct · `clear key` → KEY_ID+KEY present · `via proxy` → needs Cookie/Referer · `needs a key` → DRM without keys (never offered as playable) · `key expired` · `not set`.

### What works well (keep)

- **One normaliser, one truth rule.** No invented scores; an empty panel names the empty feed; stale dumps quarantine "LIVE" rows as *unverified*.
- **Free-tier discipline:** visible-only polling (30s board / 20s open live hub), exponential backoff, server TTL cache, manual Refresh. The old always-on poller got the service suspended once — this must never come back.
- **Real player, not an iframe.** The old hard-coded Willow AMAGI iframe is gone; streams mount in `JashPlayer` with the recovery ladder, ClearKey, aspect control, and the new 4-button bar.
- **875 lines of tests** pin the merge/dedupe and readiness logic.

### Gaps for "live sports, one tap, on a TV" (what the redesign must fix)

1. **The player is buried.** Video tab only exists *inside* an expanded card's hub → on a TV that's: open `/sports` → D-pad to card → Enter → tab to Video → Enter → pick stream = **5+ presses**. No design makes video the first thing you reach.
2. **No "best live stream now" concept.** FanCode dump may carry 3 live matches + Willow + catalog channels — nothing picks or *presents* the one you most likely mean; every choice is manual.
3. **TV ergonomics unproven.** Focus management exists in the app (`RailFocus`) but the sports page uses `details`/buttons with no spatial-nav guarantees; cards are dense (10-11px meta) — fine on PC, tight on a 10-foot UI.
4. **Streams die silently mid-match.** Signed FanCode links expire (`cookie_valid`); when the token lapses there's no auto-refresh — the player's ladder retries the same dead URL.
5. **Multi-match viewing is clumsy.** To flip between two live games you collapse one hub and open another; no zapper.
6. **DRM honesty:** the stack does **ClearKey only** (no Widevine). Willow's official app streams are Widevine — your `SPORTS_WILLOW_URL` must therefore be an HLS/MPD you have keys for (`_KEY_ID`/`_KEY`) or a clear/signed feed. The UI already says `needs a key` instead of faking playback — keep that.
7. **`/api/sports/channels` is fetched every visit but has no first-class surface** — it's an aside at the bottom.

---

## 2. My thoughts & suggestions before you pick a design

1. **Make "live video" the default state of the page, not a tab.** Every serious sports surface (YouTube TV, JioCinema, Hotjar) lands you *on the picture*. My recommendation ranking for a TV-first use case: **Concept 1 (Stadium) or Concept 6 (Guide)**.
2. **Introduce a "best live stream" resolver** (`lib/sportsLive.js`): rank = live & fresh token > live dump row > Willow channel > catalog sports channel. One function, unit-tested, and *every* concept benefits. The page can then honestly say "AUTO · IND v AUS · FanCode feed 1".
3. **Token refresh before the pill expires:** when the playing variant's `cookie_valid` is <5 min away, re-read the feed once and hot-swap the URL at the same position. Small engine-aware change, kills the #1 mid-match complaint.
4. **Keep polling as-is** (visible-only, backoff). Any design that adds polling gets the free tier suspended again — non-negotiable.
5. **TV rules I'll apply to whichever you pick:** amber focus ring on load (spatial nav), ≥44px targets (52px ≥1600px), ≥12px type floor for meta, no hover-only affordances, no backdrop-blur on TV panes, `Enter`/`OK` everywhere works like click, Back = previous pane.
6. **DRM reality check for your Willow URL:** send me one of — (a) an `.m3u8`/`.mpd` + `KEY_ID`/`KEY` hex pair (ClearKey path, works today), (b) a plain/signed HLS (works via proxy), or (c) if it's Widevine-only with license server URL, I'll tell you honestly it can't play in this stack and we design the row as "open on Willow" instead.
7. **FanCode dump freshness:** if you control the dump publisher, a 10–15 min publish cadence makes live-score-on-video acceptable without polling; the UI already stamps `feed snapshot · time`.

---

## 3. The six designs → `sports-live-designs.html`

Open **`sports-live-designs.html`** (also copied to `docs/concepts/` in the repo). Each concept shows the **TV (10-foot)** frame and the **Mobile** frame, with D-pad press-count to video, source wiring and cost notes:

| # | Name | One line | Best if |
|---|---|---|---|
| 1 | **Stadium** | Page opens *playing* the best live stream; scores float on the picture; ←/→ hops live games | The TV is your main screen and you just want the game on |
| 2 | **Control Room** | Split desk: live match list left, player + tabs right | You follow several matches and PC is primary |
| 3 | **On Air Grid** | One hero ON-AIR card with a huge PLAY (auto-focused), grid below | You want zero ambiguity + fewest presses to video |
| 4 | **Rail OS Live** | Sports adopts the app's Rail OS language (rail, focused title, rows) | Consistency with home/music/anime matters most |
| 5 | **Dock & Browse** | Tabs per sport; picking a match docks a mini-player and keeps you browsing | You browse scores *while* watching (PiP culture) |
| 6 | **Sports Guide** | FanCode feeds + Willow + TV channels become a numbered EPG with now/next | Your mental model is "channels", like /live |

All six keep: the merged feed + hub data layer, `/sports/hub/{source}/{id}` deep links, readiness honesty, the free-tier polling rules, and JashPlayer. They differ only in *where the video sits and how few presses it takes*.
