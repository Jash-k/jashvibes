const DEFAULT_SAAVN_API = 'https://saavnapi.onrender.com';

export const TAMIL_DIRECTORS = [
  'A.R. Rahman',
  'Ilaiyaraaja',
  'Yuvan Shankar Raja',
  'Harris Jayaraj',
  'Anirudh Ravichander',
  'G. V. Prakash Kumar',
  'D. Imman',
  'Santhosh Narayanan',
  'Vidyasagar',
  'Deva',
  'Sean Roldan',
  'Sam C. S.',
  'Ghibran',
  'Thaman S',
];

const TAMIL_DIRECTOR_OVERRIDES = {
  deva: {
    id: '15925885',
    brokenIds: ['455219'],
    name: 'Deva',
    searchName: 'Thenisai Thendral Deva',
    albumQuery: 'Deva Tamil 90s',
    role: 'Music Director',
    dominantType: 'music director',
    dominantLanguage: 'tamil',
  },
};

const HOME_NATIVE_SECTIONS = [
  { id: 'new_trending', title: 'Trending Now', sourceKey: 'new_trending', limit: 18, types: ['album', 'playlist'] },
  { id: 'new_albums', title: 'New Releases', sourceKey: 'new_albums', limit: 18 },
  { id: 'top-genres-moods', title: 'Top Genres & Moods', sourceKey: 'promo:vx:data:76', limit: 18 },
  { id: 'best-of-90s', title: 'Best Of 90s', sourceKey: 'promo:vx:data:185', limit: 18 },
];

function getSaavnApiBases() {
  const configured = [process.env.SAAVN, process.env.SAAVN_API, process.env.SAAVN_MIRRORS]
    .filter(Boolean)
    .join(',');
  const bases = configured
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return Array.from(new Set(bases.length ? bases : [DEFAULT_SAAVN_API]));
}

function saavnTimeoutMs() {
  const value = Number(process.env.SAAVN_TIMEOUT_MS || 25000);
  return Number.isFinite(value) && value >= 3000 ? value : 25000;
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function normalizeLookup(value = '') {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function getTamilDirectorOverride(value = '') {
  const raw = String(value || '').trim();
  const key = normalizeLookup(raw);
  if (!key) return null;
  if (key === 'deva' || key === 'thenisai thendral deva' || raw === TAMIL_DIRECTOR_OVERRIDES.deva.id || TAMIL_DIRECTOR_OVERRIDES.deva.brokenIds.includes(raw)) {
    return TAMIL_DIRECTOR_OVERRIDES.deva;
  }
  return null;
}

function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.tracks)) return value.tracks;
  if (Array.isArray(value?.songs)) return value.songs;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.data?.results)) return value.data.results;
  if (Array.isArray(value?.data?.songs)) return value.data.songs;
  if (value && typeof value === 'object') return [value];
  return [];
}

function bestImage(images) {
  if (Array.isArray(images)) {
    return [...images].reverse().find((item) => item?.url)?.url || images.find((item) => item?.url)?.url || '';
  }
  if (typeof images === 'string') return images;
  return '';
}

function imageFrom(item = {}) {
  return (
    bestImage(item.image) ||
    item?.images?.urls?.large_artwork ||
    item?.images?.urls?.medium_artwork ||
    item?.images?.urls?.small_artwork ||
    item?.artwork ||
    item?.album_image ||
    item?.artist_image ||
    ''
  );
}

function normalizeArtistList(artists, fallback = '') {
  const output = [];
  const seen = new Set();
  const add = (item) => {
    if (!item) return;
    const name = normalizeWhitespace(typeof item === 'string' ? item : item.name || item.title || '');
    if (!name) return;
    const id = String(typeof item === 'object' ? item.id || item.artistId || '' : '').trim();
    const key = (id || name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push({
      id: id || name,
      name,
      image: typeof item === 'object' ? imageFrom(item) : '',
      role: typeof item === 'object' ? item.role || item.dominantType || item.type || 'Artist' : 'Artist',
      url: typeof item === 'object' ? item.url || '' : '',
    });
  };

  if (Array.isArray(artists)) artists.forEach(add);
  else if (typeof artists === 'string') fallback = artists;
  else if (artists && typeof artists === 'object') {
    [...(artists.primary || []), ...(artists.all || []), ...(artists.featured || [])].forEach(add);
  }

  if (!output.length && fallback) {
    String(fallback)
      .split(/,|&|;|\band\b/gi)
      .map(normalizeWhitespace)
      .filter(Boolean)
      .slice(0, 8)
      .forEach((name) => add({ id: name, name }));
  }
  return output;
}

function artistNamesFromList(list = []) {
  return list.map((item) => item?.name).filter(Boolean).join(', ');
}

function artistNamesFromSaavn(artists, fallback = '') {
  return artistNamesFromList(normalizeArtistList(artists, fallback));
}

function mapSaavnArtist(item = {}) {
  const name = normalizeWhitespace(item.name || item.title || item.artist || 'Artist');
  return {
    id: String(item.id || item.artistId || name),
    name,
    image: imageFrom(item),
    role: item.role || item.dominantType || item.type || 'Artist',
    dominantType: item.dominantType || item.role || item.type || 'Artist',
    dominantLanguage: item.dominantLanguage || item.language || '',
    url: item.url || '',
  };
}

function streamsFromSaavn(item = {}) {
  const list = item.downloadUrl || item.download_url || item.more_info?.download_url || [];
  if (typeof list === 'string') return { auto: list };
  if (!Array.isArray(list)) return {};
  const streams = {};
  for (const entry of list) {
    if (!entry?.url) continue;
    const key = String(entry.quality || '').replace(/\s+/g, '').toLowerCase() || `q${Object.keys(streams).length + 1}`;
    streams[key] = entry.url;
  }
  return streams;
}

function durationLabel(seconds) {
  const n = Number(seconds || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const min = Math.floor(n / 60);
  const sec = String(Math.floor(n % 60)).padStart(2, '0');
  return `${min}:${sec}`;
}

export function mapSaavnTrack(item = {}) {
  const streamUrls = streamsFromSaavn(item);
  const id = String(item.id || item.songId || item.track_id || '');
  const title = normalizeWhitespace(item.name || item.title || item.song || 'Untitled');
  const artistList = normalizeArtistList(item.artists, item.artist || item.subtitle || '');
  return {
    provider: 'saavn',
    id: id || title,
    seokey: id ? `saavn:${id}` : '',
    trackId: id,
    title,
    artists: normalizeWhitespace(artistNamesFromList(artistList) || item.artist || item.subtitle || ''),
    artistList,
    album: normalizeWhitespace(item.album?.name || item.album || item.album_title || item.more_info?.album || ''),
    albumSeokey: item.album?.id || item.album_id || item.more_info?.album_id || '',
    language: normalizeWhitespace(item.language || ''),
    duration: String(item.duration || item.more_info?.duration || ''),
    durationLabel: durationLabel(item.duration || item.more_info?.duration),
    genres: normalizeWhitespace(item.genre || item.genres || ''),
    label: normalizeWhitespace(item.label || item.more_info?.label || ''),
    releaseDate: item.releaseDate || item.release_date || item.more_info?.release_date || item.year || '',
    playCount: item.playCount || item.play_count || item.play_count || 0,
    favoriteCount: item.favorite_count || 0,
    songUrl: item.url || item.song_url || '',
    albumUrl: item.album?.url || item.album_url || '',
    image: imageFrom(item),
    streamUrls,
    hasStreams: Object.values(streamUrls).some(Boolean),
  };
}

function mapSaavnAlbum(item = {}) {
  const artistList = normalizeArtistList(item.artists, item.artist || '');
  return {
    id: String(item.id || item.album_id || item.seokey || item.name || Math.random()),
    seokey: item.id || item.seokey || item.album_seokey || '',
    title: normalizeWhitespace(item.name || item.title || item.album || 'Untitled Album'),
    artists: normalizeWhitespace(artistNamesFromList(artistList) || item.artist || ''),
    artistList,
    language: normalizeWhitespace(item.language || ''),
    image: imageFrom(item),
    releaseDate: item.releaseDate || item.year || '',
    year: item.year || '',
    albumUrl: item.url || item.album_url || '',
    songCount: item.songCount || item.song_count || item.songs?.length || 0,
    description: normalizeWhitespace(item.description || ''),
  };
}

function mapSaavnPlaylist(item = {}) {
  return {
    id: String(item.id || item.playlist_id || item.seokey || item.name || Math.random()),
    seokey: item.id || item.seokey || item.playlist_seokey || '',
    title: normalizeWhitespace(item.name || item.title || 'Playlist'),
    language: normalizeWhitespace(item.language || ''),
    image: imageFrom(item),
    subtitle: normalizeWhitespace(`${item.songCount ? `${item.songCount} songs` : ''}${item.language ? ` • ${item.language}` : ''}` || item.description || 'Playlist'),
    description: normalizeWhitespace(item.description || ''),
    songCount: item.songCount || item.song_count || item.songs?.length || 0,
    url: item.url || '',
  };
}

async function fetchSaavn(path, params = {}) {
  const bases = getSaavnApiBases();
  const errors = [];

  for (const base of bases) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), saavnTimeoutMs());
    try {
      const url = new URL(path.replace(/^\/+/, ''), `${base}/`);
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
      });
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; JaSH-ViBeS-Music/2.0)' },
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${base} returned ${response.status}: ${text.slice(0, 160)}`);
      }
      return response.json();
    } catch (error) {
      errors.push(error.name === 'AbortError' ? `${base} timed out waking up` : error.message);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Saavn API failed: ${errors.join(' | ')}`);
}

async function fetchJioSaavnNative(call, params = {}, language = 'tamil') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), saavnTimeoutMs());
  try {
    const url = new URL('https://www.jiosaavn.com/api.php');
    url.searchParams.set('__call', call);
    url.searchParams.set('api_version', '4');
    url.searchParams.set('_format', 'json');
    url.searchParams.set('_marker', '0');
    url.searchParams.set('ctx', 'web6dot0');
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    });

    const lang = String(language || 'tamil').toLowerCase();
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.jiosaavn.com/',
        Cookie: `L=${lang}`,
        'User-Agent': 'Mozilla/5.0 (compatible; JaSH-ViBeS-Music/2.0)',
      },
    });
    if (!response.ok) throw new Error(`JioSaavn native returned ${response.status}`);
    const text = await response.text();
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeNativeHomeItem(item = {}) {
  const title = normalizeWhitespace(item.title || item.name || '');
  const subtitle = normalizeWhitespace(item.subtitle || item.header_desc || '');
  return {
    ...item,
    name: item.name || item.title,
    title,
    subtitle,
    url: item.url || item.perma_url,
    playCount: item.playCount || item.play_count || item.play_count || item.more_info?.play_count || 0,
    releaseDate: item.releaseDate || item.more_info?.release_date || item.year || '',
    album: item.album || (item.more_info?.album ? { id: item.more_info?.album_id, name: item.more_info.album, url: item.more_info?.album_url } : undefined),
    artists: item.artists || item.more_info?.artistMap || item.more_info?.singers || subtitle || '',
    songCount: item.songCount || item.song_count || item.more_info?.song_count || 0,
    image: item.image || item.image_url || item.artwork || '',
  };
}

function mapNativeHomeCard(item = {}) {
  const normalized = normalizeNativeHomeItem(item);
  const type = String(normalized.type || '').toLowerCase();
  if (type === 'album') return { ...mapSaavnAlbum(normalized), type: 'album', subtitle: normalized.subtitle || normalized.language || 'Album' };
  if (type === 'playlist') return { ...mapSaavnPlaylist(normalized), type: 'playlist', subtitle: normalized.subtitle || normalized.language || 'Playlist' };
  if (type === 'song') return { ...mapSaavnTrack(normalized), type: 'song' };
  if (type === 'channel') return { ...mapSaavnPlaylist(normalized), type: 'playlist', subtitle: normalized.subtitle || 'Mood' };
  return null;
}

async function getNativeMusicHomeSections(language = 'Tamil') {
  const lang = String(language || 'Tamil').toLowerCase();
  const payload = await fetchJioSaavnNative('webapi.getLaunchData', {}, lang);
  return HOME_NATIVE_SECTIONS.map((section) => {
    const moduleTitle = payload?.modules?.[section.sourceKey]?.title;
    let items = Array.isArray(payload?.[section.sourceKey]) ? payload[section.sourceKey] : [];
    if (section.types?.length) items = items.filter((item) => section.types.includes(String(item.type || '').toLowerCase()));
    const mapped = dedupeBy(
      items.map(mapNativeHomeCard).filter(Boolean),
      (item) => `${item.type}:${item.id || item.title}`,
    ).slice(0, section.limit);
    return {
      id: section.id,
      title: moduleTitle || section.title,
      type: 'mixed',
      items: mapped,
    };
  });
}

function sortTamilFirst(items = []) {
  return items.sort((a, b) => {
    const at = String(a.language || '').toLowerCase() === 'tamil' ? 1 : 0;
    const bt = String(b.language || '').toLowerCase() === 'tamil' ? 1 : 0;
    if (at !== bt) return bt - at;
    return Number(b.playCount || 0) - Number(a.playCount || 0);
  });
}

function dedupeTracks(items = []) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = `${String(item.title).toLowerCase()}|${String(item.artists).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function dedupeBy(items = [], keyFn = (item) => item.id || item.title) {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    if (!item) continue;
    const key = String(keyFn(item) || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function searchQueryVariants(query = '') {
  const raw = normalizeWhitespace(query);
  const cleaned = normalizeWhitespace(raw.replace(/\b(albums?|artists?|playlists?|songs?|tracks?|music|movie|soundtrack|ost)\b/gi, ' '));
  return Array.from(new Set([raw, cleaned].filter(Boolean)));
}

export async function searchSongs(query, limit = 12) {
  const payload = await fetchSaavn('/api/search/songs', { query, limit });
  return sortTamilFirst(firstArray(payload).map(mapSaavnTrack).filter((track) => track.title)).slice(0, limit);
}

export async function searchAlbums(query, limit = 12) {
  const payloads = await Promise.all(searchQueryVariants(query).map((variant) => fetchSaavn('/api/search/albums', { query: variant, limit }).catch(() => null)));
  return dedupeBy(
    payloads.flatMap((payload) => firstArray(payload).map(mapSaavnAlbum)).filter((album) => album.title),
    (album) => album.id || `${album.title}|${album.artists}`,
  ).slice(0, limit);
}

export async function searchArtists(query, limit = 12) {
  const override = getTamilDirectorOverride(query);
  const payloads = await Promise.all(searchQueryVariants(query).map((variant) => fetchSaavn('/api/search/artists', { query: variant, limit }).catch(() => null)));
  let items = dedupeBy(
    payloads.flatMap((payload) => firstArray(payload).map(mapSaavnArtist)).filter((artist) => artist.name),
    (artist) => artist.id || artist.name,
  );

  if (override) {
    const imageSource = items.find((artist) => normalizeLookup(artist.name) === 'deva') || items.find((artist) => artist.image);
    const fixed = {
      id: override.id,
      name: override.name,
      image: imageSource?.image || '',
      role: override.role,
      dominantType: override.dominantType,
      dominantLanguage: override.dominantLanguage,
      url: imageSource?.url || '',
    };
    items = [fixed, ...items.filter((artist) => artist.id !== override.id && !override.brokenIds.includes(String(artist.id)) && normalizeLookup(artist.name) !== 'deva')];
  }

  return items.slice(0, limit);
}

export async function searchPlaylists(query, limit = 12) {
  const payloads = await Promise.all(searchQueryVariants(query).map((variant) => fetchSaavn('/api/search/playlists', { query: variant, limit }).catch(() => null)));
  return dedupeBy(
    payloads.flatMap((payload) => firstArray(payload).map(mapSaavnPlaylist)).filter((playlist) => playlist.title),
    (playlist) => playlist.id || playlist.title,
  ).slice(0, limit);
}

export async function getTrending(language = 'Tamil', limit = 24) {
  const lang = String(language || 'Tamil').toLowerCase();
  const nativeItems = await fetchJioSaavnNative('content.getTrending', {}, lang);
  const trending = Array.isArray(nativeItems) ? nativeItems : [];

  const directSongs = trending
    .filter((item) => String(item.type || '').toLowerCase() === 'song')
    .map((item) => mapSaavnTrack(normalizeNativeHomeItem(item)))
    .filter((track) => track.title)
    .filter((track) => String(track.language || '').toLowerCase() === lang);

  const extraSongBuckets = await Promise.all(
    trending
      .filter((item) => ['album', 'playlist'].includes(String(item.type || '').toLowerCase()))
      .slice(0, 10)
      .map(async (item) => {
        try {
          const type = String(item.type || '').toLowerCase();
          const details = type === 'album'
            ? await getAlbumDetails(item.id, item.title || item.name)
            : await getPlaylistDetails(item.id, item.title || item.name);
          return (details.songs || [])
            .filter((track) => String(track.language || '').toLowerCase() === lang)
            .slice(0, 3);
        } catch {
          return [];
        }
      }),
  );

  const items = dedupeTracks(sortTamilFirst([...directSongs, ...extraSongBuckets.flat()]));
  if (items.length) return items.slice(0, limit);

  // Fallback only if the native JioSaavn trending API is unavailable.
  const fallback = await searchSongs(`${language} trending`, limit);
  return fallback.filter((track) => String(track.language || '').toLowerCase() === lang).slice(0, limit);
}

export async function getNewReleases(_language = 'Tamil', limit = 24) {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 1;
  const songQueries = [`Tamil ${currentYear}`, `Tamil latest ${currentYear}`, `new tamil songs ${currentYear}`, 'Think Indie Tamil'];
  const albumQueries = [`Tamil ${currentYear}`, 'Tamil'];

  const [songPayloads, albumPayloads] = await Promise.all([
    Promise.all(songQueries.map((query) => fetchSaavn('/api/search/songs', { query, limit: Math.ceil(limit / 2) }).catch(() => null))),
    Promise.all(albumQueries.map((query) => fetchSaavn('/api/search/albums', { query, limit: 16 }).catch(() => null))),
  ]);

  const tracks = dedupeTracks(
    songPayloads
      .flatMap((payload) => firstArray(payload).map(mapSaavnTrack))
      .filter((track) => track.title)
      .filter((track) => String(track.language || '').toLowerCase() === 'tamil')
      .filter((track) => !track.releaseDate || Number(String(track.releaseDate).slice(0, 4)) >= minYear),
  ).slice(0, limit);

  const albums = albumPayloads
    .flatMap((payload) => firstArray(payload).map(mapSaavnAlbum))
    .filter((item) => item.title)
    .filter((item) => !item.language || String(item.language).toLowerCase() === 'tamil')
    .filter((item) => !item.year || Number(item.year) >= minYear)
    .slice(0, 16);

  return { tracks, albums };
}

export async function getCharts(limit = 16) {
  const payload = await fetchSaavn('/api/search/playlists', { query: 'Tamil', limit });
  return firstArray(payload).map(mapSaavnPlaylist).filter((item) => item.title).slice(0, limit);
}

export function getFallbackTamilArtists() {
  return TAMIL_DIRECTORS.map((name) => {
    const override = getTamilDirectorOverride(name);
    if (override) {
      return {
        id: override.id,
        name: override.name,
        image: '',
        role: override.role,
        dominantType: override.dominantType,
        dominantLanguage: override.dominantLanguage,
        url: '',
      };
    }
    return {
      id: name,
      name,
      image: '',
      role: 'Music Director',
      dominantType: 'music director',
      dominantLanguage: 'tamil',
      url: '',
    };
  });
}

export async function getTamilArtists() {
  const results = await Promise.all(
    TAMIL_DIRECTORS.map((name) => fetchSaavn('/api/search/artists', { query: name, limit: 1 }).catch(() => null)),
  );
  return results.map((payload, index) => {
    const targetName = TAMIL_DIRECTORS[index];
    const override = getTamilDirectorOverride(targetName);
    const item = firstArray(payload)[0] || { name: targetName, role: 'Music Director', dominantType: 'music director', dominantLanguage: 'tamil' };
    const artist = mapSaavnArtist(item);
    if (override) {
      return {
        ...artist,
        id: override.id,
        name: override.name,
        role: override.role,
        dominantType: override.dominantType,
        dominantLanguage: override.dominantLanguage,
      };
    }
    return {
      ...artist,
      id: String(artist.id || targetName),
      name: artist.name || targetName,
      role: artist.role || 'Music Director',
      dominantType: artist.dominantType || 'music director',
      dominantLanguage: artist.dominantLanguage || 'tamil',
    };
  });
}

function hasArtistRole(track, artistName, roleNeedle = 'music') {
  const wanted = normalizeLookup(artistName);
  return (track.artistList || []).some((artist) => normalizeLookup(artist.name) === wanted && String(artist.role || '').toLowerCase().includes(roleNeedle));
}

async function getDevaDetails() {
  const override = TAMIL_DIRECTOR_OVERRIDES.deva;
  const [searchArtistItems, songA, songB, albumItems] = await Promise.all([
    searchArtists('Deva', 4).catch(() => []),
    searchSongs(override.searchName, 50).catch(() => []),
    searchSongs('Deva Tamil 90s', 30).catch(() => []),
    searchAlbums(override.albumQuery, 30).catch(() => []),
  ]);

  const topSongs = dedupeTracks([...songA, ...songB])
    .filter((track) => hasArtistRole(track, 'Deva', 'music') || hasArtistRole(track, override.searchName, 'music'))
    .slice(0, 30);
  const topAlbums = albumItems
    .filter((album) => (album.artistList || []).some((artist) => normalizeLookup(artist.name) === 'deva'))
    .slice(0, 24);
  const image = searchArtistItems.find((artist) => normalizeLookup(artist.name) === 'deva')?.image || searchArtistItems.find((artist) => artist.image)?.image || topAlbums.find((album) => album.image)?.image || topSongs.find((track) => track.image)?.image || '';

  return {
    id: override.id,
    name: override.name,
    image,
    url: searchArtistItems.find((artist) => normalizeLookup(artist.name) === 'deva')?.url || '',
    followerCount: 0,
    fanCount: '',
    dominantLanguage: override.dominantLanguage,
    dominantType: override.dominantType,
    bio: [],
    topSongs,
    singles: [],
    topAlbums,
    similarArtists: [],
    fixedMatch: true,
  };
}

export async function getArtistDetails(id, fallbackName = '') {
  const override = getTamilDirectorOverride(id) || getTamilDirectorOverride(fallbackName);
  if (override?.name === 'Deva') return getDevaDetails();

  try {
    const payload = await fetchSaavn('/api/artists', { id });
    const data = payload?.data || payload;
    if (!data?.id) throw new Error('Artist not found');
    return {
      id: String(data.id),
      name: normalizeWhitespace(data.name || fallbackName || 'Artist'),
      image: imageFrom(data),
      url: data.url || '',
      followerCount: data.followerCount || 0,
      fanCount: data.fanCount || '',
      dominantLanguage: data.dominantLanguage || '',
      dominantType: data.dominantType || '',
      bio: Array.isArray(data.bio) ? data.bio : [],
      topSongs: sortTamilFirst(firstArray(data.topSongs).map(mapSaavnTrack).filter((track) => track.title)),
      singles: sortTamilFirst(firstArray(data.singles).map(mapSaavnTrack).filter((track) => track.title)),
      topAlbums: firstArray(data.topAlbums).map(mapSaavnAlbum).filter((album) => album.title),
      similarArtists: firstArray(data.similarArtists).map(mapSaavnArtist).filter((artist) => artist.name),
    };
  } catch (error) {
    const name = normalizeWhitespace(fallbackName || id || 'Artist');
    const [tracks, albums] = await Promise.all([
      searchSongs(`${name} Tamil`, 24).catch(() => []),
      searchAlbums(`${name} Tamil`, 16).catch(() => []),
    ]);
    return {
      id: String(id || name),
      name,
      image: tracks.find((track) => track.image)?.image || albums.find((album) => album.image)?.image || '',
      dominantLanguage: 'tamil',
      dominantType: 'Music Director',
      topSongs: tracks,
      singles: [],
      topAlbums: albums,
      similarArtists: [],
      fallback: true,
      warning: error.message,
    };
  }
}

export async function getAlbumDetails(id, fallbackTitle = '') {
  try {
    const payload = await fetchSaavn('/api/albums', { id });
    const data = payload?.data || payload;
    if (!data?.id) throw new Error('Album not found');
    return {
      ...mapSaavnAlbum(data),
      songs: firstArray(data.songs).map(mapSaavnTrack).filter((track) => track.title),
    };
  } catch (error) {
    const title = normalizeWhitespace(fallbackTitle || id || 'Album');
    const songs = await searchSongs(`${title} Tamil`, 24).catch(() => []);
    if (!songs.length) throw error;
    return { id: String(id || title), title, artists: songs[0]?.artists || '', image: songs[0]?.image || '', songCount: songs.length, songs, fallback: true, warning: error.message };
  }
}

export async function getPlaylistDetails(id, fallbackTitle = '') {
  try {
    const payload = await fetchSaavn('/api/playlists', { id });
    const data = payload?.data || payload;
    if (!data?.id) throw new Error('Playlist not found');
    return {
      ...mapSaavnPlaylist(data),
      songs: firstArray(data.songs).map(mapSaavnTrack).filter((track) => track.title),
    };
  } catch (error) {
    const title = normalizeWhitespace(fallbackTitle || id || 'Playlist');
    const songs = await searchSongs(`${title} Tamil`, 40).catch(() => []);
    if (!songs.length) throw error;
    return {
      id: String(id || title),
      title,
      image: songs.find((track) => track.image)?.image || '',
      songCount: songs.length,
      songs,
      fallback: true,
      warning: error.message,
    };
  }
}

export async function getMusicHome() {
  const warnings = [];
  const [sections, artists, playlists, releases] = await Promise.all([
    getNativeMusicHomeSections('Tamil').catch(async (error) => {
      warnings.push(`JioSaavn home: ${error.message}`);
      return [
        { id: 'trending-fallback', title: 'Trending Now', type: 'tracks', items: await getTrending('Tamil', 18).catch(() => []) },
        { id: 'new-releases-fallback', title: 'New Releases', type: 'tracks', items: await searchSongs('new tamil songs 2026', 18).catch(() => []) },
      ];
    }),
    getTamilArtists().catch((error) => { warnings.push(`Artists: ${error.message}`); return getFallbackTamilArtists(); }),
    getCharts(16).catch((error) => { warnings.push(`Playlists: ${error.message}`); return []; }),
    getNewReleases('Tamil', 24).catch((error) => { warnings.push(`New releases: ${error.message}`); return { tracks: [], albums: [] }; }),
  ]);

  return { sections, artists: artists?.length ? artists : getFallbackTamilArtists(), playlists, releases, warning: warnings[0] || '', warnings };
}

export async function getSongInfo(seokey) {
  const raw = String(seokey || '').trim();
  if (!raw) throw new Error('Song id is required');
  if (/^(local|spotify|album|playlist|imported):/i.test(raw)) throw new Error('Only JioSaavn songs are supported');
  const id = raw.startsWith('saavn:') ? raw.replace(/^saavn:/, '') : raw;
  const payload = await fetchSaavn(`/api/songs/${encodeURIComponent(id)}`);
  const item = firstArray(payload)[0];
  if (!item) throw new Error('Song not found');
  return mapSaavnTrack(item);
}
