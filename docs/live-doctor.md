# Live diagnostics — `npm run live:doctor`

Answers the one question that matters when a channel will not open: *is the
source broken, or is it the app?* It is read-only — no database, no writes.

```bash
npm run live:doctor -- <m3u-url-or-file> [--sample 6] [--json]
```

It runs the app's **own** parser, stream classifier and header builder, so what
it reports is exactly what the player would do, then it probes a sample live
with the same headers the player sends.

What it tells you:

- how old the published feed is (`#GENERATED:`) and whether the **CDN tokens
  inside it have expired** — an expired-token feed means every channel answers
  401/403 and *no* amount of re-syncing helps;
- the format split (HLS / DASH / raw TS) and which rows are unplayable everywhere;
- which rows need a specific **User-Agent / Referer / Cookie** (a plain browser
  or VLC cannot send them — the server proxy carries them);
- which rows are **ClearKey-encrypted** (fine on Chrome/Edge/Firefox, impossible
  on Safari/iOS by design).

Exit code `0` = healthy, `1` = an actionable problem (stale feed, expired
tokens, nothing reachable), `2` = bad invocation — so it can gate a cron.

Health bar for the Jash Live feed: a stamp under ~40 minutes old and **0
expired tokens**. If that is green and a channel still fails, work down the
Admin → TV Service checklist the tool prints.
