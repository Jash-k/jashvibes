import mongoose from 'mongoose';

/**
 * Lyrics the owner or a viewer supplied for one song — the floor under a
 * provider that cannot have everything. Keyed with the same stable key the
 * lookup cache uses (`lyricCacheKey`), so a saved song is found instantly and
 * keeps working even while LRCLIB is unreachable.
 */
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: '' },
    artist: { type: String, default: '' },
    album: { type: String, default: '' },
    plainLyrics: { type: String, default: '' },
    syncedLyrics: { type: String, default: '' },
    note: { type: String, default: '' },
    origin: { type: String, enum: ['admin', 'user'], default: 'admin' },
  },
  { timestamps: true, minimize: false },
);

export default mongoose.models.LyricsOverride || mongoose.model('LyricsOverride', schema);
