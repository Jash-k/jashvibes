# Music section — 36 redesign directions (v8.15.0 candidates)

**Board files on disk (7, ~14 MB):** `music/25-aurora.png`, `music/31-curtains.png`, `music/32-refract.png`,
`music/33-silk.png`, `music/34-inkwater.png`, `music/35-terrazzo.png`, `music/36-dawn.png`. Boards 01–24 are still
described in full below, but their renders were pruned as asked — say the word and I'll re-render any of them.

Five sets of six: 01–06 general, 07–12 wider mechanics, 13–18 with the Albums · Artists · Playlists tabs as the
organising device, 19–24 in Audiopile's studio-file vocabulary (19–24 assume one prerequisite, described after
section 24: server-generated waveform peaks), and 25–30 as pure aesthetic, each with a day-mode **pair** rather than
a corner strip.

Rendered as one board per idea, **desktop and mobile side by side**, each board showing the four required
surfaces: **main player, mini player, lyrics panel, control bar**, plus a small `day mode` strip.

| # | Idea | Board |
|---|---|---|
| 01 | Stage | `01-stage.png` |
| 02 | Console (turntable) | `02-console.png` |
| 03 | Studio Desk (timeline) | `03-desk.png` |
| 04 | Karaoke Split | `04-karaoke.png` |
| 05 | Ambient Orb | `05-ambient.png` |
| 06 | Card Stack (Rail OS native) | `06-cardstack.png` |
| 07 | Cinema Marquee | `07-marquee.png` |
| 08 | Crate & Mixtape | `08-crate.png` |
| 09 | Chart Ruler | `09-charts.png` |
| 10 | Discography Timeline | `10-timeline.png` |
| 11 | Big Board (TV-first) | `11-bigboard.png` |
| 12 | Radio Dial | `12-dial.png` |
| 13 | Gatefold | `13-gatefold.png` |
| 14 | Jukebox | `14-jukebox.png` |
| 15 | Transit Map | `15-metro.png` |
| 16 | Teletext | `16-teletext.png` |
| 17 | Kolam | `17-kolam.png` |
| 18 | Terminal | `18-terminal.png` |
| 19 | The Pile | `19-pile.png` |
| 20 | Takes & Versions | `20-takes.png` |
| 21 | Group Feed | `21-feed.png` |
| 22 | The Tray | `22-tray.png` |
| 23 | Audio Thumbnails | `23-thumbnails.png` |
| 24 | Data Budget | `24-budget.png` |
| 25 | Aurora Mesh | `25-aurora.png` |
| 26 | Mallsoft | `26-vapor.png` |
| 27 | Risograph | `27-riso.png` |
| 28 | Pressed Botanical | `28-botanical.png` |
| 29 | Kinetic Type | `29-kinetic.png` |
| 30 | Night Window | `30-nightwindow.png` |

**All of 13–18 carry a real Albums · Artists · Playlists tab strip in both desktop and mobile.** That is a genuine
addition, not a restyle: today `/music` keeps the facets in state (`view` switches on `home`, `search`, `albums`,
`artists`, `playlists`, `favorites`, `recent`) and prints them as *stacked* `SectionHeader` blocks inside the search
view (`app/music/page.js:1229-1232`), so there is no persistent bar to switch between them. The APIs already answer
all of it — `/api/music/albums`, `/artists`, `/playlists` plus `/album`, `/artist`, `/playlist` detail and the
fourth facet `songs`, which every idea keeps reachable through the ⌘K search rather than a fourth tab, because the
rail owns navigation.

Pick one number. **The picked board becomes the spec — nothing gets merged with the current music UI or with
another idea** (the same rule that governed the homepage and sports rebuilds). What is shared by all six, and
therefore is not a design decision: the fixed left rail (mounted by the page itself, with `.jv-rail-shift`
reserving its 188 px on desktop/TV so nothing sits under the nav) and the bottom dock on phones; one `--mu-*`
token block that day mode flips instead of overriding (the `.jv-an-*` lesson); no control nested inside a control;
artwork is content, never chrome; keyboard + TV-remote focus (arrows/Tab/Enter/Backspace) on every button;
`localStorage` keys kept as they are (`jash_music_favorites`, `jash_music_recents`, `jash_music_volume`,
`jash_music_muted`); the quality ladder (`320kbps → 160 → 96 → 48 → 12 → auto`) and `isHlsUrl` stay in the data
layer; every surface keeps a *reason* when the source fails, the same way the anime sheet names which host was
skipped and why.

---

## 01 · Stage

**Idea.** The album art *is* the room: a blown-up, blurred copy fills the page under a dark vertical gradient, and
everything else floats on it. Nothing is boxed — one lyric column and one control row.

- **Desktop.** Rail at 72 px. Left column ≈ 400 px: sharp square artwork, title, artist, a `320kbps` chip, then
  the control bar (prev · play · next · shuffle · repeat · volume slider · `1:24 / 3:45`). Right ≈ 55 %: the lyrics
  card with the active line large and bright, neighbours dimmed and smaller, thin scroll indicator.
  **Mini player** is a 56 px strip pinned top-right of the content column (artwork thumb, title, three buttons) with
  a 2 px progress line along its bottom edge.
- **Mobile.** Full-bleed blurred art; a rounded sheet in the bottom third holds the artwork thumb, title, artist and
  a four-button bar with a thumb-height progress line. Drag the sheet up → the lyrics take the sheet. Mini player
  floats as a 64 px pill above the dock.
- **Reuses.** `VinylArt` becomes `StageArt` (same `<img>` + blur + gradient, no new fetch). Lyric rendering keeps
  `parseSyncedLyrics`/`parseLrcTimestamp`; plain-lyric fallback stays a scrollable card.
- **Cost / risk.** Lowest. The real work is contrast: text over a generated background must keep WCAG-safe ratios
  for *every* artwork, so the gradient stop is derived from the art's average luminance, not fixed.

## 02 · Console

**Idea.** Playback as a physical deck: the disc is the artwork, the **tonearm is the scrubber** (its angle reads as
progress), volume is a rotary knob, shuffle/repeat are toggles, the queue is a stack of sleeves, and the lyrics are
printed on a paper insert sliding out of the sleeve.

- **Desktop.** Vinyl ≈ 2/3 of the window with the tonearm on the right and the timecode printed on the plinth;
  metal strip under it: `shuffle` `repeat` toggles, volume knob, three transport buttons. Right third: QUEUE (three
  overlapping sleeves) above the off-white **insert · lyrics** page with the current line marked in orange.
  **Mini player** is a cassette chip bottom-left (two reels spinning, tape label = title).
- **Mobile.** Deck fills the top ~60 %, sleeves become a horizontal carousel, the insert opens as a full-screen paper
  sheet with a drag handle; four large thumb buttons on the metal strip; cassette chip sits above the dock.
- **Reuses.** The existing `VinylArt` spin animation is already the seed of this. Sleeve art = current playlist
  artwork, no new API.
- **Cost / risk.** Highest craft budget, and the tonearm must stay accessible: the arm is a *presentation* of an
  invisible `<input type="range">` with proper `aria-valuetext` ("1:24 of 3:45"), drag + arrows + PageUp/PageDown all
  scrub. Skeuomorphic knobs are hard to hit precisely on a phone, so mobile's volume is a slider in a long-press
  sheet, not a knob.

## 03 · Studio Desk

**Idea.** Treat a playlist like an editing session: the queue is a data table with waveform rows, the player is a
persistent transport band across the bottom of the window, and lyrics open as a right drawer with a timestamp gutter.

- **Desktop.** Table: index · waveform · title · artist · duration · `320kbps`, hairline separators, one row flagged
  `playing`. Bottom **main player**, 120 px: 96 px artwork, title/artist, a long waveform with playhead and painted
  progress, and the control bar at its right. Right drawer 34 % wide = **Lyrics · synced** with `01:12 01:16 01:21`
  in the gutter and a `timestamps` toggle. **Mini player** = that band collapsed to 44 px (thumb, title, compressed
  waveform, play).
- **Mobile.** List-first: waveform rows fill the screen; transport becomes a 60 px bar above the dock; lyrics are a
  half-sheet with snap points (peek / half / full) keeping the timestamp gutter.
- **Reuses.** This is the most honest mapping to the current data: `dedupeQueue`, `chooseBestQuality` and the
  per-source warnings already exist as lists and chips; the redesign mostly re-parents them.
- **Cost / risk.** Needs real per-track waveforms. Options, in order of preference: precompute on the server into the
  playlist payload (peaks array, ~2 KB/song — breaks the "no per-request parse" rule if done per request, so it must
  be cached with the playlist), or draw a fake-but-honest progress rail and label it as such. **Never** fetch audio
  bytes to compute peaks in the browser. Waveforms must degrade to a plain progress bar for HLS-only rows.

## 04 · Karaoke Split

**Idea.** A hard 50/50 screen. Left: player. Right: a lyric board where **every line is Tamil script + uppercase
romanisation**, one word of the active line is highlighted as it is sung, and each line has a loop-pin so a line can
be practised. The mini player is a pill that shows the current *lyric* instead of the title.

- **Desktop.** Left half: framed square artwork, title, artist, a segmented five-button bar, progress + volume.
  Right half: lyric rows — mono timestamp, large Tamil line, small romanised line, loop-pin at the right edge,
  cyan pill behind the sung word; header toggles `Tamil` / `Romanised`. **Mini player** floats bottom-centre as a
  48 px pill with the active lyric line as its second line.
- **Mobile.** Split vertically: lyrics top 65 %, player bottom 35 % (artwork thumb, title, four large buttons,
  progress line); the lyric pill sits above the dock, so a phone can be used one-handed while the words stay put.
- **Reuses.** `parseSyncedLyrics` already yields timestamps and lines; the existing `Karaoke Lyrics` label in the
  current UI is exactly this feature, promoted to the whole page. Romanisation comes from `/api/music/lyrics`
  when the source provides it; when it does not, the row renders one line and the toggle hides itself rather than
  showing a fake transliteration.
- **Cost / risk.** Word-level highlight needs word timings; LRC gives line-level. So: highlight the *line*, and
  within it animate a sweep across words using the line's duration — labelled as a sweep, not claimed as accuracy.
  Long Tamil lines must wrap without clipping on a 320 px viewport.

## 05 · Ambient Orb

**Idea.** No rectangles for the player. A centred audio-reactive orb, controls as a ring of six glass buttons around
it, artwork reduced to a 120 px chip, and lyrics as unboxed floating text with depth-of-field: the active line sharp
and coloured, the rest blurred out of focus.

- **Desktop.** Orb ≈ 460 px with concentric ripples and a spectrum rim; a ring of six circular buttons (shuffle, prev,
  play, next, repeat, queue) with the hairline progress arc drawn along the ring and the timecode just under the orb.
  Right third: floating lyrics with a `blur` toggle. **Mini player**: 40 px glowing pill with a 24 px artwork dot,
  current lyric, and a 1 px live waveform, top-left of the content area.
- **Mobile.** Orb fills the screen; a tap hides/reveals the controls; swipe up opens the floating lyrics full-screen.
  Control bar = one row of four plus the play button centred above it, timecode under. Mini pill under the status bar.
- **Reuses.** The orb is driven by the same `AnalyserNode` that would drive a visualiser; nothing new in the data
  layer. If audio analysis is unavailable (autoplay-muted, HLS without CORS), it falls back to a CSS breathing
  gradient rather than a frozen circle.
- **Cost / risk.** The most beautiful and the most expensive per frame: `requestAnimationFrame` + canvas is a
  battery/thermal problem on a phone and a jank problem on a TV box. Mitigations that must be in the spec: cap the
  analyser FFT at 256, drop to 30 fps on mobile, pause the loop when the tab is hidden or the player is the mini pill,
  and a `reduced-motion` setting that renders a static gradient. Contrast over a glowing field is the other risk:
  lyric text needs its own scrim.

## 06 · Card Stack (Rail OS native)

**Idea.** Extend the language the homepage already uses — one focused item plus a column of cards where exactly one
card is expanded — and put the mini player **in the rail footer**, so it keeps playing (and keeps its progress line)
when you navigate away from Music.

- **Desktop.** Focus block: 420 px artwork with a yellow focus ring, title, artist, and the control bar beside it
  (shuffle · prev · play · next · repeat · volume · timecode · `320kbps`). Below: the expanded **Lyrics · synced**
  card (active line pulled up into the card header as a bright subtitle, `Karaoke` toggle top-right), then collapsed
  48 px strips `Queue · 14`, `Playlists`, `Artists`. **Mini player** = 56 px block at the bottom of the rail: 32 px
  thumb, title, play/next, 2 px progress line along the footer's top edge.
- **Mobile.** The focus card on top, a swipeable vertical deck (expanded lyrics, collapsed strips peeking above and
  below), control bar as the focused card's bottom row (four large buttons + fat progress line); mini player becomes
  a 56 px strip attached to the top edge of the dock, with progress drawn as the dock's top border.
- **Reuses.** Highest continuity: cards are the same shape the home rail already uses, and the rail footer is
  already shared chrome, so "music keeps playing while you browse" finally has somewhere to live. This is the only
  idea whose mini player is app-wide rather than music-only — that also makes it the largest *behavioural* change
  (a global player host: mount once above the layout, move `JashPlayer`/audio element ownership out of `/music`).
- **Cost / risk.** The persistence change touches `app/layout.js`, `components/rail/RailNav.jsx` and every page's
  bottom padding, plus its own focus-management and day-mode work. It is the idea most likely to be *right* in two
  years and the one that costs the most this quarter. A middle path exists (rail footer shows a "return to player"
  strip while playback continues via the shared audio element) — but that is a compromise the board does not show,
  so it must be chosen explicitly, not slipped in.

---

## What happens after the pick

1. Tokens first: `--mu-*` block (night) + day-mode override in `app/globals.css`, measured in both themes control by
   control before anything else is called done.
2. Build the surfaces in this order — lyrics panel, control bar, main player, then mini player — with tests written
   against the board (rail mounted and lit, `.jv-rail-shift` present, no nested interactive elements, lyric rows keep
   their timestamps, every control's `aria-label`).
3. Then the browser pass on real data at 1440, 1920 (TV), 390 and 360 widths, including `prefers-reduced-motion`,
   because a design that only survives at 1440 is not the design you picked.
4. Nothing from the current music UI survives by default except data-layer modules; if a control in the board is
   missing a real backend, it is not drawn.

---

# Second six (07–12)

Same rules as 01–06, deliberately different mechanics rather than recolours. Boards: `07-marquee.png` …
`12-dial.png`.

## 07 · Cinema Marquee

**Idea.** A song is *screened*. The player is a 21:9 letterboxed band over a blurred still, the lyric line is burned
into it like a real subtitle, and the song's structure sits under it as a chapter ruler.

- **Desktop.** 480-ish px letterbox stage with two burned lines inside it (large Tamil, small romanisation) on a soft
  scrim; below, a chapter strip with ticks and `verse 1 / chorus / verse 2 / bridge`, the played portion in gold and a
  diamond playhead; then the control bar (prev · play · next · shuffle · repeat · volume · `1:24 / 3:45`). Poster chip
  top-right with a `320kbps` chip. **Mini player** = a perforated ticket stub (artwork dot, title, a punch-hole row as
  progress), pinned top-left.
- **Mobile.** Stage on top with its subtitles inside; chapter ticks under it; four buttons plus a thick gold progress
  line; a **subtitles-only** mode that drops the stage and keeps just the two lines at the bottom with a large reading
  area; ticket stub above the dock.
- **Reuses.** Section markers come from the LRC file when it has them; when it does not, the ruler shows only
  start/end and the labels hide — never a fabricated `chorus`.
- **Cost / risk.** Subtitle legibility is the whole design: needs a per-artwork luminance-derived scrim, and burned
  text must never collide with the control bar in landscape on a phone.

## 08 · Crate & Mixtape

**Idea.** Progress is physical: the tape wound on the reels *is* the progress bar. A playlist is a crate of tapes, and
an album is one tape with an A-side and a B-side.

- **Desktop.** Cassette case ≈ 560 px with two reels whose wound radius tracks the position, hand-lettered title on
  masking tape, cardboard control strip below (rewind-side · play · fast-forward-side · a record-style **like**
  button · volume · timecode). Right: the crate (≈ 8 spines, one pulled out, headed `Current Playlist`) above the
  unfolded **J-card insert**, ruled like paper with the active line circled in marker. **Mini player** = a cassette
  lying flat, 44 px, reels turning.
- **Mobile.** Tape on the top half with reel progress; `A-side` / `B-side` segments for the album tracklist; crate
  becomes a spine carousel; the J-card opens as a full-screen sheet; cassette chip above the dock.
- **Reuses.** A-side/B-side is genuinely how the album payloads arrive (tracklist order), so it is a *real* structure,
  not a decoration. The like button writes the existing `jash_music_favorites`.
- **Cost / risk.** The reel metaphor must stay readable at 44 px, and the paper/marker textures need a day-mode
  variant that does not turn into a brown smear — the reason the board shows both.

## 09 · Chart Ruler

**Idea.** Lead with what the app already fetches and never showed well: the chart. A ranking list with movement
arrows and a seven-day sparkline per track; the player is a broadcast ticker across the top; the mini player is a
spinning "now" gauge.

- **Desktop.** 76 px ticker band: thumb, title, artist, a long thin progress line, `1:24 / 3:45`, then the control
  bar inline at the right with a `320kbps` chip. Tabs `Trending / Charts / New`. Rows: huge rank numeral, `+2` /
  `-1` / `—`, title · artist, a sparkline, duration, a play triangle; the current row is tinted lime with
  `spinning now`. Right: a narrow **lyric sheet** with a monospace timestamp gutter and an `auto-scroll` toggle.
  **Mini player** = a 64 px circular gauge, artwork inside, a dot for progress.
- **Mobile.** 56 px ticker, full-screen ranked rows, lyrics as a bottom sheet keeping the gutter, four buttons fixed
  at the bottom above the dock, small gauge above that bar.
- **Reuses.** Maps straight onto `/api/music/charts`, `/trending`, `/new` — the only genuinely new data is the
  seven-day history, which needs one cheap daily snapshot in `localStorage` (no MongoDB writes for browsing state).
- **Cost / risk.** Sparklines lie if there is no history. Until seven days of snapshots exist, render the movement
  arrow and an empty ruled slot instead of a made-up curve. First release will look sparse; that is the honest state.

## 10 · Discography Timeline

**Idea.** Enter through the *artist*, not the album: a horizontal spine of years with each release as a plate, the
selected release's tracklist below it, lyrics as a reading card that slides up from the spine.

- **Desktop.** Artist header (96 px portrait, `Albums 12 · Singles 48 · Lyrics 40`, a Follow button); a rule with
  year ticks 2016→2026 and about nine album plates of varied size, the selected one raised with a terracotta ring;
  a two-column tracklist with index, title, duration and a `has lyrics` glyph; a persistent 64 px main-player band at
  the bottom of the window; a 380 px **Lyrics** reading card as an overlay with a close X; **mini player** = a 48 px
  vertical strip riding the content edge with rotated title and a play triangle.
- **Mobile.** Portrait plus name; horizontally scrollable spine; list under the selected plate; lyrics as a
  full-height card with a drag handle; control band at the bottom; mini strip above the dock.
- **Reuses.** `/api/music/artist` and `/api/music/albums` already return both shapes; `has lyrics` is a real flag
  from the lyric endpoint, which lets the list promise nothing it can't open.
- **Cost / risk.** The board came out as an *ivory* theme, so 10 has only one palette rendered. Before building it I
  would re-render the dark variant, because that is the theme the app spends most of its life in.

## 11 · Big Board

**Idea.** Not a desktop layout shrunk to a TV — a TV layout that happens to also work on a phone. Three or four
targets per row, every control reachable with arrows/Tab/Enter/Back, no dragging (scrubbing is ±10 s steps), lyrics
as captions under the art so they can be read from a sofa.

- **Desktop/TV (1920×1080).** 96 px labelled rail (home · live · anime · music · sports · classics · stremio) with a
  thick white focus ring on the active item; left half a 480 px artwork inside a heavy ring; under it two caption
  lines only — previous line small and dimmed, current line huge, romanisation beneath, no scrollbar and no box;
  right half the queue as five large rows; a 120 px control band of five enormous circles including `-10s` `+10s`
  with a thick progress line above and `320kbps` at the right. **Mini player** = a 64 px badge with a progress arc.
- **Mobile.** Same three-target model: artwork block, two captions, four huge buttons plus progress and timecode,
  queue and lyrics each a full-screen list, mini badge above the dock.
- **Reuses.** `usePlayerGestures`, the remote key handling and `PlayerIncidents` focus states are already in the
  player; this layout just stops assuming a mouse.
- **Cost / risk.** Two known defects in this render to fix before it counts as a spec: the model drew my instruction
  text as the queue rows (`index, title, artist, duration`) and as the caption lines, and it printed `-10s` twice.
  If this is the pick, it gets one clean re-render with real labels first.

## 12 · Radio Dial

**Idea.** Music as a station you tune. Six presets are the playlists, a tuning dial picks the track inside the
current playlist, signal bars read as bitrate, an ON AIR lamp is the now-playing state, and the lyrics are printed on
a receiver nameplate that flips open.

- **Desktop.** Receiver faceplate: a 340 px dial with track names around its rim and the pointer on the current one,
  red ON AIR lamp top-left, five signal bars + `320kbps` top-right, six pushed-in-capable preset buttons
  (`Morning · Workout · Melody · Retro · Focus · Party`), a machined control strip (prev · play · next · shuffle ·
  repeat · **round volume knob** · timecode). Right: `nameplate · lyrics` on brushed aluminium, active line embossed.
  **Mini player** = a 44 px tuning-window readout with a needle on a miniature scale.
- **Mobile.** ON AIR lamp and dial on the top half, presets as two rows of three chunky buttons, the queue as a
  horizontal needle scale, a nameplate sheet with a drag handle, four buttons plus a fat progress line.
- **Reuses.** Presets map to saved playlists (`/api/music/playlists`, `musicPlaylistStore`); "quality = signal"
  maps to the existing `QUALITY_LABELS` ladder, so the metaphor carries real numbers.
- **Cost / risk.** A dial is a poor slider on a phone: the touch target must be the *scale strip*, not the dial face,
  and the round knob needs a keyboard path (arrows) or it is dead on a TV.

---

# Third six (13–18) — each with the Albums · Artists · Playlists tabs in the layout

Boards: `13-gatefold.png` … `18-terminal.png`. Every one of these treats the tab strip as the *organising device of
the concept*, not a row of pills: the tabs change what the whole page is made of.

## 13 · Gatefold

**Idea.** The page is an opened gatefold LP jacket lying flat on a table. Left inside panel = the record, right inside
panel = the liner notes.

- **Tabs.** Three paper flaps printed along the top edge of the jacket; the active flap is lifted and shows a cyan
  underside. `Albums` → jacket spread. `Artists` → the same spread with the artist's photo sleeve as the left panel.
  `Playlists` → the crate of folded inserts, one jacket per playlist.
- **Desktop.** Left panel: artwork, `Nizhal Palai`, `Anirudh Ravichander`, a ten-line numbered tracklist with
  durations and a cyan tick on the playing line. Right panel: **LYRICS** as liner notes — justified Tamil lines with a
  romanised line under each, current line reversed out to white-on-cyan, a folio number bottom-right. Straddling the
  crease at the bottom: the CONTROL BAR as a printed strip (shuffle · prev · play · next · repeat · volume ·
  `1:24 / 3:45`). **Mini player** = a small folded sleeve card top-right with artwork, one line of title, a play
  button and a cyan hairline progress, tagged "mini".
- **Mobile.** Flap tabs under the status bar; cover → title → tracklist in one column; the liner notes are the
  *second page of the jacket* reached by a horizontal swipe (no drawer, no sheet); printed control strip as the
  bottom row with four large buttons and a thick rule; sleeve-card mini above the dock.
- **Reuses.** `openAlbum` / `openArtist` / `openPlaylist` and `HorizontalRow` become the panels; `selectedCollection`
  already distinguishes `album` / `playlist` / `artist` with `Album Tracks`, `Playlist Songs`, `Top Songs` headings
  (`app/music/page.js:1334-1335`), so the fold carries real labels.
- **Cost / risk.** A two-page spread is the one layout where a phone genuinely loses content, so the swipe must have a
  visible page cue; and paper textures need a day-mode pass, since ink-on-cream is the *only* honest rendering.

## 14 · Jukebox

**Idea.** A wall jukebox: the arched top is the player, the lit title cards are the library, and the machine's side
column prints the lyrics.

- **Tabs.** Three illuminated rectangular buttons under the arch — `Albums`, `Artists`, `Playlists` — each swapping
  *what the card grid contains*; the selected button is lit turquoise, the others dim.
- **Desktop.** Arch = 96px artwork tile centred, title and artist lit either side, a thin curved progress line with a
  travelling bulb and the timecode along the arch's foot. Grid = 4×6 numbered title plates (01–24) with thumbnails,
  one pushed in with an amber `PLAYING` tab. Side column = **LYRICS** with the active line backlit turquoise and a
  chrome `SCROLL` lever. Bottom = chrome round-button control row (shuffle · previous · play · next · repeat), a tone-
  control volume slider, and a coin slot reading `320kbps`. **Mini player** = a speaker-grille badge top-left, artwork
  dot, one line, amber progress, tagged "mini".
- **Mobile.** Arch shrinks to a lit header; tabs become three full-width illuminated bars; the grid is two columns of
  six plates; lyrics open full-screen with the close lever; five large chrome buttons above the dock; the grille badge
  rides above the dock.
- **Reuses.** `QUALITY_LABELS` becomes the coin slot, `Listening Mode` becomes the machine's mode switch, the queue
  is the card grid. Nothing invented.
- **Cost / risk.** 24 lit cards is a lot of imagery: thumbnails must come from the cached playlist payload, and the
  grid needs a "24 shown, 200 exist" affordance rather than fake pagination. This render also garbled its plate
  numbers (18 and 24 repeat) and printed `1:24 / S45` — clean re-render if picked.

## 15 · Transit Map

**Idea.** The queue is a metro line and the song is a train on it. Progress inside a track is the train moving
between two stations.

- **Tabs.** A pill strip `Albums · Artists · Playlists` at the top-left of the content; switching changes *the
  network*: albums are loops, artists are interchanges, playlists are lines.
- **Desktop.** Map panel: a coloured line with one circle per track, passed stations filled, upcoming hollow, the
  current one enlarged as an interchange ring, a train glyph sitting between current and next with `1:24 / 3:45`, and
  a grey parallel line bracketed "4 more stops" for the rest of the queue. Control bar below the map: previous · play
  · next · shuffle · repeat · volume · two `next stop / previous stop` buttons · a ticket-shaped `320kbps` chip.
  Right column: **Lyrics** as a departure board — mono timestamps `01:12 01:16 01:21` beside Tamil lines, current row
  in a coloured bar with a triangle, footer `auto-scroll`. **Mini player** = a platform-ticket card, 56px, artwork
  square, one line, a 2px progress rule, tagged "mini".
- **Mobile.** The line runs vertically down the screen with station names beside the circles and the train at the
  current one; tabs sit directly under the status bar; lyrics open as a bottom sheet keeping the timestamp gutter;
  four large buttons plus progress above the dock; ticket card above that.
- **Reuses.** `dedupeQueue` output is literally the station list; `parseSyncedLyrics` gives the departure board rows;
  next/previous-stop maps to the existing next/previous track actions.
- **Cost / risk.** Eleven+ labels on a horizontal line collide at 1440 — labels must rotate or drop to dots with a
  hover/focus tooltip. This render leaked the string `2px` into both mini cards and duplicated one station name, so
  it needs a clean re-render before it is a spec.

## 16 · Teletext

**Idea.** Broadcast teletext: every screen is a numbered page, the library is the index, the lyrics are page 300, and
the player is the banner.

- **Tabs.** Index rows `1 ALBUMS`, `2 ARTISTS`, `3 PLAYLISTS` — the selected row reversed out white-on-cyan. On the
  phone they stay as full-width rows, and the remote's number keys jump directly to them.
- **Desktop.** Header bar `MUSIC TELETEXT · PAGE 100 · 1:24 / 3:45`. Player banner in a yellow block with the title in
  block capitals, a progress bar drawn from block characters, artist and `320kbps` in magenta. Index grid of album
  rows with block-colour bullets and years. Right third: `300 LYRICS` with a timestamp column beside Tamil lines in a
  blocky face, current line in a green reverse block tagged `NOW`, and a `BACK TO 100` row. Footer control bar as
  colour keys — RED shuffle, GREEN previous, YELLOW play, CYAN next, MAGENTA repeat — plus `VOL ###-------`.
  **Mini player** = a picture-in-picture CRT inset in the header with artwork, one line and two block characters of
  progress, tagged "mini".
- **Mobile.** Yellow banner at the top, three index rows, one column of album rows, page 300 full-screen with a
  `q BACK TO 100` row, five colour keys across the bottom with a thick block progress line, PiP mini above the dock.
- **Reuses.** The grid is exactly what the search view already renders as stacked sections (`Albums` / `Artists` /
  `Playlists` / `Songs` with counts) — the redesign turns that list into pages with numbers.
- **Cost / risk.** A blocky pixel face must still render Tamil correctly — that needs a real test with Tamil glyph
  clusters at 16px, or the concept dies on the one script the app is named for. Contrast and scanline effects are also
  the worst case for day mode, so day mode here is a *printed page* variant, not a lit screen.

## 17 · Kolam

**Idea.** The library is a dot grid; every album is a kolam loop drawn around its dots. The loop that is playing is
traced in gold, the rest stay dotted outlines.

- **Tabs.** Three small kolam loops with the label inside each: `Albums` drawn in solid white as the active one,
  `Artists` and `Playlists` as faint dotted outlines that complete when focused or chosen.
- **Desktop.** Main player = a symmetric pattern about 420px with the artwork square at its centre, title and artist
  in fine serif capitals below, and one arm traced in gold from 12 o'clock so the arc *is* the elapsed time,
  `1:24 / 3:45` at the pattern's foot. Right = the **LYRICS PANEL** as a palm-leaf (ola) strip, ruled like a
  manuscript with a central string hole, seven Tamil lines with romanisation under each, the current line embossed in
  gold, the others fading. Control bar = five circular brass buttons (shuffle · previous · play · next · repeat), a
  thin brass volume slider, a marigold `320kbps` chip. **Mini player** = a small lit brass-lamp card: artwork disc
  inside the glow, one line of title, a 2px gold progress rule, "mini" beneath.
- **Mobile.** The kolam fills the upper two thirds with artwork centred and the gold arc; tabs as one row under the
  status bar; lyrics open as a full-screen vertical leaf sheet with a drag handle; four large brass circles above the
  dock with the progress rule and timecode; the lamp card rides above the dock.
- **Reuses.** Nothing to fake: the traced arc is a real `stroke-dasharray` on the elapsed fraction, so progress,
  buffering and a skipped seek are all the same drawing. Artwork at the centre is the existing tile.
- **Cost / risk.** Highest legibility risk of the six — thin gold on maroon must pass contrast in *both* themes, and
  a radial pattern is a poor scrubber on touch, so seeking stays with the linear control row and the arc is display
  only (stated in the component, not left to chance). Culturally specific ornament must read as craft, not costume:
  one motif, one script family, no temple-photo clipart.

## 18 · Terminal

**Idea.** A shell you drive. The library is a directory listing, the lyrics are a paged file, the player is a status
line that doubles as the scrubber.

- **Tabs.** Three terminal tabs — `~/albums`, `~/artists`, `~/playlists` — with the active one underlined and a close
  `×` on the inactive; `⌘K` opens a fourth buffer, `~/search`, whose results are already faceted `Albums · Artists ·
  Playlists · Songs`.
- **Desktop.** Listing rows as `drwxr-xr-x  kaatu-ethiroli  2024  12 tracks` with the selected row reversed out, a
  cursor line `albums $ _`. Right: `less lyrics/kaatu-ethiroli.lrc` with a timestamp column, Tamil lines, the current
  line in a green block with an inline `; now` comment, and `-- PAGE 1/7 --` at its foot. Bottom status line =
  CONTROL BAR: `1:24 / 3:45`, an ASCII scrubber `[#####-----]`, the key hints `⎵ play  ← → seek  s shuffle
  r repeat`, `VOL ██████░░░░`, `320kbps`, and a dim block-character waveform under it. **Mini player** = a 48px status
  card in the tab row: `playing: kaatu_ethiroli.flac  [#####-----] 38%` with a play glyph, tagged "mini".
- **Mobile.** Scrollable tab row under the status bar; listing rows as large touch targets with title, year and track
  count; lyrics as a full-screen `less` view with the `PAGE 1/7` line and a `q back` hint; the status line fixed above
  the dock with a fat ASCII scrubber and four key-hint tap targets; mini status line above it.
- **Reuses.** Monospace means no custom face to ship; the key hints are the same bindings the player already exposes
  through `lib/player/commands.js`, and the track counts come from the payloads in hand.
- **Cost / risk.** A text UI is the cheapest to build and the easiest to make feel like a joke, so it lives or dies on
  real behaviour: every key hint shown must actually work, the scrubber must be draggable *and* steppable, and the
  `less` pager needs a visible scroll affordance for touch. This render also drew its own annotation words
  (`MINI PLAYER`, `LYRICS PANEL`, `CONTROL BAR`) in the right margin — useful as a labelled spec, removed before
  build.

## Reading the renders honestly

Boards 13, 17 and 18 are clean enough to work from as-is. 14 and 15 have small garbles that must be re-rendered
before they count as a spec — 14 repeats plate numbers 18 and 24 and prints `1:24 / S45`; 15 leaked the string `2px`
into both mini cards and duplicated one station name. 16 is legible but its pixel face needs a Tamil test. I will
re-render whichever is picked at full size with day mode as a second board, and only then write a line of CSS.

---

# Fourth six (19–24) — Audiopile's vocabulary, not its marketing

Audiopile (Brian Fogg) is a **studio file tool**, not a listening app: record offline, upload any format or size,
keep the original, auto-transcode a small mp3 **"audio thumbnail"** beside it, stream that 320k mp3 on a phone
"without wrecking your data plan", share inside small groups, push the group when there is new audio. So these six
boards are file-first: filenames, byte counts, encode lists, transfer states, budgets — and album art is reduced
to a thumbnail or dropped. Where a real product feature has no backend here, the board says so instead of faking it.

## 19 · The Pile

**Idea.** The library is a pile of files, newest on top, each a row with a waveform thumbnail, a filename, a
duration and a format tag — a shared studio folder, not a shopfront.

- **Tabs.** `Albums 12 · Artists 34 · Playlists 9` as a plain bar with counts; the count is what the facet returned,
  so an empty facet is visible as `0` rather than hidden.
- **Desktop.** Utility row `sort: newest ▾ · show: 320k only · drop files · search`; eight file cards (waveform
  thumb 96px, `kaatu_ethiroli_master_v3.wav`, a dim line with artist · album · year, duration, size, format chip,
  play); the playing card has an amber outline and a `playing` pin. Bottom MAIN PLAYER row: waveform scrubber with
  the played part amber, timecode, control bar, and a `320k → 48.2 MB` chip that states what is streaming *and* what
  it costs. Right: `notes · lyrics` with an amber bar on the active line and a footer `auto-scroll · jump to line`.
  MINI PLAYER: a 44px file-tab card with a 20px waveform.
- **Mobile.** Same rows one column; tabs scroll horizontally; lyrics open as a list; fixed two-row player block above
  the dock with the scrubber, four buttons and the timecode.
- **Reuses.** `QUALITY_LABELS` + `chooseBestQuality` (`app/music/page.js:17-33`) *are* the format chips; row
  restore uses `restoreScroll`/`saveScroll` (`lib/clientCache.js`).
- **Cost / risk.** Waveform thumbnails need peaks — see the shared note below. `drop files` must not be drawn unless
  ingest exists: `/music` already has a real admin panel (`Add Song`, `Edit`, `Delete`, `Sync`, `Replace`) that this
  row can link to, and nothing more.

## 20 · Takes & Versions

**Idea.** The most Audiopile thing here: a song is not a file, it is a **stack of encodes**. Every group lists its
takes and its quality versions and pins which one is streaming now, so choosing 320k vs 160k vs data-saver is a
first-class action instead of a hidden setting.

- **Tabs.** `Albums · Artists · Playlists` as a header row with the active one underlined in red.
- **Desktop.** Song boxes with a handwritten tape-box label (`kaatu ethiroli · v3 approved`) and rows
  `take 07 · 320k mp3 · 3:45 · streaming now` (red pin), `master wav · 48.2 MB · available`, `160k mp3 · mobile`,
  `96k mp3 · data saver`, each with a waveform strip and a play button. Clipboard **`lyrics · take 07`** with the
  current line under a red marker swipe and a footer that honestly reads `comments off · private`. Bottom: a
  reel-to-reel player whose **tape fill is the progress**, plus a `320k ▾` switcher whose dropdown repeats the
  encodes. MINI PLAYER: a tape-box end label, 52px.
- **Mobile.** Tab row; boxes with two rows visible and a `3 more encodes` disclosure; the clipboard as a sheet; the
  reel player as a fixed block with the switcher; the label mini above the dock.
- **Reuses.** The music sources already arrive as `streamUrls` keyed by bitrate, so the switcher is a re-presentation
  of data in hand, not a new endpoint.
- **Cost / risk.** Switching mid-play must not restart from 0: the engine needs to carry `currentTime` across the
  encode swap (seek-after-load), which is the one real engineering item. "master wav" is display-only here — there is
  no original-file storage in this app, so that row is *absent* in the build unless a file source is added.

## 21 · Group Feed

**Idea.** Audiopile's social half — a feed of what appeared, who added it, and what you can resume — but honest about
the single-tenant truth: the "group" is **you and your devices**, and the rows are real local facts.

- **Tabs.** `Albums · Artists · Playlists` inline with counts under the group selector.
- **Desktop.** Left column `groups`: `House · Band · Film class · Only me` — in the build these are **saved filters**,
  not people. Feed rows with avatar, bold + light line, a waveform thumb and a play button:
  `Anirudh added Nizhal Palai · 3 albums · 12 min ago` (source-reported), `imported Spotify playlist 'Retro Tamil' ·
  41 tracks`, `you favourited Kaatu Ethiroli`, `resume · Vaan Megam 1:24 of 3:45 · yesterday`, `sync: 320k ready, 2
  files 160k only`. Right: `lyrics` with `auto-scroll` and `font size`, and deliberately **no comment box**.
  Bottom: 64px player bar with waveform + controls + `320k`. MINI PLAYER: a 44px notification-style card.
- **Mobile.** Group pills, tabs with counts, feed rows, lyrics bottom sheet with the controls nested inside the
  sheet's footer (the sheet, not the row, owns them), notification mini above the dock.
- **Reuses.** Every row is derivable today: `jash_music_recents`, `jash_music_favorites`, the Spotify import lists,
  and the resume record. Notifications would be the existing PWA (`public/sw.js`) — no new service.
- **Cost / risk.** A feed is a *new* read model over localStorage: it must be built from writes that already happen
  (favourite, play, import) with bounded size (say 200 rows), or it becomes a lie about history. The offline fallback
  page must be updated too, or the feed is the first thing that breaks when the server sleeps.

## 22 · The Tray

**Idea.** Streaming is a transfer, so show it as one: a tray of in-flight items with byte counts, buffered ranges,
retry counters and a `pause all`, and a player built like rack gear.

- **Tabs.** `Albums · Artists · Playlists` under the tray, with `quality: 320k · 160k · any` on the right.
- **Desktop.** Tray tiles: `vaan_megam_320k.mp3 · 7.4 / 9.1 MB` with a segmented bar and the status word
  `streaming / buffering / ready / retry 2/4`, plus `4 in transit` and `pause all`. Table of eleven rows with an
  inline 1px progress line under the playing title. Lyrics overlay headed `lyrics · buffered 0:00-2:40` where lines
  beyond the buffered range are dimmed with `— not buffered yet` and a footer `jump inside buffered range only` — the
  honest part: it refuses to promise a seek it cannot make. Rack-unit player: waveform with orange played region,
  round buttons, a volume knob, and two tiles `buffer 41s` and `320k`.
- **Mobile.** Tray becomes a horizontal scroll of the same tiles; rows show a `Buffering` line; the lyrics sheet keeps
  the dimmed unbuffered lines; the rack unit is a fixed two-row block.
- **Reuses.** This design is a skin on machinery that exists: `lib/player/recovery.js` has `RUNGS`, `DEFAULT_LADDER`,
  `LADDER_MAX_MS = 12_000` and `nextRecoveryAction`, which is exactly what `retry 2/4` reads; the buffered ranges come
  from `video.buffered`.
- **Cost / risk.** Byte counts need `content-length`, and HLS has none — so for segmented streams the tile must say
  `segments 12/38` instead of pretending to know megabytes. Decide per source, in code, not in the mock.

## 23 · Audio Thumbnails

**Idea.** Audiopile's "audio thumbnail" taken literally: the **only** graphic in the interface is a waveform. Tiles,
player, lyric pins — no cover art at all.

- **Tabs.** `Albums · Artists · Playlists` as a plain cyan-labelled row; a right readout `waveforms rendered 128 /
  cached` shows the cost of the concept up front.
- **Desktop.** A 4×3 grid of waveform tiles with a filename, duration and `320k`; the playing tile is cyan with a
  playhead; two tiles are dimmed with `rendering` — the state that makes this honest. Below: one giant 200px waveform
  with the played part cyan, section brackets (`chorus 1 · verse 2 · chorus 2`) and **cyan pins where each lyric line
  begins**; control row with `zoom` and `fit`. Right: the pin list — timestamp, Tamil line, romanised line, active row
  tinted, hairline leader to its pin on the waveform. MINI PLAYER: a 40px waveform strip with a moving playhead.
- **Mobile.** Two-column tile wall, tabs, a 90px pinned waveform strip above the controls, lyrics as a list of pins,
  four buttons, mini strip above the dock.
- **Reuses.** The pin list *is* `parseSyncedLyrics` output rendered twice; brackets come from LRC section markers when
  present, and are simply omitted when not.
- **Cost / risk.** Highest dependency on peaks (below) and the only board where the app loses its artwork entirely —
  which for a Tamil-film-music library is a real loss, not a style choice. This render also inverted the themes: the
  desktop panel came out day-mode and the phone night, so the pair must be redrawn before it is a spec.

## 24 · Data Budget

**Idea.** "Stream without wrecking your data plan" as the whole interface: a budget gauge, per-minute cost for every
quality, a saver switch, and a size column on every row, so quality is chosen per stream with its price visible.

- **Tabs.** `Albums · Artists · Playlists` above the table; sizes are per row, so the tab content stays comparable.
- **Desktop.** 260px column: a segmented ring `312 MB / 1.5 GB today`, three rows `320k · 2.4 MB/min`, `160k · 1.2
  MB/min`, `96k · 0.7 MB/min` each with a meter and a select dot, `saver on when cellular`, `next 12 tracks ≈ 44 MB`
  and `cache now`. Table: title, artist, duration, `8.9 MB`, `320k ready / 160k cached / not cached`, play, and a
  hover caption `will cost 8.9 MB`. Player band: segmented meter with the buffered part outlined and the played part
  filled, controls, and a `320k ▾` dropdown that repeats each encode's per-minute cost. Lyrics card footer: `text
  only · 0.02 MB`. MINI PLAYER: a 48px meter badge.
- **Mobile.** Budget bar under the status bar, quality pills + saver switch, tabs, rows with size and cached state,
  lyrics sheet with the segmented meter as its own progress, buttons, mini badge.
- **Reuses.** Sizes come from a `HEAD` request per stream when the host answers `content-length`; `cache now` writes
  to the existing client cache (`lib/clientCache.js`, TTL `15 * 60 * 1000`) — not to MongoDB, per the standing rule.
- **Cost / risk.** Where a host gives no `content-length`, the row must read `size unknown` and `cache` must be
  disabled for it, or the gauge becomes theatre. The daily counter lives in `localStorage` and resets on a date
  boundary; it estimates, and must say "est." in the UI.

## Shared: what every 19–24 board needs that the app does not have yet

**Waveform peaks.** Five of these six draw waveforms. Nothing in this app computes them, and generating them per
request in the browser is exactly the per-request-parse cost that is banned. The buildable shape: peaks generated
**server-side once per track id**, cached alongside the existing 30-minute playlist cache, delivered as a small
numbers array (or an SVG path), and every board degrades to a plain progress rail when a track has no peaks yet.
That is a real, bounded piece of work — say the word and I write it as a prerequisite task before whichever board you
pick, so the pick never ships with empty boxes.

---

# Fifth six (25–30) — pure aesthetic, with the cost of the aesthetic written down

Boards: `25-aurora.png` … `30-nightwindow.png`. Each shows `Albums · Artists · Playlists`, the main player, the
mini player, the lyrics panel and the control bar in **both** sizes, and a **day-mode pair** of the same layout
rather than a corner strip — for mood designs the light theme is the hard part, not the dark one.

The shared bill for this whole set, before the per-idea notes:

- **Blur is not free.** `backdrop-filter` on 25 and 30 is the classic way a beautiful mockup stutters on a phone and
  on a TV box. Rule for the build: at most **two** blurred surfaces on screen at once, `will-change` never left on,
  and a flat `rgba()` fallback behind `@supports not (backdrop-filter: blur(1px))`, chosen by a real device test at
  390 px, not by assumption.
- **Texture is a file, not a loop.** Grain, halftone and VHS lines ship as one small tiled PNG or a
  `radial-gradient`/`repeating-linear-gradient` — never a per-frame canvas, and the strength control must be
  persisted (`localStorage`, like the volume key) so it is a real preference and not decoration.
- **A Tamil display face or nothing.** 27 and 29 set the lyric line as the main visual, so the face has to carry
  Tamil glyph clusters at 64 px: a Latin display face plus a separate Tamil face, `font-display: swap`, and a check
  that the vowel signs (`ா ி ெ ்`) do not clip the line box. Every one of these boards renders the real line
  "காற்று எதிரொலி ஒலிக்கிறது" so that is visible in the mock, not discovered later.
- **Reduced motion kills the effect, so the effect must be optional.** All six keep their composition intact with
  animation off; that is a design requirement here, not an accessibility afterthought.

## 25 · Aurora Mesh

A drifting teal-violet-coral mesh under film grain, everything floating on frosted glass, no hard corners.

- **Layout.** Rail 72 px, content well clear. Pill tabs `Albums · Artists · Playlists`; a glass player card (artwork
  with a glow halo, album, track, artist, `320k`, progress + `1:24 / 3:45`); a second glass panel for the lyrics with
  the current line bright and coral-underlined and `auto-scroll` / `blur` controls; a full-width glass control strip of
  six round buttons; a frosted capsule mini player, 32 px artwork dot, hairline progress.
- **Mobile.** Mesh full-bleed, one rounded glass card for the player, the lyrics as a full-height frosted sheet, four
  glass circles above the dock, capsule mini above that. Day mode is pale dawn on warm white with white panels.
- **What the mesh reacts to.** Honest option: hue shifts on the existing play/pause and track-change states, which
  the player already knows. Reading the actual audio (analyser-driven hue) is possible but it costs a second
  animation loop for a *background*, so it is off by default and only enabled when the tab is visible and
  `prefers-reduced-motion` is absent.

## 26 · Mallsoft

Vaporwave without the meme: pastel sunset, chrome perspective grid, a marble bust where the artwork goes, bevelled
chrome windows, a `VHS` toggle.

- **Layout.** Three bevelled chrome tab buttons with the active one pressed in; a framed player panel (artwork tile,
  spaced-caps album title, track, artist, `320 k bps` badge, a progress bar drawn as a sun arc); the lyrics as a
  chrome **window** with a title bar, minimise/maximise/close boxes and an `auto scroll` footer bar; a row of chunky
  chrome transport buttons, a chrome volume slider and the `V H S` toggle; a floating chrome strip mini player whose
  title bar reads "mini".
- **Mobile.** The same window stack scaled to one column, with a day-mode pair rendered in pale peach and mint.
- **Cost / risk.** The window chrome is genuinely interactive-looking, so the fake window buttons must be **real**
  (close hides the panel, minimise collapses it to the mini strip) or they must not be drawn — a decorative control
  is the one thing this set cannot ship. The bust/gradient artwork also has to survive day mode, where pastel-on-pastel
  text contrast is the failure mode.

## 27 · Risograph

Two spot inks only — fluorescent orange and cobalt — with misregistration, halftone dots and heavy condensed caps.

- **Layout.** Printed rectangle tabs with a 3 px cobalt outline, Albums filled orange; a poster player block where
  the **album name is the image** (halftone square, huge condensed "NIZHAL PALAI", the Tamil line under it, artist,
  an orange `320K` badge, tick-mark progress); a printed lyric column with the current line reversed white-on-orange
  and an `AUTO-SCROLL` checkbox; a strip of five square printed buttons plus a bar volume; a printed mini card with a
  single tick-mark line.
- **Mobile.** Poster stacked: tabs, halftone artwork, huge title, tick progress, printed buttons above the dock. The
  day-mode pair is the same inks on bright paper.
- **Cost / risk.** Two-colour printing means the *selected* state can only use fill, outline or reversal, so the
  focus ring has to be unmistakable for keyboard and TV use — reversal (white-on-orange) is the affordance, and it
  must be tested for the `:focus-visible` case, not just the mouse. Halftone tiles also inflate page weight; keep one
  8 KB texture, reused.

## 28 · Pressed Botanical

A herbarium: olive and dusty wine on warm dark paper, thin gold rules, a dried fern laid across the artwork, the
lyrics written like field notes.

- **Layout.** Serif tabs divided by gold hairlines, Albums gold-underlined; the player as a mounted specimen card
  (artwork under a thin gold frame, album, track, artist in italic, a small `320k` plate, a hairline progress with a
  gold dot); the lyric panel as a journal page with dimmed lines, the current line in ink with a gold underline and a
  pressed flower at its right, `auto-scroll on` in handwriting at the foot; a row of five thin gold-outline round
  buttons, a fine volume line, a `320k` plate; a small specimen-card mini.
- **Mobile.** Specimen card with the fern, tabs above, lyrics as a full-page journal sheet, four outline circles above
  the dock, specimen mini floating. Day mode is cream paper with ink and the same gold.
- **Cost / risk.** Gold hairlines at 1 px disappear on a phone at 2× dpr and on a cheap TV panel: rules must be
  `1px` drawn as `0.0625rem`-equivalent with a slightly stronger colour, and measured on a real 390 px screenshot.
  Serif + Tamil is the pairing to test early — the Tamil face has no serif variant, so mixed lines need an explicit
  per-script font stack.

## 29 · Kinetic Type

No images at all. The lyric line being sung is the artwork; the song title is a wall of outlined letters behind it.

- **Layout.** Tabs as three words with the active one lime; the current line set enormous in white, next line at half
  size in grey, previous small and dimmed above; a faint repeated "KAATU EHIROLI" outline wall; a metadata block
  `Nizhal Palai — Anirudh Ravichander · 320k`; the control bar as one line of words and thin glyphs (`shuffle prev
  play next repeat vol 1:24 / 3:45`) over a 2 px lime rule that *is* the progress; the mini player as one line of
  text with a lime dot.
- **Mobile.** Same hierarchy scaled — one huge line, the tabs row, four lime glyphs, the lime rule, a one-line mini.
  Day mode is black ink on off-white with a deep lime accent.
- **Cost / risk.** This is the cheapest board to render and the most exposed to real data: a long Tamil line at
  96 px must not overflow a 320 px screen, so the type needs a clamp plus a wrap/scroll fallback, and a song with a
  single short line should not look broken next to one with a twenty-word line. No images also means no artwork for
  the OS media session — which still needs a real `artwork` entry, so it is the one idea that has to keep an
  off-screen artwork path for the notification.

## 30 · Night Window

Rain on glass, city bokeh, a desk lamp, VHS tracking: the lo-fi study-window mood, applied to a whole music section.

- **Layout.** Translucent tabs, Albums lit amber; a lamp-lit player panel (artwork with an amber bloom, album,
  track, artist, `320k` chip, a progress bar with a glowing head, `1:24 / 3:45`); the lyric panel as a **fogged glass
  sheet** where the current line is the one wiped clear and the rest are unreadable behind condensation, with
  `auto-scroll · wipe to read`; a rounded translucent control strip of six soft buttons and a `tracking` slider that
  sets grain strength; a 44 px glowing mini card.
- **Mobile.** Window as the background, tabs row, lamp-lit card, the fogged sheet full-screen with a drag handle,
  four soft buttons above the dock, glowing mini; the day-mode pair is the same window in daylight with pale glass.
- **Cost / risk.** Two honesty items. The `wipe to read` metaphor needs a real interaction (pointer position clears
  the condensation locally) or the dimming must simply be opacity — a caption that promises wiping and does not
  provide it is a decorative control. And the "rain · 24 min loop" caption implies an **ambience audio track**, which
  the data layer has no way to fetch: it is dropped from the build unless a real looped ambience file is added, while
  the `tracking` slider stays, because it does something.

---

# Sixth set (31–36) — the aurora family, requested after 25 was chosen as the reference

Same contract as before: rail of seven on desktop, dock of the same seven on phones, `Albums · Artists · Playlists`
tabs, and the four surfaces — now-playing panel, lyrics panel, transport strip, mini player — in **both** sizes, with
a **day/night pair** rather than a corner swatch. All six are drawn so the light theme is a first-class rendering,
because that is where aurora-style UIs fail: pale text on pale glass.

What the whole family costs, once, in one place:

- **Two blur surfaces maximum.** Every one of these wants `backdrop-filter` on 4–6 panels. The build caps it: the
  now-playing panel and the lyrics panel get real frosted glass; the tabs, transport strip and mini use a flat
  `rgba()` + 1px border. Fallback behind `@supports not (backdrop-filter: blur(1px))` is the *same layout*, not a
  stripped one, and it is verified by forcing the flag off in the browser pass, not by reading the CSS.
- **The gradient is data, not a JPEG.** Mesh/curtain fields ship as a small number of layered
  `radial-gradient`s or one ≤40 KB static texture, sized to the viewport with `background-size: cover`; a full-screen
  animated mesh on a phone must throttle to `prefers-reduced-motion: reduce` → a still frame, and to a lower fps when
  `document.hidden`.
- **Contrast is the design decision.** 33 and 34 as drawn put `#9-ish grey` text on near-white silk and water —
  that fails at 4.5:1 for the *dimmed* lyric lines. Rule for the build: dimmed lyric lines are the **only** text
  allowed below body-ink weight, they must still clear 4.5:1 in both themes, and the active line must clear 7:1. This
  gets measured in the browser pass with the computed colour of the actual rendered node, the same way the anime
  sheet's day-mode audit was run.
- **Tamil at display size.** 29-style huge type and 34's serif both need the Tamil face explicitly in the stack,
  `line-height` measured with vowel signs present, and a clamp so a 40-character line fits a 320 px screen.

## 31 · Light Curtains — `31-curtains.png`

Vertical borealis curtains behind stacked frosted panels; the *active lyric line has a column of light rising behind
it*, so the lyric position is readable even without the highlight bar. Tabs as glass pills; now-playing panel with a
glow-haloed 320 px artwork, `320k`, `1:24 / 3:45`; transport strip of five round buttons **plus a real volume
slider**; capsule mini with a 32 px dot. Phone: same stack, drag-handle lyrics sheet, four large circles, volume
still present, dock of seven. Day pair is pale dawn curtains on warm white.

- **Cost.** The per-line light column is one absolutely-positioned gradient per line, which is fine at seven visible
  lines and must not be rendered for a 400-line lyric file — virtualise the list, keep the effect for the visible
  window only.
- **Defect in the render:** the word "dim" was printed beside each inactive line (my prompt's word, leaked). Reads as
  a spec note; removed before build.

## 32 · Refract — `32-refract.png`

Thick refractive glass sheets that overlap like a stack of cards; the front sheet is what you interact with, the
others stay legible-but-blurred behind it, and a hairline ruler along the stack's bottom edge shows which sheet is
front. Sheets: now-playing, lyrics, `Albums 12`, `Playlists 9` — so the tabs and the panel stack are **the same
control**, which is the interesting idea here: `⌘1/2/3` or arrow-key depth changes the front sheet, and the quality
picker can be another sheet in the same stack.

- **Cost.** Real: per-sheet `filter: blur()` on a *moving* stack is the most expensive thing in this set. Build rule:
  blur is applied once on sheet-change (a short transition, then static), never per frame while scrolling lyrics.
- **Bonus already rendered well:** the blurred neighbour lines under a sharp current line — that is the honest way to
  show "context, not focus".

## 33 · Silk & Sheen — `33-silk.png`

Liquid satin, champagne/rose/mint, panels with satin edges. The signature move: **the progress bar is a fold in the
fabric** with a bead sitting in the crease, and dragging along the fold scrubs.

- **Cost / risk.** The fold is a decorative-looking control unless drag actually seeks; it needs a keyboard path
  (arrows ±5 s, `Home`/`End`) and an `aria-valuetext`, exactly like the tonearm in 02. Contrast is the second real
  risk — as drawn, faint grey on silk, so the light theme needs the ink weight raised.

## 34 · Ink in Water — `34-inkwater.png`

The quietest of the family: pale water field, indigo ink diffusing behind the line being sung, everything else washed
to grey, `tap a line to jump` as the only hint. Artwork is replaced by the ink blot itself — a genuine option for a
music hub that currently borrows cover art everywhere.

- **Cost / risk.** Contrast, as noted: this one cannot ship with washed grey lyric lines. And `tap a line to jump`
  means tap-to-seek on lyric rows, which needs the LRC timestamps the parser already produces, plus a guard for
  unsynchronised lyrics — when there are no timestamps, the rows must not look tappable.
- The ink diffusion is a pre-rendered PNG with a slow `transform`, not a fluid sim.

## 35 · Glass Terrazzo — `35-terrazzo.png`

Pastel chips under a glossy sheet, slabs of frosted glass floating above; the queue peeks out from behind the lyrics
slab, and the mini capsule carries `320k / 160k / 96k` chips, so **the quality ladder is visible in the mini player**
— the one board in this set that puts the app's real bitrate data in the smallest surface.

- **Cost / risk.** Terrazzo is a pattern file; keep one ≤30 KB tile and let it repeat, never a full-page image per
  breakpoint. The render leaked `72px` / `300px` annotations and drew the inactive lyric lines as empty skeleton bars,
  so the lyric typography of this one is unproven — re-render before treating it as a spec.

## 36 · Frosted Dawn — `36-dawn.png`

The family inverted: light theme as the *primary* design (dawn peach/powder-blue, white frosted panels, graphite ink,
peach fill on the progress and behind the active lyric line), with a `night` pill inside the lyrics header and a dark
indigo variant as the pair. Highest readability of the six and the least likely to fail the contrast audit.

- **Cost / risk.** Lowest of the set: fewer effects, and the theme tokens flip the usual way (`--mu-*` block plus a
  day override), matching how `--an-*` already behaves in the anime sheet. Its `night` toggle also has to respect
  the existing `jash_theme_mode` key rather than inventing a second one — same rule the anime block follows.

## If this is the direction

36 or 32 are the two I would put in front of a build: 36 because it survives both themes by construction, 32 because
its "sheets are the tabs" idea removes a whole class of duplicated navigation. 25 stays as the reference the rest
were measured against. Pick one and I do it in this order: `--mu-*` tokens (both themes, measured) → tabs or sheet
stack → lyrics panel → transport strip with volume → now-playing panel → mini capsule, with the blur cap and the
contrast floor written as tests, then the browser pass at 1440 / 1920 / 390 / 360 including `backdrop-filter`
disabled and `prefers-reduced-motion`.
