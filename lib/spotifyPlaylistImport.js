import { searchSongs } from '@/lib/musicApi';
import { upsertImportedPlaylist } from '@/lib/musicPlaylistStore';

const DEFAULT_SPOTIFY_PROXY = 'https://spotubedl-api.onrender.com/api/metadata';

export function parseSpotifyPlaylistId(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const match = raw.match(/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/i) || raw.match(/^spotify:playlist:([A-Za-z0-9]+)/i);
  return match?.[1] || '';
}

function canonicalSpotifyPlaylistUrl(url = '') {
  const id = parseSpotifyPlaylistId(url);
  return id ? `https://open.spotify.com/playlist/${id}` : String(url || '').trim();
}

async function fetchSpotifyMetadataViaProxy(url = '') {
  const proxyUrl = process.env.SPOTIFY_PROXY || process.env.SPOTIFY_METADATA_PROXY || DEFAULT_SPOTIFY_PROXY;
  const attempts = Math.max(1, Math.min(Number(process.env.SPOTIFY_PROXY_RETRIES || 3), 5));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.SPOTIFY_PROXY_TIMEOUT_MS || 70000));
    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'JaSH-ViBeS/1.0 Spotify Playlist Import',
        },
        body: JSON.stringify({ url }),
      });
      const text = await response.text();
      let payload = null;
      try { payload = JSON.parse(text); } catch {}
      if (!response.ok) throw new Error(payload?.detail || payload?.error || `Spotify proxy returned HTTP ${response.status}`);
      if (!payload?.tracks?.length) throw new Error('Spotify proxy returned no tracks for this playlist. Make sure it is public.');
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (lastError?.name === 'AbortError') throw new Error('Spotify proxy timed out while reading the playlist. Try again.');
  throw lastError || new Error('Spotify proxy failed.');
}


function normalize(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&quot;/g, ' ')
    .replace(/&amp;/g, ' ')
    .replace(/\([^)]*(from|feat|remix|version|sped|slowed)[^)]*\)/gi, ' ')
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function overlapScore(source = '', target = '') {
  const sourceTokens = normalize(source).split(' ').filter((token) => token.length > 1);
  const targetText = normalize(target);
  if (!sourceTokens.length || !targetText) return 0;
  const hits = sourceTokens.filter((token) => targetText.includes(token)).length;
  return hits / sourceTokens.length;
}

function scoreSaavnCandidate(candidate = {}, spotify = {}) {
  let score = 0;
  const title = spotify.title || '';
  const artist = (spotify.artists || []).join(' ');
  const album = spotify.album || '';
  const cTitle = candidate.title || '';
  const cArtists = candidate.artists || '';
  const cAlbum = candidate.album || '';

  if (normalize(cTitle) === normalize(title)) score += 120;
  else score += Math.round(overlapScore(title, cTitle) * 80);

  score += Math.round(overlapScore(artist, cArtists) * 70);
  score += Math.round(overlapScore(album, cAlbum) * 20);

  if (String(candidate.language || '').toLowerCase() === 'tamil') score += 12;
  if (candidate.hasStreams) score += 15;
  if (candidate.streamUrls && Object.values(candidate.streamUrls).some(Boolean)) score += 15;
  return score;
}

async function matchSpotifyTrackToSaavn(spotifyTrack = {}) {
  const artists = spotifyTrack.artists || [];
  const query = [spotifyTrack.title, ...artists.slice(0, 2)].filter(Boolean).join(' ');
  const fallbackQuery = [spotifyTrack.title, spotifyTrack.album].filter(Boolean).join(' ');
  const useFallbackSearch = process.env.SPOTIFY_IMPORT_FALLBACK_SEARCH === '1';
  const lists = await Promise.all([
    searchSongs(query, 6).catch(() => []),
    useFallbackSearch && fallbackQuery && fallbackQuery !== query ? searchSongs(fallbackQuery, 4).catch(() => []) : [],
  ]);
  const candidates = [...lists.flat()];
  const seen = new Set();
  const unique = candidates.filter((item) => {
    const key = item.seokey || item.id || `${item.title}:${item.artists}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const best = unique
    .map((candidate) => ({ candidate, score: scoreSaavnCandidate(candidate, spotifyTrack) }))
    .sort((a, b) => b.score - a.score)[0];

  if (!best || best.score < Number(process.env.SPOTIFY_IMPORT_MIN_SCORE || 65)) {
    return { matched: false, score: best?.score || 0, query };
  }
  return { matched: true, score: best.score, query, saavn: best.candidate };
}

async function runLimited(items = [], limit = 2, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

function mapSpotifyTrack(track = {}, index = 0) {
  return {
    id: String(track.id || ''),
    title: String(track.title || track.name || '').trim(),
    artists: Array.isArray(track.artists) ? track.artists.map(String) : String(track.artist || '').split(',').map((item) => item.trim()).filter(Boolean),
    album: String(track.album || '').trim(),
    image: String(track.cover_url || track.image || '').trim(),
    durationMs: Number(track.duration_ms || track.durationMs || 0),
    url: track.url || (track.id ? `https://open.spotify.com/track/${track.id}` : ''),
    order: index + 1,
  };
}

export async function importSpotifyPlaylist(url = {}, options = {}) {
  const sourceUrl = canonicalSpotifyPlaylistUrl(typeof url === 'string' ? url : url.url);
  const spotifyId = parseSpotifyPlaylistId(sourceUrl);
  if (!spotifyId) throw new Error('A valid public Spotify playlist URL is required.');

  const metadata = await fetchSpotifyMetadataViaProxy(sourceUrl);
  const rawTracks = Array.isArray(metadata?.tracks) ? metadata.tracks : [];
  if (!rawTracks.length) throw new Error('Spotify playlist has no tracks or the proxy could not read it.');

  const maxTracks = Math.max(1, Math.min(Number(options.maxTracks || process.env.SPOTIFY_IMPORT_MAX_TRACKS || 60), 300));
  const spotifyTracks = rawTracks.slice(0, maxTracks).map(mapSpotifyTrack).filter((track) => track.title);
  const concurrency = Math.max(1, Math.min(Number(process.env.SPOTIFY_IMPORT_CONCURRENCY || 2), 5));

  const importedTracks = await runLimited(spotifyTracks, concurrency, async (spotify, index) => {
    const match = await matchSpotifyTrackToSaavn(spotify);
    return {
      order: index + 1,
      spotify,
      saavn: match.saavn || null,
      matched: Boolean(match.matched),
      score: match.score || 0,
      query: match.query || '',
    };
  });

  const matched = importedTracks.filter((track) => track.matched && track.saavn);
  const unmatched = importedTracks.filter((track) => !track.matched || !track.saavn);
  const title = String(options.title || metadata.name || 'Imported Spotify Playlist').trim();

  const playlist = await upsertImportedPlaylist({
    source: 'spotify',
    sourceUrl,
    spotifyId,
    title,
    description: String(metadata.description || '').trim(),
    image: String(options.image || metadata.cover_url || metadata.image || '').trim(),
    owner: String(metadata.creator || metadata.owner || 'Spotify').trim(),
    tracks: matched,
    unmatched,
    trackCount: importedTracks.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    isDefault: true,
    sortOrder: options.sortOrder ?? 999,
  });

  return {
    ok: true,
    playlist,
    trackCount: importedTracks.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.slice(0, 25),
    proxy: true,
  };
}
