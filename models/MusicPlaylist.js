import mongoose from 'mongoose';

const SpotifyTrackSchema = new mongoose.Schema(
  {
    id: String,
    title: String,
    artists: [String],
    album: String,
    image: String,
    durationMs: Number,
    url: String,
  },
  { _id: false },
);

const ImportedTrackSchema = new mongoose.Schema(
  {
    order: Number,
    spotify: SpotifyTrackSchema,
    saavn: mongoose.Schema.Types.Mixed,
    matched: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    query: String,
  },
  { _id: false },
);

const MusicPlaylistSchema = new mongoose.Schema(
  {
    source: { type: String, default: 'spotify', index: true },
    sourceUrl: { type: String, required: true, index: true },
    spotifyId: { type: String, index: true },
    title: { type: String, required: true, index: true },
    description: String,
    image: String,
    owner: String,
    tracks: [ImportedTrackSchema],
    unmatched: [ImportedTrackSchema],
    trackCount: { type: Number, default: 0 },
    matchedCount: { type: Number, default: 0 },
    unmatchedCount: { type: Number, default: 0 },
    isDefault: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 999, index: true },
    lastImportedAt: Date,
  },
  { timestamps: true },
);

MusicPlaylistSchema.index({ source: 1, sourceUrl: 1 }, { unique: true });
MusicPlaylistSchema.index({ title: 'text', description: 'text', owner: 'text' });

export default mongoose.models.MusicPlaylist || mongoose.model('MusicPlaylist', MusicPlaylistSchema);
