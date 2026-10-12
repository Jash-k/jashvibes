/**
 * Lyric identity — conservative metadata matching, now tiered.
 *
 * v5 (this file) is the "LRCLIB is the only source" contract. Because nothing
 * else ever supplies text, *retrieval* can be broad and cheap while
 * *acceptance* stays the single gate that decides what may be shown. The old
 * single rule was simultaneously too strict in one place and impossible in
 * another:
 *
 *   too strict   — a 4-second duration difference (radio edit, loop, re-encode)
 *                  rejected a record whose title, artist AND album all agreed.
 *   impossible   — with no duration the rule demanded `artistMatches &&
 *                  albumMatches`, but albumMatches can never be true when the
 *                  caller sent no album, and two of the three client paths
 *                  historically sent none. Those lookups failed by construction.
 *
 * Tiers, strongest first. Everything else is rejected with a machine reason so
 * the UI can say *why* instead of showing a blank stage.
 *
 *   strong          title + artist + album all agree        → accept
 *   album-duration  title + album + duration (±tol)         → accept (credits differ)
 *   artist-duration title + artist + duration (±tol)        → accept (single vs OST)
 *   vocal-alias     explicit M/F version alias + album+dur  → accept (existing rule)
 *
 * A duration far outside tolerance rejects even a `strong` match (a remix album
 * entry can repeat a title and artist), and a conflicting M/F vocal version
 * always rejects: that rule exists because a real bug showed male and female
 * cuts of the same song can share a duration to the second.
 */
export const LYRICS_MATCH_VERSION = 5;

/** Duration difference accepted when title/artist/album support the match. */
export const DURATION_TOLERANCE_SECONDS = 15;
/** A difference beyond this rejects even a fully agreeing title/artist/album. */
export const DURATION_REJECT_SECONDS = 45;

export function lyricTextKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/&amp;/g, '&')
    .replace(/[’‘']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function decoded(value = '') {
  return String(value).replace(/&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&');
}

export function lyricTitle(value = '') {
  return decoded(value).replace(/\s*\(from\s+["“]?.*?\)\s*/gi, ' ').replace(/\s+-\s+from\s+.+$/i, '').trim();
}

// Retrieval may omit a catalogue vocal suffix, but acceptance must retain it.
// Never turn M/F into an unversioned title globally: male/female can have identical durations.
export function lyricVocalVersion(value = '') {
  const title = lyricTitle(value);
  const match = title.match(/^(.*?)\s*(?:\(\s*(male|female|M|F)(?:\s+vocals?)?\s*\)|\s+-\s+(male|female|M|F)(?:\s+vocals?)?|\s+(male|female|M|F)(?:\s+vocals?)?)$/i);
  const marker = match?.[2] || match?.[3] || match?.[4] || '';
  const base = match?.[1]?.trim() || '';
  // Bare initials must be uppercase; a lone letter or 'vocals' is not a version.
  if (!base || (marker.length === 1 && marker !== marker.toUpperCase())) return null;
  return { base, version: /^m/i.test(marker) ? 'male' : 'female', explicit: marker.length > 1 };
}

export function lyricAlbum(value = '') {
  const text = decoded(value);
  const from = text.match(/\(from\s+["“]?(.+?)["”]?\)/i) || text.match(/\s+-\s+from\s+["“]?(.+?)["”]?$/i);
  if (from) return from[1].replace(/["“”]/g, '').trim();
  return text.replace(/\s*\(original (?:motion picture )?(?:soundtrack|score)\)\s*/gi, ' ')
    .replace(/\boriginal (?:motion picture )?(?:soundtrack|score)\b/gi, ' ').replace(/\s+/g, ' ').trim();
}

function vocalAlbumKey(value = '') {
  // Narrow catalogue spelling tolerance, used ONLY with agreeing vocal versions + duration.
  // No edit-distance, substring matching or consonant/transliteration substitutions.
  return lyricTextKey(lyricAlbum(value)).replace(/([aeiou])\1+\b/g, '$1');
}

function artistsOf(value = '') {
  // Punctuation/initial spacing differs across providers, but full names still match.
  return String(value).split(/[,;&]|\s+feat\.?\s+|\s+and\s+/i)
    .map(name => lyricTextKey(name).replace(/\s+/g, '')).filter(Boolean);
}

export function lyricRequestMetadata(detail = {}, original = {}) {
  const spotify = original.spotify || detail.spotify || {};
  const title = detail.title || original.title || spotify.title || '';
  const sameTitle = lyricTextKey(lyricTitle(title)) === lyricTextKey(lyricTitle(spotify.title || ''));
  const artist = detail.artists || original.artists || (sameTitle ? (Array.isArray(spotify.artists) ? spotify.artists.join(', ') : spotify.artists) : '') || '';
  const explicitAlbum = detail.album || original.album || (sameTitle ? spotify.album : '') || '';
  const fromAlbum = /\(from\s|\s-\sfrom\s/i.test(decoded(title)) ? lyricAlbum(title) : '';
  // Only infer the film from the title when the supplied album is absent or repeats the song title.
  const album = !explicitAlbum || lyricTextKey(lyricAlbum(explicitAlbum)) === lyricTextKey(title)
    || lyricTextKey(explicitAlbum) === lyricTextKey(lyricTitle(title)) ? fromAlbum || explicitAlbum : explicitAlbum;
  const duration = Number(detail.duration) || Number(original.duration) || 0;
  return { title, artist, album: lyricAlbum(album), duration };
}

/**
 * Retrieval variants for one song — what the route searches with.
 *
 * These exist because LRCLIB's fielded `track_name=` query is exact-ish while its
 * free-text `q=` query is not: "Vandikkaran Sontha" returns zero rows fielded and
 * six rows free-text, and a "(From \"Leo\")" suffix or a "– Male" version marker
 * is enough to lose a record that is plainly there. Variants only widen what is
 * *retrieved*; `lyricIdentity` still decides what is accepted.
 */
export function lyricSearchVariants({ title = '', album = '' } = {}) {
  const out = new Set();
  const push = (value) => { const v = String(value || '').replace(/\s+/g, ' ').trim(); if (v.length > 1 && v.length <= 200) out.add(v); };
  const raw = decoded(title);
  push(lyricTitle(raw));
  push(raw);
  push(raw.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' '));       // drop every parenthetical
  push(raw.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s*[-–—]\s*(?:male|female|m|f)\b.*$/i, ' '));
  const vocal = lyricVocalVersion(raw);
  if (vocal) push(vocal.base);
  push(raw.replace(/\s*\b(?:feat|ft|featuring|with)\.?\s+.*$/i, ' '));
  push(raw.replace(/\s*[-–—]\s*(?:from|ost|soundtrack)\b.*$/i, ' '));
  const film = lyricAlbum(album);
  if (film && lyricTextKey(film) !== lyricTextKey(lyricTitle(raw))) push(film);
  return [...out];
}

/** Stable cache/search key for one request. Rounded duration keeps near-misses together. */
export function lyricCacheKey({ title = '', artist = '', album = '', duration = 0, id = '' } = {}) {
  const rounded = Math.round(Number(duration) || 0);
  return [LYRICS_MATCH_VERSION, lyricTextKey(lyricTitle(title)), lyricTextKey(artist), lyricTextKey(lyricAlbum(album)),
    rounded > 0 ? Math.round(rounded / 2) * 2 : '', String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)].join('|');
}

/**
 * One candidate against one request. Returns `ok` plus the tier that allowed it,
 * or a machine-readable `reason` when it did not.
 */
export function lyricIdentity(item = {}, wanted = {}) {
  const wantedTitle = lyricTextKey(lyricTitle(wanted.title));
  const candidateTitle = lyricTextKey(lyricTitle(item.trackName || item.name));
  const titleMatches = Boolean(wantedTitle && candidateTitle === wantedTitle);

  const sourceVocal = lyricVocalVersion(wanted.title);
  const candidateVocal = lyricVocalVersion(item.trackName || item.name);
  if (sourceVocal && candidateVocal && sourceVocal.version !== candidateVocal.version) {
    return { ok: false, reason: 'vocal-version-mismatch' };
  }
  const vocalMatch = Boolean(sourceVocal && candidateVocal && sourceVocal.version === candidateVocal.version
    && lyricTextKey(sourceVocal.base) === lyricTextKey(candidateVocal.base)
    && (sourceVocal.explicit || candidateVocal.explicit));
  if (!wantedTitle || (!titleMatches && !vocalMatch)) return { ok: false, reason: 'title-mismatch' };

  const album = lyricTextKey(lyricAlbum(wanted.album));
  const candidateAlbum = lyricTextKey(lyricAlbum(item.albumName));
  const albumMatches = Boolean(album && candidateAlbum && album === candidateAlbum);
  const vocalAlbumMatches = Boolean(vocalMatch && album && candidateAlbum && vocalAlbumKey(wanted.album) === vocalAlbumKey(item.albumName));

  const duration = Number(wanted.duration) || 0;
  const actual = Number(item.duration) || 0;
  const hasDuration = duration > 0 && actual > 0;
  const durationDelta = hasDuration ? Math.abs(duration - actual) : null;
  const durationClose = Boolean(hasDuration && durationDelta <= DURATION_TOLERANCE_SECONDS);
  if (hasDuration && durationDelta > DURATION_REJECT_SECONDS) return { ok: false, reason: 'duration-mismatch' };

  const artists = artistsOf(wanted.artist);
  const candidateArtists = artistsOf(item.artistName);
  const artistMatches = artists.some((name) => candidateArtists.includes(name));

  const evidence = { titleMatches, vocalMatch, artistMatches, albumMatches, durationDelta, durationClose };
  // A vocal-title alias still needs album agreement AND duration: it is the weakest title evidence.
  if (!titleMatches) {
    const ok = vocalMatch && (vocalAlbumMatches || albumMatches) && durationClose;
    return { ok, tier: ok ? 'vocal-alias' : null, reason: ok ? 'metadata matched' : 'insufficient vocal version evidence', ...evidence };
  }
  if (titleMatches && artistMatches && albumMatches) return { ok: true, tier: 'strong', reason: 'metadata matched', ...evidence };
  if (titleMatches && albumMatches && durationClose) return { ok: true, tier: 'album-duration', reason: 'metadata matched', ...evidence };
  if (titleMatches && artistMatches && durationClose) return { ok: true, tier: 'artist-duration', reason: 'metadata matched', ...evidence };
  if (titleMatches && artistMatches && albumMatches === false && !hasDuration) return { ok: false, reason: 'album-mismatch' };
  if (titleMatches && hasDuration && !durationClose) return { ok: false, reason: 'duration-mismatch' };
  if (titleMatches && !artistMatches && !albumMatches) return { ok: false, reason: 'artist-mismatch' };
  return { ok: false, reason: 'insufficient-evidence', ...evidence };
}

const TIER_RANK = { strong: 3, 'album-duration': 2, 'artist-duration': 2, 'vocal-alias': 1 };

export function chooseLyricMatch(items = [], wanted = {}) {
  const judged = items
    .filter((item) => item && (item.plainLyrics || item.syncedLyrics) && !item.instrumental)
    .map((item) => ({ item, identity: lyricIdentity(item, wanted) }))
    .filter(({ identity }) => identity.ok);
  judged.sort((a, b) => {
    const t = (TIER_RANK[b.identity.tier] || 0) - (TIER_RANK[a.identity.tier] || 0);
    if (t) return t;
    const { identity: x } = a; const { identity: y } = b;
    return Number(y.titleMatches) - Number(x.titleMatches) || Number(y.albumMatches) - Number(x.albumMatches)
      || Number(y.artistMatches) - Number(x.artistMatches)
      || (x.durationDelta ?? 99) - (y.durationDelta ?? 99)
      || Number(Boolean(b.item.syncedLyrics)) - Number(Boolean(a.item.syncedLyrics))
      || (Number(a.item.id) || 0) - (Number(b.item.id) || 0);
  });
  return judged[0] ? { ...judged[0].item, matchTier: judged[0].identity.tier } : null;
}
