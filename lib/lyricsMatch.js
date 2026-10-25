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
 *   strong            title + artist + album all agree        → accept
 *   album-duration    title + album + duration (±tol)         → accept (credits differ)
 *   artist-duration   title + artist + duration (±tol)        → accept (single vs OST)
 *   catalogue-suffix  our decoration stripped + (artist OR    → accept (same recording,
 *                     album) + duration (±tol)                    named differently)
 *   vocal-alias       explicit M/F version alias + album+dur  → accept (existing rule)
 *
 * The catalogue-suffix tier is the newest and the narrowest. The catalogue — not the
 * recording — decorates some titles: "(Trending Version)", "(Title Theme)", "(LoFi Mix)",
 * "(Karaoke)", "(Reprise)", "(Remix by …)". A decorated title is a *different string* for
 * the same recording, so exact-title matching silently refused it while the provider's own
 * site (which searches by name, not by string) shows the lyrics. The tier strips those
 * decorations from OUR title only, and still demands that the record agree on the artist or
 * the album AND run within the duration tolerance. `lyricCatalogueTitle` deliberately does
 * not strip Live, Acoustic, Instrumental, M/F markers or language names: those are different
 * recordings or different words, and the M/F rule above exists because they can share a
 * duration to the second.
 *
 * A duration far outside tolerance rejects even a `strong` match (a remix album
 * entry can repeat a title and artist), and a conflicting M/F vocal version
 * always rejects: that rule exists because a real bug showed male and female
 * cuts of the same song can share a duration to the second.
 */
export const LYRICS_MATCH_VERSION = 6;

/** Duration difference accepted when title/artist/album support the match. */
export const DURATION_TOLERANCE_SECONDS = 15;
/** A difference beyond this rejects even a fully agreeing title/artist/album. */
const DURATION_REJECT_SECONDS = 45;

function lyricTextKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/&amp;/g, '&')
    .replace(/[’‘']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function decoded(value = '') {
  return String(value).replace(/&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&');
}

function lyricTitle(value = '') {
  return decoded(value).replace(/\s*\(from\s+["“]?.*?\)\s*/gi, ' ').replace(/\s+-\s+from\s+.+$/i, '').trim();
}

// Retrieval may omit a catalogue vocal suffix, but acceptance must retain it.
// Never turn M/F into an unversioned title globally: male/female can have identical durations.
function lyricVocalVersion(value = '') {
  const title = lyricTitle(value);
  const match = title.match(/^(.*?)\s*(?:\(\s*(male|female|M|F)(?:\s+vocals?)?\s*\)|\s+-\s+(male|female|M|F)(?:\s+vocals?)?|\s+(male|female|M|F)(?:\s+vocals?)?)$/i);
  const marker = match?.[2] || match?.[3] || match?.[4] || '';
  const base = match?.[1]?.trim() || '';
  // Bare initials must be uppercase; a lone letter or 'vocals' is not a version.
  if (!base || (marker.length === 1 && marker !== marker.toUpperCase())) return null;
  return { base, version: /^m/i.test(marker) ? 'male' : 'female', explicit: marker.length > 1 };
}

/*
 * Is this record the same song, allowing for the versions that differ only in a suffix?
 *
 * Used by the picker, which must show the records the acceptance rules refuse — a live cut, a remix,
 * a version with the film's name attached — without turning into a search results page. The rule is
 * deliberate and narrow: the two titles are equal after normalising, or one contains the other and is
 * at least 60% as long (so "Kannana Kanne" accepts "Kannana Kanne (Live)" but not "Kanna").
 */
export function lyricSameTitle(candidateTitle = '', wantedTitle = '') {
  const candidate = lyricTextKey(lyricTitle(candidateTitle));
  const wanted = lyricTextKey(lyricTitle(wantedTitle));
  if (!candidate || !wanted) return false;
  if (candidate === wanted) return true;
  const [short, long] = candidate.length <= wanted.length ? [candidate, wanted] : [wanted, candidate];
  return long.includes(short) && short.length >= Math.ceil(long.length * 0.6);
}

/**
 * A title with the catalogue's own decorations removed — and nothing else.
 *
 * Only whole parenthetical/dashed segments that are *named* decorations are stripped, so
 * "Kannana Kanne (Trending Version)" becomes "Kannana Kanne" while "Po Nee Po - Male Vocals"
 * does not change at all. Used by the catalogue-suffix acceptance tier below: what is
 * decoration on our side is then compared against the provider's plain title.
 */
const CATALOGUE_DECORATION_RE = /^(?:trending\s+version|title\s+theme|theme|lo[\s-]?fi(?:\s+mix|\s+flip)?|karaoke(?:\s+version)?|reprise|remix(?:\s+by\s+.*)?|unplugged|radio\s+edit|extended(?:\s+version)?|version|\d+\s*[-–—]\s*\d+\s*bpm|\d+\s*bpm)$/i;

export function lyricCatalogueTitle(value = '') {
  const base = lyricTitle(decoded(value));
  return base
    .replace(/\s*[([][^)\]]*[)\]]/g, (segment) => {
      const inner = segment.replace(/^[\s([\]]+/, '').replace(/[\s)\]]+$/, '').trim();
      return CATALOGUE_DECORATION_RE.test(inner) ? ' ' : segment;
    })
    .replace(/\s*[-–—]\s*([^-–—]+)$/, (segment, tail) => (CATALOGUE_DECORATION_RE.test(String(tail).trim()) ? ' ' : segment))
    // The catalogue also appends decorations bare, without brackets: "Un Paarvaiyil LoFi Mix".
    // Only the unambiguous multi-word ones are stripped — never a lone "Mix", which is a real word
    // in real titles ("Tamil Love Mix").
    .replace(/\s+(?:lo[\s-]?fi\s+mix|trending\s+version|title\s+theme|karaoke(?:\s+version)?|reprise|remix\s+by\s+.*)$/i, '')
    .replace(/\s+/g, ' ').trim();
}

function lyricAlbum(value = '') {
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
  // Punctuation/initial spacing differs across providers, but full names still match. The slash
  // matters as much as the comma: LRCLIB writes the same credit list as "Dhanush/ Dhee" where the
  // catalogue writes "Dhanush, Dhee", and an unsplit string never matches either name.
  return String(value).split(/[,;&/]|\s+feat\.?\s+|\s+and\s+/i)
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
  // First is the question stage 1 asks of the provider, so it carries the catalogue-clean title:
  // a decoration like "(Trending Version)" is the catalogue's, and asking the provider for it
  // returns a page of near-misses instead of the 20 rows the plain title returns.
  push(lyricCatalogueTitle(raw));
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
  // Our title may carry a catalogue decoration the provider's record does not. That alone is
  // never enough to accept (see the tier rules below): it still needs an artist or album
  // agreement and a length within tolerance.
  const wantedBareTitle = lyricTextKey(lyricCatalogueTitle(wanted.title));
  const decoratedTitle = Boolean(wantedBareTitle) && wantedBareTitle !== wantedTitle;
  const catalogueTitleMatches = decoratedTitle && wantedBareTitle === candidateTitle;

  const sourceVocal = lyricVocalVersion(wanted.title);
  const candidateVocal = lyricVocalVersion(item.trackName || item.name);
  if (sourceVocal && candidateVocal && sourceVocal.version !== candidateVocal.version) {
    return { ok: false, reason: 'vocal-version-mismatch' };
  }
  const vocalMatch = Boolean(sourceVocal && candidateVocal && sourceVocal.version === candidateVocal.version
    && lyricTextKey(sourceVocal.base) === lyricTextKey(candidateVocal.base)
    && (sourceVocal.explicit || candidateVocal.explicit));
  if (!wantedTitle || (!titleMatches && !vocalMatch && !catalogueTitleMatches)) return { ok: false, reason: 'title-mismatch' };

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

  const evidence = { titleMatches, catalogueTitleMatches, vocalMatch, artistMatches, albumMatches, durationDelta, durationClose };
  // A decorated catalogue title is the same recording under a different name — accepted only when
  // the record also agrees on the artist or the album AND runs the same length.
  if (!titleMatches && catalogueTitleMatches) {
    const ok = (artistMatches || albumMatches) && durationClose;
    return { ok, tier: ok ? 'catalogue-suffix' : null, reason: ok ? 'metadata matched' : 'insufficient decorated-title evidence', ...evidence };
  }
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

const TIER_RANK = { strong: 3, 'album-duration': 2, 'artist-duration': 2, 'catalogue-suffix': 2, 'vocal-alias': 1 };

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
