import mongoose from 'mongoose';

/**
 * Persistent lyric lookup cache, shared by every server instance and surviving
 * deploys — the thing the old in-process Map could not do. One document per
 * song signature; misses are cached too (shorter TTL) so a song LRCLIB does not
 * have is not re-asked on every play.
 *
 * `expiresAt` carries a TTL index: MongoDB removes the document itself, so no
 * cleanup job is needed.
 */
const schema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['ok', 'none'], required: true },
    matchVersion: { type: Number, default: 0 },
    payload: { type: mongoose.Schema.Types.Mixed, default: null },
    // Every record the one search returned for this song, in the order the panel shows them
    // (this song's own records first), plus the id the matcher chose. Stored with the payload so
    // a song that has been looked up once never needs the provider again to fill the list.
    list: { type: mongoose.Schema.Types.Mixed, default: null },
    autoId: { type: String, default: '' },
    reason: { type: String, default: '' },
    song: { type: mongoose.Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.LyricsCache || mongoose.model('LyricsCache', schema);
