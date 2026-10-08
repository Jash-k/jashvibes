# Live startup and selected-logo follow-up

Apply AFTER `jashvibes-live-custom-compatibility.patch` (do not reverse it).

## Fixes
- Live channel tiles no longer depend on an imperative one-shot reveal class.
  React updating selected className could wipe `.is-in`, hiding an already
  revealed logo that the observer was no longer watching.
- Custom Live startup is distinct from a mid-play stall. Requesting play,
  receiving canplay, or completing a manifest load does not by itself mark
  startup healthy. Wait for playing; retain startup deadline until then.
- Failed startup skips retryStreaming/reanchor, which cannot repair a rejected
  manifest with no streaming engine. That no-op formerly marked ready/black.
- Keep recovery budgets until healthy playback; cancel delayed recovery when
  playback resumes. Preserve visible error on terminal failure.
- One awaited Shaka destroy owns unload/detach. Overlapping cleanup operations
  could hang recovery; custom cleanup has a4-second limit with an explicit
  page-reload error if it cannot complete safely.
- Custom buffering goal20→10 seconds, rebuffer goal3→2. This reduces buffering
  targets; no measured guarantee of Star Sports startup time is claimed.
- StrictMode setup/cleanup works when effects are replayed during development.

Jio token/proxy policy and its existing buffer settings are unchanged. Shared
engine cleanup/cancellation fixes also apply to other video playback. No keys,
licence values, database changes or catalogue remapping are included.

## Verification
-9-second delayed manifest and initialization fixtures, phone390/desktop1440:
  startup without false stall, selected-logo opacity remains1, failed source
  reaches visible error. Development and production tests passed (production
  delayed initialization case plus normal DASH playback).
-57 Live policy checks,16 existing content checks,229 source checks, build passed.
- Fixtures use self-created unencrypted DASH and intercepted relay responses.
  Actual Star Sports1HD encrypted playback from the user's Render Singapore
  instance is NOT verified. This corrects reproduced engine/UI bugs, not
  upstream availability, regional restrictions or hosting bandwidth limits.

## Deploy
```
git apply --check jashvibes-live-startup-logo-fix.patch
git apply jashvibes-live-startup-logo-fix.patch
npm ci --include=dev && npm run build
```
Deploy then reload the page (hard refresh desktop; close/reopen tab on mobile).
No additional playlist resync required for this follow-up if already synced
for the preceding compatibility patch.

If Star Sports1HD still fails, send the displayed error/code and time of test.
A reachable deployed app plus authorized test access would be needed to
measure its actual Render-to-source startup path; do not send keys/cookies.
