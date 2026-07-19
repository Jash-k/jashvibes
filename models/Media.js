import mongoose from 'mongoose';

/**
 * Media catalog/source document.
 *
 * TMDB is used for latest-release metadata. MongoDB stores the authorized
 * playback/source configuration for titles you are allowed to stream.
 */
const SourceSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      trim: true,
      default: 'ScreenScape',
    },
    label: {
      type: String,
      trim: true,
      default: 'Default Source',
    },
    externalId: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const MediaSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: 'Tamil',
    },
    type: {
      type: String,
      enum: ['movie', 'series', 'other'],
      default: 'movie',
      index: true,
    },
    tmdbId: {
      type: Number,
      index: true,
    },
    releaseDate: {
      type: Date,
    },
    synopsis: {
      type: String,
      trim: true,
      default: '',
    },
    posterUrl: {
      type: String,
      trim: true,
      default: '',
    },
    // Backward-compatible single source field.
    externalId: {
      type: String,
      trim: true,
      index: true,
    },
    // New multi-source fallback list. /api/resolve tries these one-by-one.
    sources: {
      type: [SourceSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

MediaSchema.index({ tmdbId: 1, type: 1 });
MediaSchema.index({ title: 1, type: 1 });

export default mongoose.models.Media || mongoose.model('Media', MediaSchema);
