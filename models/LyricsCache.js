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
    reason: { type: String, default: '' },
    song: { type: mongoose.Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.LyricsCache || mongoose.model('LyricsCache', schema);
