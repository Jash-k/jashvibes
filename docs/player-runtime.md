# Player runtime readout

The transport row shows how far into the film you are and how long it runs:
`12:34 / 1:45:00`. It sits after the seek buttons (next to Play on phones) and
before the volume group — the slot the readout occupied before it was dropped
for width. The scrub tooltip still gives the precise hover time.

## Rules
- Total runtime is the media element's own `duration`, never the seek window:
  a host that exposes only part of a file as seekable has a window shorter than
  the film, and the readout must not disagree with the film's length.
- Elapsed is measured from the seek window's start, so a DVR-style source that
  begins mid-stream and a plain VOD file both count from `0:00`. Scrubbing
  updates the number live because it reads the same `shownTime` as the bar.
- **Live, unknown and implausible lengths show nothing.** `Infinity` (live HLS
  or DVR), `NaN`, `0`, negatives and a value ≥ 24 h all normalise to "no
  runtime", and the row renders no readout rather than `LIVE / ~`-style filler.
  `RUNTIME_MAX_SECONDS` only rejects an obvious placeholder; it is not a limit
  on content length.
- Phones get the elapsed number alone; the full `current / total` pair appears
  from the `sm` breakpoint up. Screen readers always hear
  "Playback time 12:34 of 1:45:00" regardless of breakpoint.
- The readout travels with the transport: while the element is buffering or the
  source has no seek support, the row hides its seek controls and the readout
  with them, and it returns at the same moment they do.

No new controls, prefs or storage: the readout is display-only and adds no
interaction, and it never touches playback, seeking, sources or resume state.

## Where
- `lib/player/labels.js` — `runtimeTotal()` and `playbackTimeLabel()` (pure,
  shared, testable; `fmtTime` unchanged).
- `components/player/JashPlayer.js` — reads `duration` from the playback engine
  and renders the readout in the deck row and in the compact preview row.

## Verification
`node scripts/test-player-runtime.cjs` covers suppression for live/unknown
lengths, window-relative elapsed time, clock formatting at and past an hour, the
phone/desktop forms and the JashPlayer wiring. Production build and
`npm run check` pass. Playback behaviour itself is unchanged, so an on-device
visual pass (phone width and fullscreen) is the remaining check.
