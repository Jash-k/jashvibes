// Conservative metadata identity checks, not a claim that crowdsourced text is correct.
export const LYRICS_MATCH_VERSION = 2;
export function lyricTextKey(value = '') {
  return String(value).normalize('NFKC').toLowerCase().replace(/&amp;/g, '&')
    .replace(/[’‘']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function lyricTitle(value = '') {
  return String(value).replace(/\s*\(from\s+["“]?.*?\)\s*/gi, ' ').replace(/\s+-\s+from\s+.+$/i, '').trim();
}
export function lyricAlbum(value = '') {
  const from = String(value).match(/\(from\s+["“]?(.+?)["”]?\)/i);
  if (from) return from[1].replace(/["“”]/g, '').trim();
  return String(value).replace(/\(?original (?:motion picture )?(?:soundtrack|score)\)?/gi, ' ').trim();
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
  const artists = String(wanted.artist || '').split(/[,;&]|\s+feat\.?\s+|\s+and\s+/i).map(lyricTextKey).filter(Boolean);
  const candidateArtists = String(item.artistName || '').split(/[,;&]|\s+feat\.?\s+|\s+and\s+/i).map(lyricTextKey).filter(Boolean);
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
