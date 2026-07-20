import dbConnect from '@/lib/db';
import MusicPlaylist from '@/models/MusicPlaylist';

function publicPlaylist(doc) {
  if (!doc) return null;
  const id = String(doc._id || doc.id || '');
  return {
    id: `local:${id}`,
    localId: id,
    source: doc.source || 'spotify',
    sourceUrl: doc.sourceUrl || '',
    spotifyId: doc.spotifyId || '',
    title: doc.title || 'Imported Playlist',
    image: doc.image || '',
    subtitle: `${doc.matchedCount || 0} matched${doc.unmatchedCount ? ` • ${doc.unmatchedCount} unmatched` : ''}`,
    description: doc.description || '',
    songCount: doc.matchedCount || doc.tracks?.length || 0,
    totalCount: doc.trackCount || 0,
    matchedCount: doc.matchedCount || 0,
    unmatchedCount: doc.unmatchedCount || 0,
    owner: doc.owner || 'Spotify',
    isImported: true,
    isDefault: doc.isDefault !== false,
    sortOrder: doc.sortOrder ?? 999,
    updatedAt: doc.updatedAt || doc.lastImportedAt || null,
  };
}

function cleanSaavnTrack(track) {
  const item = track?.saavn || track;
  if (!item?.seokey && !item?.id) return null;
  return {
    ...item,
    spotify: track?.spotify || null,
    importScore: track?.score || 0,
  };
}

export async function listImportedPlaylists({ includeHidden = false } = {}) {
  await dbConnect();
  const filter = includeHidden ? {} : { isDefault: { $ne: false } };
  const docs = await MusicPlaylist.find(filter)
    .sort({ sortOrder: 1, updatedAt: -1, title: 1 })
    .select('source sourceUrl spotifyId title description image owner trackCount matchedCount unmatchedCount isDefault sortOrder updatedAt lastImportedAt')
    .lean();
  return docs.map(publicPlaylist).filter(Boolean);
}

export async function getImportedPlaylistDetails(id = '') {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const doc = await MusicPlaylist.findById(localId).lean();
  if (!doc) throw new Error('Imported playlist not found');
  const songs = (doc.tracks || []).map(cleanSaavnTrack).filter(Boolean);
  return {
    ...publicPlaylist(doc),
    type: 'playlist',
    songs,
    tracks: songs,
    unmatched: doc.unmatched || [],
  };
}

export async function updateImportedPlaylist(id = '', patch = {}) {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const set = {};
  if (patch.title !== undefined) set.title = String(patch.title || '').trim().slice(0, 160) || 'Imported Playlist';
  if (patch.description !== undefined) set.description = String(patch.description || '').trim().slice(0, 500);
  if (patch.image !== undefined) set.image = String(patch.image || '').trim();
  if (patch.sortOrder !== undefined) set.sortOrder = Number(patch.sortOrder) || 999;
  if (patch.isDefault !== undefined) set.isDefault = Boolean(patch.isDefault);
  const doc = await MusicPlaylist.findByIdAndUpdate(localId, { $set: set }, { new: true }).lean();
  if (!doc) throw new Error('Imported playlist not found');
  return publicPlaylist(doc);
}

export async function deleteImportedPlaylist(id = '') {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const result = await MusicPlaylist.deleteOne({ _id: localId });
  return { deleted: result.deletedCount > 0 };
}

export async function upsertImportedPlaylist(payload = {}) {
  await dbConnect();
  const filter = { source: payload.source || 'spotify', sourceUrl: payload.sourceUrl };
  const doc = await MusicPlaylist.findOneAndUpdate(
    filter,
    {
      $set: {
        ...payload,
        source: payload.source || 'spotify',
        sortOrder: payload.sortOrder ?? 999,
        isDefault: payload.isDefault !== false,
        lastImportedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  ).lean();
  return publicPlaylist(doc);
}

export async function removeImportedPlaylistTrack(id = '', trackKey = '') {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const doc = await MusicPlaylist.findById(localId);
  if (!doc) throw new Error('Imported playlist not found');
  const key = String(trackKey || '');
  doc.tracks = (doc.tracks || []).filter((track) => {
    const candidates = [track?.saavn?.seokey, track?.saavn?.id, track?.saavn?.trackId, track?.spotify?.id, String(track?.order || '')].filter(Boolean).map(String);
    return !candidates.includes(key);
  });
  doc.matchedCount = doc.tracks.length;
  doc.trackCount = doc.tracks.length + (doc.unmatched?.length || 0);
  doc.lastImportedAt = new Date();
  await doc.save();
  return getImportedPlaylistDetails(localId);
}

export async function addImportedPlaylistTrack(id = '', saavnTrack = {}, spotify = {}, score = 999) {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const doc = await MusicPlaylist.findById(localId);
  if (!doc) throw new Error('Imported playlist not found');
  const key = saavnTrack.seokey || saavnTrack.id || saavnTrack.trackId;
  if (!key) throw new Error('Valid JioSaavn track is required');
  const exists = (doc.tracks || []).some((track) => [track?.saavn?.seokey, track?.saavn?.id, track?.saavn?.trackId].filter(Boolean).map(String).includes(String(key)));
  if (!exists) {
    doc.tracks.push({
      order: (doc.tracks?.length || 0) + 1,
      spotify: spotify.title ? spotify : { title: saavnTrack.title, artists: String(saavnTrack.artists || '').split(',').map((x) => x.trim()).filter(Boolean), album: saavnTrack.album, image: saavnTrack.image },
      saavn: saavnTrack,
      matched: true,
      score,
      query: saavnTrack.title || '',
    });
  }
  doc.matchedCount = doc.tracks.length;
  doc.trackCount = doc.tracks.length + (doc.unmatched?.length || 0);
  doc.lastImportedAt = new Date();
  await doc.save();
  return getImportedPlaylistDetails(localId);
}

export async function replaceImportedPlaylistTrack(id = '', trackKey = '', saavnTrack = {}, spotify = {}, score = 999) {
  await dbConnect();
  const localId = String(id || '').replace(/^local:/, '').replace(/^imported:/, '');
  const doc = await MusicPlaylist.findById(localId);
  if (!doc) throw new Error('Imported playlist not found');
  const key = String(trackKey || '');
  const index = (doc.tracks || []).findIndex((track) => {
    const candidates = [track?.saavn?.seokey, track?.saavn?.id, track?.saavn?.trackId, track?.spotify?.id, String(track?.order || '')].filter(Boolean).map(String);
    return candidates.includes(key);
  });
  if (index < 0) throw new Error('Track not found in playlist');
  const existing = doc.tracks[index];
  doc.tracks[index] = {
    order: existing.order || index + 1,
    spotify: spotify.title ? spotify : existing.spotify,
    saavn: saavnTrack,
    matched: true,
    score,
    query: saavnTrack.title || existing.query || '',
  };
  doc.matchedCount = doc.tracks.length;
  doc.trackCount = doc.tracks.length + (doc.unmatched?.length || 0);
  doc.lastImportedAt = new Date();
  await doc.save();
  return getImportedPlaylistDetails(localId);
}
