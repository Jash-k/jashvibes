import mongoose from 'mongoose';

/** ReTro classics source (admin-managed; the VOD env/hardcoded list is only the first-run seed). */
const VodSourceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 100 },
    lastSyncAt: { type: Date, default: null },
    lastError: { type: String, default: '' },
    itemCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

VodSourceSchema.index({ url: 1 }, { unique: true });

export default mongoose.models.VodSource || mongoose.model('VodSource', VodSourceSchema);
