import mongoose from 'mongoose';

/**
 * Global Stremio shelf pins. One row per pinned catalog, ordered by sortOrder —
 * the shelf every device sees. The per-device localStorage copy stays as an
 * offline fallback only.
 */
const StremioPinSchema = new mongoose.Schema(
  {
    catalogKey: { type: String, required: true, unique: true, index: true },
    sortOrder: { type: Number, default: 100 },
  },
  { timestamps: true },
);

export default mongoose.models.StremioPin || mongoose.model('StremioPin', StremioPinSchema);
