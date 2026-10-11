# Music: shared navigation, frosted search, Library-first

Base: `4867e690856e2bbb3cab28298a60ede92a3fda3d` (`fix blur issue`). Incremental patch against freshly fetched GitHub source.

## Changes
- Reuse the site's RailNav on desktop and MobileDock below 1024px, replacing Music's custom route navigation. Same shared destinations/order/active Music state; desktop Admin remains at the bottom.
- Reserve 78px/188px for the desktop rail, and mobile dock/safe-area space below transport. Align Music's responsive layout with the shared 1024px navigation breakpoint.
- Render the shared navigation inside Music's existing modal/pocket-lock boundary, so dialogs cannot leave navigation interactive underneath them. AuthGate still excludes its duplicate mobile dock on Music.
- Add accessible labels to the shared rail links so icon-only desktop widths retain meaningful names.
- Open Library by default on desktop and mobile. Explicit history/URL `library=0` still restores the player. Choosing a song opens lyrics focus; mobile continues to hide the expand icon and retain the text exit.
- Bright frosted-glass search background across the entire bar, dark readable text, translucent gradient and focus ring. The typing area has a stronger transparent-background selector than the generic dark-input rule, fixing the dark inner rectangle. Clear button and search behavior remain.

## Verification
- Production build; source check (253 modules); whitespace check.
- New browser tests at 1440, 1100, 950, 390 and 320px: shared navigation destinations, active state, Library-first, transparent typing area and text color, no dock/transport overlap, history, modal inertness.
- Existing music focus/history/resize tests at 1440, 390 and 360px.
- Existing interaction/geometry tests at 1440×900, 390×844, 320×568 and 844×390.
- Audio continuity and lyrics automatic-recovery browser tests at 1440 and 390px.
- Performance navigation/cache tests at 1440 and 390px.
- Mobile screenshot inspected for continuous frosted search and shared bottom navigation.

Tests use mocked API responses and silent audio fixtures, not production writes or media providers. No push, deployment, or database migration performed. Previous lyrics matching/retry and Watch blur fixes are preserved.

## Apply
```sh
git apply --check jashvibes-music-native-nav.patch
git apply jashvibes-music-native-nav.patch
npm ci
npm run check
npm run build
```
Deploy/restart normally and reload the app. Do not reapply earlier patches. If the check fails against newer source, do not force it.
