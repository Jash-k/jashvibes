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
VodItemSchema.index(
  { title: 'text', originalTitle: 'text', normalizedTitle: 'text' },
  {
    name: 'vod_text_search',
    default_language: 'none',
    // MongoDB treats a document field named `language` as text-index language
    // override by default. Our TMDB language values are ISO codes like `ta`,
    // which MongoDB text search does not support, causing writes to fail with:
    // `language override unsupported: ta`. Point the override to a field we do
    // not use so every document indexes with default_language instead.
    language_override: 'textLanguageOverride',
  },
);

const VodItem = mongoose.models.VodItem || mongoose.model('VodItem', VodItemSchema);

export async function ensureVodTextIndexSafe() {
  const indexes = await VodItem.collection.indexes().catch(() => []);
  const textIndexes = indexes.filter((index) => Object.values(index.key || {}).includes('text'));
  for (const index of textIndexes) {
    const unsafeLanguageOverride = !index.language_override || index.language_override === 'language';
    const wrongName = index.name !== 'vod_text_search';
    if (unsafeLanguageOverride || wrongName) {
      await VodItem.collection.dropIndex(index.name).catch(() => {});
    }
  }

  await VodItem.collection.createIndex(
    { title: 'text', originalTitle: 'text', normalizedTitle: 'text' },
    { name: 'vod_text_search', default_language: 'none', language_override: 'textLanguageOverride' },
  );
}

export default VodItem;
