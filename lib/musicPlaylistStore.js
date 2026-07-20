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
