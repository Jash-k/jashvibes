# The unified player (JashPlayer)

Every video surface in this app mounts the same component:

```txt
/live                       <JashPlayer playbackPolicy={createLiveTvPolicy(channel)} live />
/watch/[type]/[tmdbId]      <JashPlayer source={…} lineup={…} library={…} />
/stremio-watch/[t]/[id]     <JashPlayer source={…} lineup={…} nextEpisode={…} />
/classics/[id]              <JashPlayer playbackPolicy={createStreamPolicy(stream)} library={…} />
/sports/player              <JashPlayer source={…} live />
/player-lab                 fixtures for every state (dev tool, noindex)
```

Before this, each of those pages owned a copy of the same playback code — four
engines, six progress savers, three retry ideas, two subtitle loaders — and
they had already drifted (different buffering goals, different resume rules, a
resume toast on one page and none on another). This document is the contract
that replaced them.

**Non-goals, deliberately:** embed providers (VidLink/VidEasy/VidZee/VidRock/
Global Mirchi) stay plain iframes — the player inside them is remote and cannot
be styled or controlled. Music keeps its own audio engine (`/music`); it shares
`lib/player/labels` for time formatting only.

---

## 1. Layering

```txt
        page (owns: what to play, lineup, titles, its own data fetches)
          │  source · playbackPolicy · lineup · library · display · on
          ▼
      JashPlayer      chrome only: controls, menus, gestures, keyboard, overlays
          │  engine.handle
          ▼
   usePlaybackEngine  element, Shaka, buffering, recovery ladder, resume+persist,
          │            subtitles, quality/audio/caption selection, Media Session
          ▼
   lib/player/*       pure modules — no React, no DOM assumptions, all unit-tested
```

Rules that keep it honest:

- **The chrome never touches `video.currentSrc`, `HTMLMediaElement.error`, or a
  Shaka player object directly.** It asks the engine (`engine.retry()`,
  `engine.rotateFallback()`), and it reads engine state.
- **The page never builds a Shaka config.** Source-specific knowledge (Jio
  tokens, ClearKey pairs, manifest headers) is a *policy object* created by the
  page and consumed by the engine. That is the only extension point.
- **`lib/player/*` is pure.** If a bug can be described without a DOM, it gets a
  test in `tests/player-*.test.js` (72 assertions, run by `npm test`).

---

## 2. Files

| File | Owns |
| --- | --- |
| `lib/player/kind.js` | URL/format detection, engine choice, live-vs-DVR model from `seekable`, seek-window clamping |
| `lib/player/errors.js` | Shaka codes + `MediaError` + fetch failures → one `{code,label,kind,message,retriable,autoRetry,action,hint}` shape |
| `lib/player/recovery.js` | The rung ladder (`retry-streaming → reanchor → reload → drop-drm → rotate-source`), per-run budgets, 12 s ceiling |
| `lib/player/resume.js` | Resume plan (20 s floor, refuse the last 15 s, ≥95 % = finished) + throttled progress writer |
| `lib/player/subtitles.js` | SRT→VTT, cue shifting, object-URL track lifecycle, subtitle style → `::cue` CSS |
| `lib/player/prefs.js` | One `localStorage` key (`jash:player:v1`) for rate/quality/volume/brightness/captions/ambient, with legacy-key lift |
| `lib/player/labels.js` | `fmtTime`/`fmtClock`/`fmtSize`, source-label parsing, source-list building, codec warnings |
| `lib/player/commands.js` | The 37-command input table: keys, gestures, buttons, menus + the parity report |
| `lib/player/policy/liveTv.js` | Live TV: Jio token resolution, ClearKey, header/segment rewriting, Pocket proxy, streaming config |
| `lib/player/policy/stream.js` | VOD: DRM building (ClearKey/Widevine license fetch, DASH kid expansion), header filter, direct-file policy |
| `components/player/usePlaybackEngine.js` | The one engine: element ownership, attach/load, events, recovery, tracks, subtitles, resume |
| `components/player/JashPlayer.js` | All chrome: control bar, menus, overlays, gestures, keyboard, PiP/fullscreen/AirPlay/wake-lock |
| `components/player/PlayerMenus.js` · `PlayerOverlays.js` · `PlayerIcons.js` | Menu surfaces, transient overlays, the single icon path table |
| `components/player/usePlayerEnvironment.js` | Coarse pointer, landscape-phone, network info, online, fullscreen, PiP, AirPlay, wake-lock, vibrate |
| `components/player/usePlayerGestures.js` | Pointer math → tap/double-tap/hold/drag zones, with the scrub bubble and 2× hold |

---

## 3. Prop API

Everything except `source` is optional.

```jsx
<JashPlayer
  source={{
    url,                 // required
    kind,                // 'auto' | 'hls' | 'dash' | 'direct' | 'embed' — URL always wins
    streamType,          // legacy page flag, used only as a hint
    label,               // what the source menu shows for this entry
    mimeType,            // force Shaka's asset mimetype
    sizeBytes,           // shows in the sources menu ("2.9 GB")
    crossOrigin,         // 'anonymous' | 'use-credentials' — keep only if the CDN sends CORS headers
  }}
  playbackPolicy={…}     // full policy from lib/player/policy/* — wins over policy/drm/http
  policy={{ live, allowNativeHls, playerConfig, loadTimeoutMs, … }}  // small inline overrides
  drm={{ clearKeys }}    // shorthand for pages with nothing else to say
  http={{ referer, userAgent, headers }}   // request-header hints (Shaka only)

  lineup={{
    sources: [{ url, label, kind, quality, sizeBytes }],  // must carry url — rotate/menu depend on it
    activeIndex,
    onPickSource(index),
    nextEpisode: { label, title, image, onPlay },         // end-of-video auto-advance + pill
    prevItem, nextItem,                                    // ← → on live/series lists
  }}

  library={{ watchKey, entry, resume: true, persist: true }}  // entry must be null on the server
  display={{ title, subtitle, poster, aspect: 'video'|'fill'|'square'|'story', badges, mediaSession, audioOnly }}
  marks={{ a, b }}       // A-B loop segment, shown as a shaded range
  compact                // 1-row chrome for previews/embeds
  live  liveLabel="LIVE"
  gesturesEnabled  pipOnHide  autoPlay  allowNativeHls  audioOnly  className
  onPrev={() => …}  onNext={() => …}   // channel/episode steps used by gestures + keyboard

  on={{
    onStatus(status, message),   // idle|loading|ready|buffering|recovering|error|ended
    onError(info),               // mapped info, still recoverable (chrome shows its own card)
    onFatal(info),               // ladder exhausted — the page may offer its own fallback
    onEnded(),
    onReport(incident),          // "Report problem" pressed (queued in localStorage; see §6)
  }}
/>
```

`source`, `display`, `lineup`, `library` and `on` must be **new objects only when
their content changes** — pass inline literals only when the page already
rebuilds them (`useMemo` otherwise). The engine keys its load effect on
`url::kind::policyName::label::watchKey`, so a stable `source` means no reload
storm when unrelated page state updates.

---

## 4. Writing a policy

A policy is a plain object. Nothing else in the app knows about your source.

```js
export function createMyPolicy(channel, options = {}) {
  return {
    name: 'my-source',                       // part of the engine's load key
    live: true,                              // skip resume, prefer live edge
    needsMuxjs: true,                        // raw-TS demuxer for Shaka
    allowNativeHls: false,                   // force Shaka even on Safari (needed whenever headers matter)
    loadTimeoutMs: 30_000,
    playerConfig: { streaming: {…}, abr: {…} },
    async resolve({ force = false, prior = null } = {}) {
      return {
        url, kind, mimeType, live,
        drm: { clearKeys } | { servers: { 'com.widevine.alpha': licenseUrl } },
        hasDrm,
        http: { requestFilter, responseFilter },   // Shaka NetworkingEngine hooks
        meta: { … },                               // free-form; shown in the stats panel
      };
    },
    async recover({ error, attempt, source } = {}) {
      // one step per call; return null when out of ideas. `retry: 'reload'`
      // makes the engine reload immediately with whatever resolve() now says.
      return { message: 'Retrying through the proxy…', retry: 'reload' };
    },
    hasRecovery: () => Boolean,   // true = the chrome keeps the "retrying" notice alive
    describe: () => ({ … },      // stats-panel debug view
  };
}
```

Two constraints the engine relies on:

1. `resolve()` must throw a `Error` with `.kind = 'drm'` / `.action =
   'refresh-token'` for token problems — that is how the chrome renders "Paste a
   fresh token" instead of "Playback error". `mapPlaybackError` does the
   mapping; the policy only needs to be specific.
2. Never set `Referer`/`User-Agent`/`Cookie` from the browser: they are forbidden
   headers, so `createLiveTvPolicy` deliberately drops them and routes through
   `/api/live-jio` instead. The chrome therefore never promises header control.

---

## 5. PC / mobile / TV parity

`lib/player/commands.js` is the single source of truth for input: 37 commands,
each declaring `keys`, `gesture`, `button`, `menu` and `desktopOnly`.
`parityReport()` returns the commands that are keyboard-only without being
marked desktop-only — i.e. unreachable on a phone — and
`tests/player-commands.test.js` asserts it stays at **0 gaps**.

Every binding in the table below is exactly what `COMMANDS` declares:

| Command | Keys | Touch / mouse | Notes |
| --- | --- | --- | --- |
| `togglePlay` | `space` `k` | click · tap centre | |
| `seekBack` / `seekForward` | `j` `l` `←` `→` | double-tap left/right (stacks) | hold the key to repeat |
| `seekBack30` / `seekForward30` | `shift+←` `shift+→` | ±30 s buttons | |
| `frameBack` / `frameForward` | `,` `.` | — | `desktopOnly` (±1/30 s) |
| `jumpToPercent` | `0`–`9` | drag the scrub bar | `desktopOnly` |
| Volume / speed by wheel | wheel = volume, `shift+wheel` = speed | — | plain wheel is only taken in fullscreen or while the player holds focus, so a page still scrolls past an inline player |
| `nudgeVolumeUp` / `nudgeVolumeDown` | `↑` `↓` | vertical drag, right half | |
| `mute` | `m` | volume button | |
| `brightnessUp` / `brightnessDown` | `n` `b` | vertical drag, left half | CSS filter, never the system API |
| `speedUp` / `speedDown` / `speedReset` | `]` `[` `\` | long-press = 2× while held | menu has 0.25× steps |
| `toggleFullscreen` | `f` | button | `.jv-landscape-phone` flattens the corners |
| `togglePip` | `p` `o` | button (hidden if unsupported) | `pipOnHide` starts it when the tab hides |
| `cycleCaptions` | `t` `c` `s` | CC button | |
| `openSubtitles` | `shift+c` | `menu` gesture (right third, long) | sheet also loads a local `.srt`/`.vtt` |
| `subtitleDelayUp` / `Down` | `shift+↑` `shift+↓` | sliders in the sheet | only for imported tracks |
| `cycleAudioTrack` / `cycleQuality` / `qualityAuto` | `a` `q` `shift+q` | menus | quality menu also lists codec warnings |
| `toggleAmbient` | `y` | menu | dims the page via `.jv-theater` + a fixed scrim |
| `toggleStats` | `i` | menu → Stats | `desktopOnly` panel, reads `engine.stats` |
| `toggleControls` | `h` | tap anywhere | never auto-hides while paused |
| `lockControls` | `shift+l` | lock button | kids-proof: hides every control |
| `freezeFrame` | `shift+f` | ⋮ menu → Freeze frame | holds the last painted frame while the stream keeps buffering |
| `skipMarks` | `shift+x` | skip button (`tap-skip`) | driven by `marks` |
| `replaySegment` | `r` | −10 s button | |
| `loopSegment` | `shift+r` | menu | A–B loop between the two marks |
| `restart` | `home` | menu · resume toast | |
| `closeMenus` | `escape` | tap outside | closes context menu → menu → lock → fullscreen, in that order |
| `prevItem` / `nextItem` | `PageUp` `PageDown` | swipe down on the right/left edge | calls the page's `onPrev`/`onNext` |

Mobile-specific behaviour: bottom sheets instead of dropdowns, haptics on
long-press and on seek, `wakeLock` while playing, landscape-phone full-bleed
(CSS: `.jv-landscape-phone`), auto-PiP when the tab hides on live audio-ish
feeds, and controls that never auto-hide while paused. The bar carries the quality
label inside the burger, and the burger opens the sheet whose first section is the
rendition list — one tap from "which bitrate am I getting" on any device.

TV-specific: the root is a focusable `role="region"`, so remote keys reach the
same `commandForKey` path; `.jv-theater` blackens the page while ambient dim is
on; and a pointer-less device still gets every command that has a key binding.

---

## 6. Behaviour that used to differ per page

- **Progress persistence**: 5 s cadence, on pause, on fullscreen enter/exit, on
  `pagehide`, and immediately on `ended`. Writes go through
  `saveOrUpsertProgress()` in `lib/watchStore.js` — `saveWatchProgress` when the
  history row exists, `upsertHistoryEntry` when it does not — so Continue
  Watching finally gets a row for `/classics` and `/stremio-watch` too
  (previously only `/watch` wrote history).
- **Resume**: `planResume()` refuses to seek into the last 15 s and marks
  ≥ 95 % as finished (so a finished film leaves the row instead of resuming at
  1:59:40). Live sources never resume. The toast carries *Resume · From the
  start · Never for this title*; "never" is stored per `watchKey`
  (`jash:player:never-resume`, capped at 200) and only suppresses the
  seek/prompt — progress keeps saving. `clearResumeSuppression(watchKey)` in
  `lib/player/resume.js` is the inverse; the chrome deliberately has no button
  for it, so undoing it on a phone means one line in devtools.
- **Errors**: one mapped shape → one error card with the *specific* action
  (retry / next source / drop DRM / refresh token / copy URL / open externally).
  Pages no longer render their own duplicate error text over the player; they
  react to `onFatal` if they want to fall back to another provider.
- **Recovery**: the ladder runs *before* the error card appears. On a source
  with alternates, soft rungs are capped at 2 and the rest is spent rotating.
- **The seek window is the timeline, not the buffer** (`lib/player/kind.js`):
  `readSeekWindow` prefers a finite `duration` and only consults `el.seekable` for
  live-style manifests or when DVR has trimmed the head. Trusting `seekable` first
  was the actual cause of "seek restarts from 0" on single-file streams: for a plain
  MP4 it reports only what has been downloaded, so `clampToSeekWindow` rewrote
  "seek to 58:00" into "seek to 4 s" — no error, nothing to retry, and a scrubber
  that thought 4 s was the whole file.
- **Seeking a file that is not downloaded yet** (the direct MP4/MKV path, e.g.
  Telegram-hosted Stremio streams): a seek into a byte range that is not cached
  can take many seconds without `currentTime` moving, which is exactly what the
  stall watchdog used to read as a dead element. While `el.seeking` is true — or
  within `SEEK_GRACE_MS` of `seekTo` — the ladder is not started, and `RELOAD`
  carries the position across the `src` re-attach (`positionPreserved`) instead
  of restarting the file. A genuinely dead element still reaches the ladder, so
  this is a delay, not a disable.
- **Some hosts ignore `Accept-Ranges`, and that cannot be detected from the URL.** A Telegram or CDN
  file that restarts the download instead of serving a range looks identical to a broken stream: the
  seek lands at 0, the file plays, and the ladder reloads it — which is the complaint itself, "some
  streams seek, some restart from 0". `capabilitiesFor` takes no hint about range support, and a HEAD
  request per source is not free on a metered phone. So the engine *earns* the verdict: `seekVerifyRef`
  remembers what was **asked** (not what was clamped to), one retry, and a second consecutive miss on a
  non-live finite file sets `noRangeRef`. From then on `clampSeekTarget(…, { noRange: true })` keeps
  forward seeks inside the downloaded part (5 s of headroom, never behind `currentTime`), `seekRefused`
  is exposed so the scrubber says "scrub limited to downloaded", and `noRangeHoldRef` holds the ladder
  20 s — during which a stall is explained rather than "fixed" by a reload that restarts the file at 0.
  The verdict resets when a *new* source loads (`reason === 'initial'`), never on a reload of the same
  one, or the ladder and the seek would fight each other forever.
- **One entry point for the rest**: the bar is play, ±10, time, volume (desktop),
  the burger and fullscreen. The burger is labelled with the current quality and
  opens `SettingsMenu`, whose first section is the rendition list. Freeze frame, PiP,
  AirPlay, stats and the source/audio/subtitle pickers are in the same sheet, so
  nothing sits behind a `sm:` breakpoint: a control the phone cannot see is a control
  that does not exist.
- **Removed on request**: A–B loop, ambient dim and lock have no UI anywhere — bar
  *and* sheet. `loopSegment` / `toggleAmbient` / `lockControls` remain keyboard
  commands declared `desktopOnly`, which is what keeps the parity test from
  re-claiming a control that no longer ships.

## 6b. The settings sheet (`SettingsMenu`)

Quality (inline) · Aspect ratio (Auto / Fill / 16:9 / 4:3 / 2.39:1 / 9:16 / Stretch) · Speed (Slower / Normal / Faster + chips) · Audio (only when the file has more
than one track) · Subtitles (on/off, import, delay & style) · Source (only when there are
mirrors) · This video (freeze frame, restart from 0, PiP, AirPlay) · Interface (stats).

On desktop the panel anchors **inside** the player box (`bottom-28 right-2`), not above it: the
sheets are siblings of the control bar, so an outside-above anchor (`bottom-full`) placed them
outside a frame that is `overflow-hidden` — that is what "I clicked settings and nothing
happened" was. Both the panel and its backdrop carry `data-dvp="controls"`, so they are treated
as chrome by the pointer/gesture layer instead of as the video surface. The backdrop is `absolute`, not
`fixed`: a page-wide invisible blocker meant that if the panel was ever clipped or failed to render, the
site stayed unclickable with nothing on screen to click — and Escape only worked while the player still
had focus, which a click on the channel rail takes away. That pair is what "the shortcut menu opens and
freezes" was. Now the panel takes focus on mount (`tabIndex={-1}` + `focus()`) and `JashPlayer` listens
for Escape on the document while `menu`/`contextMenu` is set.

`aspect` in `jash:player:v1` is the *picture* inside the frame (`lib/player/aspect.js` → inline style on
the `<video>`), a different thing from the `aspect` **prop** a page passes to size the *box* (§3):
`/live`, `/watch`, `/classics`, `/sports/player` and `/stremio-watch` all hand the chrome `'fill'` to say
"this shell is 16:9", and forcing the picture to 4:3 letterboxes inside that shell instead of resizing it.
A stale stored value falls back to `auto` via `isAspectMode`, so a preference written by a future build can
never produce a zero-height frame.
- **Preferences** (`jash:player:v1`) are deliberately **global** — one speed,
  volume, quality cap and subtitle style for the whole app, not per host or per
  title. Per-source memory was planned and dropped: on a metered connection the
  cap you set is the cap you want everywhere, and a per-host map is a second
  thing to reset when it misbehaves.
- **Incidents**: the ⋮ menu's Report button appends a small record to
  `localStorage` (`jash:player-incidents`, last 50, key owned by
  `lib/player/prefs.js`) and calls `on.onReport`.
  `components/player/PlayerIncidents.js` renders that queue inside
  Live Service → Tools (reload / copy JSON / clear). Deliberately local-only: no
  collection and no route for debug noise on a 512 MB container.

---

## 7. Verifying changes

```bash
npm test              # 72 assertions over lib/player/* + the chrome wiring contract
npm run lint:player   # eslint over lib/player, components/player, the 6 surfaces, the lab, tests
npx next build        # /player-lab keeps the whole stack on the build graph
```

`tests/player-commands.test.js` asserts the parity table and the key bindings
that the chrome actually implements — if you add a command to `COMMANDS` without
wiring it in `JashPlayer.js`, that test fails on purpose.

Any URL can be mounted directly: `/player-lab?src=<url>&kind=hls&live=1`, plus
`&label=`, `&drm=keyIdHex:keyHex` and `&timeout=45000`. It is read from
`location.search` (not `useSearchParams`) so the route stays statically
prerendered — which also means you can paste a Telegram or Stremio link on your
phone and compare it with the same file on the TV without touching a fixture.

Manual pass (the parts no unit test can reach) — open `/player-lab` and check:
MP4 card (seek + PiP + resume), MKV card (clean refusal or playback), live card
(LIVE badge, no timeline), ClearKey card (error card offers "Play without DRM",
stats show `drm: dropped`), dead-host card (ladder notice, then Copy URL),
drag an `.srt` onto any card (delay/size become enabled), and the parity panel
showing 0 gaps.

---

## 8. What was removed

Six files, one dependency, four private engines:

| Deleted | What replaced it |
| --- | --- |
| `components/VideoPlayer.jsx` (hls.js gesture player, 46 KB) | the engine + `lib/player/kind.js` (native HLS on Safari, Shaka elsewhere) |
| `components/player/DirectWatchPlayer.js` (907 lines of chrome) | `components/player/*` chrome, with its bugs not carried over |
| `components/player/UniversalVideoPlayer.js` | `JashPlayer` itself |
| `lib/embedResolver.js` | embed providers stay iframes on the pages that use them |
| `components/CircularGallery.jsx`, `components/QuickNav.jsx` | dead code, no importer (verified by an import-graph grep) |
| `hls.js` dependency | Shaka + native playback; `mux.js` stays (Shaka's MPEG-TS demuxer needs it) |

Anything those files did that was *wrong* — the two-step `+1` ladder, four
different resume implementations, per-page error strings, a `play()`
watchdog that fought the browser's own autoplay rules — was deliberately not
migrated.

---

## 9. Deliberately not implemented

| Item | Why it stayed out |
| --- | --- |
| Chromecast SDK | Needs a `cast_sender.js` script from a Google CDN on every page view. On a personal deploy the TV is reached by opening the app *on* the TV (or an AirPlay/PiP path that already exists), so the cost is a third-party script for a use case you cover differently. |
| Custom HLS AES-128 decrypter | Shaka already decrypts standard `EXT-X-KEY`; the reason to hand-roll a loader was one legacy feed with a mislabelled key, which the `drop-drm`/`rotate-source` rungs now handle. |
| HEVC/DTS fallback via MSE transcode | There is no transcoder in this stack — a phone that cannot decode HEVC needs a different source, which is what the sources menu + codec warning badge say instead of pretending. |
| Background audio for VOD | Browsers only allow it with PiP or Media Session on an audio element; `/music` has that. For video, PiP (`pipOnHide`) is the legal equivalent. |
| Offline download / MediaSession-based queue | Needs a service-worker cache with eviction rules and a DB table; the free tier's disk and request budget is spent on the catalogues. |
| Per-host quality/subtitle memory | See §6 — global prefs are the shipped behaviour. |
| Casting the *player* UI into an iframe host | The README's smart-TV wrapper keeps using the app's own fullscreen; the chrome's fullscreen request targets the wrapper element, which is what makes that work. |
