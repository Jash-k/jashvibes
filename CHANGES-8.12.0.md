# v8.12.0 — Sports: one feed, one hub, four tabs

Complete project archive: `jashvibes-v8.12.0-full.zip`.
Updated files only, at their repo paths: `jashvibes-v8.12.0-updated-files.zip`.

## Added

| Path | What it is |
|---|---|
| `lib/sportsFeed.js` | Server-only. Fetches + normalises the five sources (BCCI live/upcoming/recent, ICC `wt20` schedule, the published FanCode dump), merges them into one card shape, and owns every panel the hub reads: `loadFeed`, `cachedFeed` (the shared process cache), `findFeedItem`, `loadHub`, `loadFanCodeScorecard`, `loadIccHighlights`, `parseStartInfo`, `deriveState`, `normalize*`, `iccScorecard`, `backendInnings`, `fcInnings`, `scorecardView`, `fanVariants`. |
| `lib/sportsFeedView.js` | The only sports module a client may import: `HUB_TABS`, `hubTabs`, `hubTabLabel`, `groupFeed`, `countdownLine`, `timeLabel`, `dayLabel`, `statusLine`, `stateChip`, `sourceLine`, `feedLine`, `commentaryView`, `scorecardRows`, `extrasLine`, `panelNote`, `channelReadiness`, `channelCounts`, `channelLine`, `initials`, `dotLabel`. |
| `components/sports/SportsFeed.js` | The board and the hub: `MatchHead`, `LiveScore`, `OverList`, `VideoPanel`, `InfoPanel`, `Scorecard`, `Hub`, `SourcesSheet`, `ChannelsBox`, `ReplaysBox`, the `?tab=` router and the manual Refresh. |
| `app/api/sports/feed/route.js` | One request = the whole merged board, with per-source health. Answers from `cachedFeed` (20 s while a match is live, 5 min when idle, 5 s after a failure). |
| `app/api/sports/hub/route.js` | `?source=<id>&id=<id>` and nothing else — the match's display context is read from the same cached feed, so a match URL can never carry a stale score. |
| `app/sports/hub/[source]/[id]/page.js` | The match at a real address (2 path segments + optional `?tab=`). |
| `tests/sports-hub.test.js` | 36 tests: state derivation, date parsing (incl. the two ways a feed can print a slashed date), cross-source merge, per-source health, the four tabs and their content gates, every panel reader against **captured real payloads**, `cachedFeed`, the fanVariants token rules, plus guards that the deleted surface stays deleted. |
| `tests/fixtures/icc-scorecard.json`<br>`tests/fixtures/icc-commentary.json` | The real ICC `game/scorecard` and `game/commentary` payloads, trimmed to the rows the hub reads. |

## Changed

| Path | What changed |
|---|---|
| `app/globals.css` | The `.jv-sp-*` block (76 classes, no `!important`, 11 px floor, declares no padding on `.jv-sp-page` so `.jv-rail-shift` owns the rail clearance). |
| `app/sports/page.js` | Now a 15-line mount for `SportsFeed`. |
| `next.config.mjs` | `redirects()`: `/match-center/:path*`, `/match/live`, `/match/:path*`, `/sports/player/:path*` → `/sports` (non-permanent on purpose). |
| `middleware.js` | Rate rules for the two new routes (`/api/sports/hub` 40/min, `/api/sports/feed` 90/min); the rules for the deleted routes are gone. |
| `components/navItems.js` | One Sports tab, hint "Matches, scores, streams" (the rail used to carry a separate Live TV entry for this). |
| `components/player/JashPlayer.js`, `docs/PLAYER.md`, `lib/player/resume.js`, `lib/watchStore.js` | Stale `/sports/player` references replaced with the hub. |
| `package.json` | 8.12.0; `lint:player` globs now cover `lib/sportsFeed*.js`, `app/api/sports`. |
| `public/sw.js` | Cache `jash-vibes-pwa-v75` (a PWA shell must be re-fetched to pick the new page up). |
| `README.md`, `.env.example`, `docs/concepts/sports-ideas.md` | Feature bullet, changelog line, rate-limit list; the sports env block (`MOVIES1_BACKEND`/`SPORTS_BACKEND`, `FANCODE_DUMP_URL`, `SPORTS_FANCODE_*`, `SPORTS_WILLOW_*`); the picked-mock note. |

## Deleted (not restyled)

`app/match/**`, `app/match-center/**`, `app/sports/player/**`, `components/SportsMatchCenter.jsx`,
`components/player/DirectWatchPlayer.js`, and the sports API routes nothing called:
`app/api/sports/dynamic`, `app/api/sports/score`, `app/api/fancode/**`, `app/api/match-resolve`,
`app/api/match/**`, `app/api/ipl/**`, `app/api/bcci/**`, `app/api/cricket/**`, `app/api/wt20/**`.
(`app/api/sports/channels` and `app/api/icc/*` stay: the hub's fallback player and the video resolver use them.)

## What each tab can say

* **Live Score** — both team lines (the batting side marked), the feed's own status line, a clock
  (`Starts in 2h 15m` before the toss, elapsed time during play), who is at the crease, CRR/RRR, then
  ball-by-ball folded per over (newest first, wickets and boundaries marked, ball speed when the feed has it)
  — **only when the source actually publishes commentary**; the feed's non-delivery lines are folded below it.
* **Video Highlights** — the streams the match payload itself carries (FanCode `auto_streams`, per audio feed),
  played by JashPlayer with the cookie/referer/UA the token was minted for; ICC-labelled videos resolved through
  `/api/icc/play`; dismissal clips the scorecard points at; and when nothing resolves,
  `Stream unavailable — check FanCode` with a button to the match page. An expired token says so, with the dump date.
* **Match Info** — venue, toss, format, result, player of the match, notes, `view on <source>`,
  and which source the fields came from plus when the dump was published.
* **Scorecard** — innings toggle, batting (R/B/4s/6s/SR + how they got out), bowling (O-M-R-W + econ),
  extras breakdown, fall of wickets, partnerships, powerplays, and the source line.

## Verification for this release

`npm test` 239/239 · `npm run lint:player` exit 0 · `npx next build` ✓ (`/sports` 135 B page, 167 kB first load)
· `next start` smoke: feed 200 with `public, max-age=18`, hub 200 for bcci/fancode/icc, `/api/sports/hub` 429 after
40 calls in a minute, all four old URLs 307 → `/sports` · headless Chrome: 4 tabs on desktop and phone, rail
clearance 188 px @1440 / 78 px @1024 / 0 on mobile, no horizontal overflow, no text under 11 px, `?tab=scorecard`
opens the Scorecard, `play` on an ICC highlight mounts JashPlayer with a resolved manifest, day mode checked.
