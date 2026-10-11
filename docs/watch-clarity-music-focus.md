# Watch clarity + lyrics-first focus

Base: `f65451b831187b0a363b6e3b5dfdc53befbe6fb5` (`lyrics delay`), freshly fetched from https://github.com/Jash-k/jashvibes.
Incremental patch only. All prior performance/lyrics changes in that commit remain intact.

## Confirmed behavior requested

- Opening Music defaults to the expanded in-app lyrics-focus view, rather than the Library.
- Mobile hides the fullscreen/expand icon, but retains a way to exit lyrics focus.
- Fix the blur after clicking a Stremio catalogue card and opening Watch.

## Watch root cause and fix

Reproduced against the unmodified production build with a Stremio fixture card, native media and `ambient: true` (also the default player preference). Once playback started, JashPlayer mounted a fixed body-level `data-dvp="ambient"` overlay with z-index 45 and `backdrop-blur-[1.5px]`. The watch frame lives inside an isolated cinema stacking context below it. The result is an overlay over the picture/page, not just behind it.

The unified Watch page now explicitly passes the existing UI policy `ambient: false` to JashPlayer. Its existing decorative artwork halo remains behind the frame. No global CSS removal, no preference deletion, no stream/resolver changes. This applies to the unified Watch surface, including Stremio entries; the Live player is unchanged. It does not modify blur or quality inside third-party embedded websites.

Regression test failed on baseline because the ambient overlay was present, then passed on the patched build. The user's saved ambient preference is preserved for other surfaces.

## Music behavior

- Fresh `/music`: expanded lyrics focus, Library closed, including the empty/no-song state.
- Library button now works on desktop and mobile even while in focus. Selecting a song returns to expanded lyrics; browsing itself does not interrupt playback.
- Mobile (up to 900px): hide the expand/exit glyph; show `Exit focus` text while expanded. Lyrics/Music restores expanded focus; Artwork and Library remain available.
- Desktop: keep the existing expand/exit icon.
- URL/history retains explicit Library, focus and artwork choices. A bare `/music` still defaults to expanded lyrics. An explicit `?library=1` opens Library.
- Browser Back/Forward and responsive resizing preserve those choices. The mobile Library's background inertness/focus trap is removed when resizing to desktop.
- This is in-app lyrics focus, not an automatic browser Fullscreen API request. Browser chrome is not forcibly hidden.

## Verification completed

- `npm run check`: 253 source modules.
- Production `npm run build` and `git diff --check`.
- Watch clarity browser tests: real Stremio-card navigation with native silent-WAV fixture and embedded HTML fixture, 1440px and 390px; no ambient overlay, no theater class, preference preserved, Back cleanup.
- Music focus browser tests: 1440px, 390px, 360px; lyrics-first, no mobile expand icon, text exit, desktop toggle, Library open/close, Artwork, history and viewport changes.
- Existing music interaction/geometry tests: 1440×900, 390×844, 320×568, 844×390.
- Existing audio continuity tests: 1440px/390px Music → Home → Music, same playing audio element.
- Existing lyrics-flow browser tests: delayed details and provider 503 → automatic success, no false unavailable or remount refetch.
- Existing performance browser tests: 1440px/390px, cached UI state, soft navigation, refresh failure content retention, no pin writes on entry.
- Lyrics controller and vocal-version regression tests.

All browser/provider data are local fixtures; no production playback/media provider or database writes were used. No GitHub push/deployment performed. Tests use Playwright (`npm install --no-save --package-lock=false playwright`; `npx playwright install chromium --only-shell`), which is not added as a project dependency by this patch.

## Apply

From your repository at the base commit above, back up any local changes first:

```sh
git apply --check jashvibes-watch-lyrics-layout.patch
git apply jashvibes-watch-lyrics-layout.patch
npm ci
npm run check
npm run build
```

Deploy/restart using your usual process and reload the app. No playlist reimport or database migration needed. Do not reapply earlier patches. If the check fails against a newer commit, do not force it.
