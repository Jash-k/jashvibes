import mongoose from 'mongoose';

const VodStreamSchema = new mongoose.Schema(
  {
    source: { type: String, trim: true, default: 'VOD' },
    label: { type: String, trim: true, default: 'Stream' },
    url: { type: String, required: true, trim: true },
    quality: { type: String, trim: true, default: '' },
    group: { type: String, trim: true, default: '' },
    logo: { type: String, trim: true, default: '' },
    rawTitle: { type: String, trim: true, default: '' },
    format: { type: String, trim: true, default: '' },
    keyId: { type: String, trim: true, default: '' },
    key: { type: String, trim: true, default: '' },
    licenseKey: { type: String, trim: true, default: '' },
    licenseType: { type: String, trim: true, default: '' },
    userAgent: { type: String, trim: true, default: '' },
    referer: { type: String, trim: true, default: '' },
    headers: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const VodItemSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true, trim: true, index: true },
    normalizedTitle: { type: String, required: true, trim: true, index: true },
    type: { type: String, enum: ['movie', 'series', 'other'], default: 'movie', index: true },
    year: { type: Number, index: true },
    releaseDate: { type: Date, index: true },
    tmdbId: { type: Number, index: true },
    tmdbMatched: { type: Boolean, default: false, index: true },
    originalTitle: { type: String, trim: true, default: '' },
    synopsis: { type: String, trim: true, default: '' },
    posterUrl: { type: String, trim: true, default: '' },
    backdropUrl: { type: String, trim: true, default: '' },
    rating: { type: Number, default: 0, index: true },
    voteCount: { type: Number, default: 0, index: true },
    language: { type: String, trim: true, default: '' },
    genres: { type: [String], default: [] },
    sources: { type: [String], default: [], index: true },
    streams: { type: [VodStreamSchema], default: [] },
    syncBatch: { type: String, trim: true, default: '' },
    lastSyncedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

VodItemSchema.index({ rating: -1, year: -1 });
VodItemSchema.index({ year: -1, rating: -1 });
VodItemSchema.index({ title: 'text', originalTitle: 'text', normalizedTitle: 'text' });

export default mongoose.models.VodItem || mongoose.model('VodItem', VodItemSchema);
