// Conservative metadata identity checks, not a claim that crowdsourced text is correct.
export const LYRICS_MATCH_VERSION = 3;
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
export function lyricAlbum(value = '') {
  const text = decoded(value);
  const from = text.match(/\(from\s+["“]?(.+?)["”]?\)/i) || text.match(/\s+-\s+from\s+["“]?(.+?)["”]?$/i);
  if (from) return from[1].replace(/["“”]/g, '').trim();
  return text.replace(/\s*\(original (?:motion picture )?(?:soundtrack|score)\)\s*/gi, ' ')
    .replace(/\boriginal (?:motion picture )?(?:soundtrack|score)\b/gi, ' ').replace(/\s+/g, ' ').trim();
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
export function lyricIdentity(item = {}, wanted = {}) {
  const title = lyricTextKey(lyricTitle(wanted.title));
  if (!title || lyricTextKey(lyricTitle(item.trackName || item.name)) !== title) return { ok: false, reason: 'title mismatch' };
  const album = lyricTextKey(lyricAlbum(wanted.album));
  const candidateAlbum = lyricTextKey(lyricAlbum(item.albumName));
  if (album && candidateAlbum && album !== candidateAlbum) return { ok: false, reason: 'album mismatch' };
  const duration = Number(wanted.duration), actual = Number(item.duration);
  const hasDuration = duration > 0 && actual > 0;
  if (hasDuration && Math.abs(duration - actual) > 2) return { ok: false, reason: 'duration mismatch' };
  const artists = artistsOf(wanted.artist);
  const candidateArtists = artistsOf(item.artistName);
  const artistMatches = artists.some((name) => candidateArtists.includes(name));
  const albumMatches = Boolean(album && candidateAlbum && album === candidateAlbum);
  // Album+duration can identify multi-artist film tracks whose credits differ across providers.
  // With missing duration, require both exact album and a complete artist-name match.
  const ok = hasDuration ? artistMatches || albumMatches : artistMatches && albumMatches;
  return { ok, reason: ok ? 'metadata matched' : 'insufficient identity evidence', artistMatches, albumMatches, durationDelta: hasDuration ? Math.abs(duration - actual) : null };
}
export function chooseLyricMatch(items = [], wanted = {}) {
  const valid = items.filter((item) => item && (item.plainLyrics || item.syncedLyrics) && lyricIdentity(item, wanted).ok);
  valid.sort((a, b) => {
    const x = lyricIdentity(a, wanted), y = lyricIdentity(b, wanted);
    return Number(y.artistMatches) - Number(x.artistMatches) || Number(y.albumMatches) - Number(x.albumMatches)
      || (x.durationDelta ?? 10) - (y.durationDelta ?? 10) || Number(Boolean(b.syncedLyrics)) - Number(Boolean(a.syncedLyrics));
  });
  return valid[0] || null;
}
