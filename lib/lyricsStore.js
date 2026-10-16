import dbConnect from '@/lib/db';
import LyricsCache from '@/models/LyricsCache';
import LyricsOverride from '@/models/LyricsOverride';
import { lyricCacheKey, LYRICS_MATCH_VERSION } from './lyricsMatch.js';

/*
 * Every function here fails soft. A lyric lookup that cannot reach MongoDB must
 * still return lyrics: the database is an accelerator and a place to keep the
 * owner's own text, never a dependency on the critical path. (This is the
 * opposite of the Vault, where a failed read must fail closed so hidden rows
 * cannot leak.)
 */

/** Lyrics do not change; a miss might (the provider is community-fed). */
const OK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 12 * 60 * 60 * 1000;

export const lyricsSongKey = (song = {}) => lyricCacheKey(song);

export async function readLyricsOverride(song = {}) {
  try {
    await dbConnect();
    const doc = await LyricsOverride.findOne({ key: lyricsSongKey(song) }).lean();
    if (!doc) return null;
    if (!doc.plainLyrics && !doc.syncedLyrics) return null;
    return doc;
  } catch { return null; }
}

export async function saveLyricsOverride(song = {}, { plainLyrics = '', syncedLyrics = '', note = '', origin = 'admin' } = {}) {
  await dbConnect();
  const key = lyricsSongKey(song);
  const update = {
    key,
    title: String(song.title || '').slice(0, 300),
    artist: String(song.artist || '').slice(0, 300),
    album: String(song.album || '').slice(0, 300),
    plainLyrics: String(plainLyrics || '').slice(0, 200000),
    syncedLyrics: String(syncedLyrics || '').slice(0, 200000),
    note: String(note || '').slice(0, 2000),
    origin: origin === 'user' ? 'user' : 'admin',
  };
  if (!update.plainLyrics && !update.syncedLyrics) throw Object.assign(new Error('Paste the lyrics text first.'), { status: 400 });
  await LyricsOverride.updateOne({ key }, { $set: update }, { upsert: true });
  // A saved song is authoritative from now on: drop any cached provider answer.
  await LyricsCache.deleteOne({ key }).catch(() => {});
  return key;
}

export async function listLyricsOverrides({ q = '', page = 1, limit = 50 } = {}) {
  await dbConnect();
  const filter = q
    ? { $or: [{ title: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { artist: new RegExp(q, 'i') }, { key: new RegExp(q, 'i') }] }
    : {};
  const size = Math.max(1, Math.min(200, Number(limit) || 50));
  const current = Math.max(1, Number(page) || 1);
  const [items, total] = await Promise.all([
    LyricsOverride.find(filter).sort({ updatedAt: -1 }).skip((current - 1) * size).limit(size).lean(),
    LyricsOverride.countDocuments(filter),
  ]);
  return { items, total, page: current, pages: Math.max(1, Math.ceil(total / size)) };
}

export async function deleteLyricsOverride(key = '') {
  await dbConnect();
  const result = await LyricsOverride.deleteOne({ key: String(key) });
  return result.deletedCount === 1;
}

export async function listLyricsMisses({ limit = 50 } = {}) {
  try {
    await dbConnect();
    return await LyricsCache.find({ status: 'none' }).sort({ updatedAt: -1 }).limit(Math.max(1, Math.min(200, Number(limit) || 50))).lean();
  } catch { return []; }
}

export async function readLyricsCache(song = {}) {
  try {
    await dbConnect();
    const doc = await LyricsCache.findOne({ key: lyricsSongKey(song) }).lean();
    if (!doc || doc.matchVersion !== LYRICS_MATCH_VERSION) return null;
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) return null;
    return doc;
  } catch { return null; }
}

export async function writeLyricsCache(song = {}, { status, payload = null, reason = '', list = null, autoId = '' } = {}) {
  try {
    await dbConnect();
    // `list` is the same lookup's other records: one call answers the stage and the panel, and both
    // halves of that answer are remembered under the one key so neither is ever asked for twice.
    await LyricsCache.updateOne(
      { key: lyricsSongKey(song) },
      { $set: { key: lyricsSongKey(song), status: status === 'ok' ? 'ok' : 'none', matchVersion: LYRICS_MATCH_VERSION,
        payload, list: Array.isArray(list) ? list : null, autoId: String(autoId || '').slice(0, 40),
        reason: String(reason || '').slice(0, 300),
        song: { title: String(song.title || '').slice(0, 300), artist: String(song.artist || '').slice(0, 300), album: String(song.album || '').slice(0, 300), id: String(song.id || '').slice(0, 80) }, expiresAt: new Date(Date.now() + (status === 'ok' ? OK_TTL_MS : MISS_TTL_MS)) } },
      { upsert: true },
    );
  } catch { /* cache write is best-effort */ }
}
