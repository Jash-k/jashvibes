# Sports / Match Hub — six directions (round 19)

> **Built in v8.12.0: idea 6, Single Feed.** One rail tab, one merged feed, one hub per match. Round 21 added the
> hub's four tabs on top of the mock — Live Score (ball-by-ball folded per over, only when commentary exists),
> Video Highlights (only real resolved streams; otherwise a stated unavailability plus a link to the source page),
> Match Info (with a "view on FanCode" link when the dump names the match), Scorecard (innings toggle, extras,
> follow-ons, partnerships, powerplays) — and required countdowns on unstarted matches and a manual Refresh. The
> mock below is kept as the design record.

Open `docs/concepts/sports-redesign.html` for the live version: every mock is one set of responsive
markup rendered twice, in a 1440 px desktop frame and a 400 px phone frame. The document itself is
responsive — on a phone, tap a number in the strip at the top and that idea opens at full size, so
what you preview is what you get. The mocks are pressable (cards expand, tabs switch) so you can feel
the interaction, not just the layout.

Six PNGs sit next to this file (`sports-idea-1-match-deck.png` … `sports-idea-6-single-feed.png`, plus
`sports-all-six.png`) for a quick scroll on a phone.

## What is actually wrong today

These are the facts the designs have to answer, all read out of the code:

- **`/sports` mounts a foreign `<iframe>`.** `WILLOW_URL` (page.js:9) is a ~1.4 kB AMAGI URL with a
  signed path hardcoded into the source, wrapped in `m3u8-player-ashen.vercel.app`. The app's own
  `JashPlayer` — the one with ClearKey, the recovery ladder, resume, aspect handling and error
  recovery — is not used. `components/SportsMatchCenter.jsx:796` does the same for FanCode.
- **`/api/sports/channels` is never called.** It exists, filters the live-TV catalog to sports, adds the
  two `SPORTS_*` env slots and returns `keyId/key/cookie/referer/priority` per channel. Nothing fetches
  it, so the rail's hint "Live channels & streams" has no page behind it. The page shows one hardcoded
  card instead.
- **Four routes render the same 981-line hub component:** `/match/[[...slug]]`, `/match/[slug]`,
  `/match-center/[hash]`, `/match-center/[[...hash]]`. Inside it, three near-identical provider
  components (`SharedBcciIplCenter`, `Wt20MatchCenter`, `FanCodeMatchCenter`) each re-parse their own
  shapes, and `app/sports/page.js` re-normalises the WT20 rows a fourth time inline.
- **The match hub's identity is a base64 blob of the score.** `encodeMatchHash()` packs the whole match
  (scores, result, venue, status text) into the URL, so a shared or reopened hub shows the snapshot
  from whenever the link was made, and the `[[...hash]]` catch-all exists because the string is long.
- **`/sports` links to `/match/live`** (page.js:298) — one of those four routes, reachable only by
  accident.
- **Type sizes of 8 px and 9 px** in `ChannelCard`/`StreamPlayer`, unreadable on the TV wrapper.
- **Zero tests.** 19 test files, none for sports. That is why the hub keeps drifting.

## The feeds that exist

| feed | what it really is | what it can honestly answer |
| --- | --- | --- |
| `/api/sports/score?feed=live\|upcoming\|recent` | `scores2.bcci.tv`, normalised | status text, team names, venue, date/time, result string |
| `/api/wt20/{schedule,scorecard}` | `assets-icc.sportz.io` via `lib/sportsProxy` | fixtures, innings lines, scorecards |
| `/api/cricket\|bcci\|icc/[endpoint]` | proxy to `MOVIES1_BACKEND` (Render free tier → sleeps) | whatever is up, with `EMPTY` fallbacks |
| `FANCODE_FEED` | a third-party GitHub JSON dump | title, tournament, status, `auto_streams` HLS text |
| `/api/fancode/scorecard?matchId` | scrape of `fancode.com` scorecard HTML | bat/bowl rows, no auth |
| `/api/sports/channels` | live-TV catalog + 2 env slots | playable URLs with keyId/key/cookie/referer |
| `/api/live-proxy?src&ref&ck` | SSRF-guarded header proxy | any HLS that needs a Referer or Cookie |
| `/api/match/{id}/summary`, `/api/match-resolve` | `MOVIES1_BACKEND` | one match, by id |

## Idea 1 · Match Deck

**Pitch.** One wall of match cards, live ones first. A card carries status, competition line, both teams
with their score, and — for a live match — the player peek. Pressing it expands *that card* into the hub
(Watch / Scorecard / Commentary / Table / Info). Channels and the rest of the day stay as strips below.

**Layout.** Rail → mast (`☰ · Sports · live desk`, `3 live`, `All formats`, `Filters`) → deck grid
3-up desktop, 2-up tablet, 1-up phone → lanes ("Starting later today", "Channels that actually play").
Same family as ReTro and the Catalog Shelf, but the card, not the row, is the unit of navigation.

**Best if** you want one screen that answers "what's on, and can I watch it" without pressing anything.

## Idea 2 · Score Desk

**Pitch.** A permanent two-pane desk: every match on the left (chip filters, not tabs), the hub on the
right, swapping contents without a route change. All five hub panels stay on screen at once with the
score bar pinned above them.

**Layout.** Rail → mast (`polling 60 s`, `IST`) → 296 px list column + fluid hub column; phone stacks
the list first with the score bar sticking to the top of the hub. Keyboard/TV friendly: focus walks a
list, Enter loads the hub beside it.

**Best if** you follow several matches a day and want tables, not cards. This is also the only place the
poll is justified: 60 s, and only while the tab is visible and something is live.

## Idea 3 · Channel Wall

**Pitch.** The stream is the page. A player holds the stage, a zapper strip of sports channels sits under
it, and a live score card floats on top of the picture — so switching Willow → Ten 1 never leaves the
page and never covers the game. The hub is a panel you slide up over the bottom of the video.

**Layout.** Rail → mast (channel name, `playing`, `ch 101`) → 16:9 stage (452 px tall on desktop) with
an overlay bar on top and a score card on the bottom-left → zapper row → two minis below (hub for the
match on air, "switch the game not the page"). Phone: stage on top, scores under the fold where a thumb
reaches them.

**Best if** the TV wrapper is the main way you watch sports. Channels report readiness honestly:
`ready`, `ClearKey key ok`, `needs Referer · via /api/live-proxy`, `SPORTS_FANCODE_URL unset`.

## Idea 4 · Fixture Timeline

**Pitch.** Sports is a schedule problem before it is a score problem. The day goes on a 24-hour IST axis,
one lane per venue, with the now-line you already have in the TV guide, so overlaps are visible as
overlaps. Tap a block, the hub for it lands directly under the axis.

**Layout.** Rail → mast (`Friday 9 · 8 fixtures`) → day chips (reusing the guide's `DayStrip` shape) →
axis with live/starting/finished blocks coloured only from `MatchStatus` or a result string → day list +
docked hub. Phone: the axis is a wide-screen instrument and folds away, leaving the same day in words.

**Best if** three tournaments run at once — this is the only design where you can see that, before
choosing. A match whose feed has no start time sits at the end of the day labelled `start not in feed`,
never at 00:00.

## Idea 5 · Follow Board

**Pitch.** Sports is mostly waiting. Pin the matches you care about and the board keeps four things per
card: the current line, the **delta since you last opened it** (a wicket, +14 runs, kickoff +12'), a
last-overs strip, and how old the read is. Nothing refreshes until you look.

**Layout.** Rail → mast (`2 changed`, `score only`) → board 3-up/2-up/1-up → "pin a match from anywhere"
tile → two lists below (on today and not pinned, replays). Pins live in `localStorage`
(`jash:sports:follow:v1`) — the shelf's rule: no Mongo writes for browsing state, works on a phone,
survives a Render sleep.

**Best if** you want the app to be quiet and only tell you what moved. Also the only idea with a
deliberate score-only mode for a phone in a pocket (no autoplay, no data).

## Idea 6 · Single Feed

**Pitch.** One vertical column of the same card, two type sizes, one accent, no tabs at all: live now →
starting today → finished, then channels, standings and replays in an aside that appears at 1100 px. The
desktop page is the phone page with a rail bolted on — which is why it is the hardest one to break.

**Layout.** Rail → mast (`Friday 9 · IST`, `3 live`) → rules + cards; pressing a card opens its hub in
place, and the only state on the page is which card is open.

**Best if** you want the smallest thing that still works. Deletes the most code: `ChannelCard`,
`StreamPlayer`'s iframe, `activeTab`, `matchFilter`, `BASE_CHANNELS`, the Willow URL in source.

## What ships with whichever you pick

Not design choices — fixes, already scoped:

1. **One player.** Sports mounts `JashPlayer` with `createLiveTvPolicy` (the same ClearKey / direct /
   `/api/live-proxy` ladder `/live` uses). The third-party iframe and the hardcoded AMAGI URL go away.
2. **One hub route:** `/sports/hub/{source}/{id}` replaces the four routes and the base64 hash. A link
   opened tomorrow reads tomorrow's feed.
3. **One normaliser** for BCCI / ICC / FanCode / channels, replacing three provider components and the
   inline copy in the page; `SportsMatchCenter.jsx`'s 981 lines become a data module plus the chosen
   layout.
4. **`/api/sports/channels` wired up**, with per-channel readiness (`ready` / `key ok` / `needs proxy` /
   `env unset`) and the env slots documented in `.env.example`.
5. **Truth rules kept:** no invented totals; an empty panel names the feed that was empty; a slept
   backend says `waking the score feed · press reload` instead of spinning; a match not started shows the
   kickoff time and nothing else.
6. **Craft rules from the last two rounds:** 11 px type floor, tabular figures, day mode checked rather
   than assumed, and horizontal gutters on the inner wrapper so `jv-rail-shift` is never overridden.
7. **`tests/sports-hub.test.js`:** merge/dedupe across feeds, the hub URL shape, readiness states, the
   empty-panel lines, plus structural guards on the page source and CSS — the same discipline the shelf
   has, and the reason it stays fixed.
