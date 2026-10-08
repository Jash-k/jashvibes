# Approved behaviour contract

Implementation was explicitly authorized by the user selecting **Proceed with these defaults** after section-by-section planning.

## On-demand

- Home and Vault catalogue cards open unified Watch; matching Vault iframe starts there.
- Fresh Home/Vault entry uses Vault → Stremio → Direct MP4 → Mirchi, regardless of remembered preferences.
- ReTro uses the selected item's Aha/Eros streams first, then the shared chain.
- Stremio entry uses Stremio → Vault → Direct MP4 → Mirchi, without retrying the exhausted provider later in the same attempt.
- Source, Episode and Resolution are separate. Quality changes never advance an episode or silently select a different provider.
- An unidentified Home card still opens Watch; confident type-aware Vault matching and ID entry happen inside Watch.
- Auto native/Shaka failures use bounded alternatives then next provider. Explicitly chosen providers remain selected and show Retry/Next on exhaustion.
- Opaque iframes are switched by user action. Document load is not video success; do not infer timestamps or blindly fail over after a timer.
- Direct MP4 candidates are proven before they are offered: each link is probed with a bounded ranged request, and a host that refuses (403/404/410, or a body that is not media) is marked unavailable and sorted below the living ones rather than silently becoming "Auto". A host whose probe is inconclusive counts as unknown, never as dead. The watch page warms the resolver in the background when a movie page opens, using the cheap index lookup only; the walk itself never runs speculatively for a title the index does not know.
- Legacy playback links remain usable through redirects.

## Live TV

- Keep the dedicated Live page, guide, channel navigation and favourites.
- Use direct playback where supported, with targeted proxy when required/recovering.
- Auto recovery may use explicitly grouped alternatives for the same channel, never another channel or a fuzzy name match.
- A manual source is locked until the user chooses another.
- Manual map, unmap, position and guide decisions are durable. An empty mapping is a real decision.
- New synced candidates are unpublished until the owner maps them. Health status never deletes desired memberships.
- Saved catalogue/read failure is not permission to silently substitute raw source feeds.

## Music

- Dedicated audio experience: library alongside dominant lyrics on desktop; mobile browsing sheet with New / Tracks / Albums / Artists / Playlists and a persistent mini-player.
- Album selection displays its genuine available tracklist, with stable ID, request guards, Back and inline loading/error/Retry states.
- Browse/search/lyrics/player states are independent. Browsing does not change the queue.
- Mobile song selection stays in browsing while lyrics update. A persistent player stays available across tabs and app navigation.
- Current-track-keyed lyric requests reject stale responses; failed lyrics remain retryable.
- Bitrate changes preserve track position. Same-track bounded recovery stops with Retry/Skip rather than automatically changing songs.
- Music pauses when Watch/Live takes audio focus; opaque frames claim focus at opening because playback cannot be detected reliably.

## Remaining delegated defaults

Preserve and correct Home/library behaviour, favourites and history. Do not claim iframe progress. Use owner-only server mutations, consistent viewer/owner realms and expiring sessions. Preserve manual data on sync. Harden public proxies, retain usable deployment configuration, apply tested dependency/security updates, and ship a clean repository ZIP without secrets or generated dependencies/builds.
