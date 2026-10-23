import mongoose from 'mongoose';

const LiveSourceSchema = new mongoose.Schema({
  sourceId: { type: String, required: true, unique: true, index: true },
  label: { type: String, required: true },
  type: { type: String, enum: ['m3u', 'json'], default: 'm3u' },
  url: { type: String, required: true },
  deleted: { type: Boolean, default: false, index: true },
  enabled: { type: Boolean, default: true, index: true },
  trustTamil: { type: Boolean, default: false },
  priority: { type: Number, default: 99, index: true },
  headers: { type: Object, default: {} },
  autoPurge: { type: Boolean, default: false },
  titleFilter: { type: String, default: '' },
  // Catalog a newly synced channel from this source is dropped into so it is
  // visible straight away. Empty = the administrator maps it by hand, which is
  // the default for every source. Only ever applied when the channel row is
  // first inserted, so it can never overwrite a manual mapping.
  autoMapCatalog: { type: String, default: '' },
  channelCount: { type: Number, default: 0 },
  selectedCount: { type: Number, default: 0 },
  mappedCount: { type: Number, default: 0 },
  lastSyncedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.models.LiveSource || mongoose.model('LiveSource', LiveSourceSchema);
