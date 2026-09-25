import mongoose from 'mongoose';

/** Stremio addon registry (admin-managed; STREMIO/STREMIO_WATCH env are only first-run seeds). */
const StremioAddonSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    manifestUrl: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['catalog', 'watch'], default: 'catalog' },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    addonName: { type: String, default: '' },
    catalogCount: { type: Number, default: 0 },
    lastStatus: { type: String, enum: ['ok', 'error', 'unknown'], default: 'unknown' },
    lastError: { type: String, default: '' },
    lastCheckedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

StremioAddonSchema.index({ manifestUrl: 1, kind: 1 }, { unique: true });

export default mongoose.models.StremioAddon || mongoose.model('StremioAddon', StremioAddonSchema);
