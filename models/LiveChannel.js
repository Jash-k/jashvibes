import mongoose from 'mongoose';
import { LIVE_CATALOG_IDS } from '@/lib/liveCatalogs';

const LiveCatalogMembershipSchema = new mongoose.Schema({
  catalogId: { type: String, required: true, enum: LIVE_CATALOG_IDS },
  position: { type: Number, default: 9999, min: 0 },
}, { _id: false });

const LiveChannelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  sourceId: { type: String, required: true, index: true },
  source: { type: String, default: '' },
  tvgId: { type: String, default: '' },
  name: { type: String, required: true, index: true },
  normalizedName: { type: String, index: true },
  customName: { type: String, default: '' },
  url: { type: String, required: true },
  logo: { type: String, default: '' },
  customLogo: { type: String, default: '' },
  // The source's original group/category is preserved for service-panel filtering.
  category: { type: String, default: 'Live', index: true },
  // Only manually assigned catalog memberships are published to the main Live TV panel.
  // A channel can belong to multiple fixed catalogs and have a different position in each.
  catalogs: { type: [LiveCatalogMembershipSchema], default: [] },
  language: { type: String, default: '' },
  region: { type: String, default: '' },
  format: { type: String, default: 'unknown', index: true },
  playable: { type: Boolean, default: true },
  selected: { type: Boolean, default: false, index: true },
  favorite: { type: Boolean, default: false, index: true },
  hidden: { type: Boolean, default: false, index: true },
  order: { type: Number, default: 9999, index: true },
  profiles: { type: [String], default: ['default'], index: true },
  keyId: { type: String, default: '' },
  key: { type: String, default: '' },
  licenseKey: { type: String, default: '' },
  licenseType: { type: String, default: '' },
  cookie: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  referer: { type: String, default: '' },
  headers: { type: Object, default: {} },
  workingStatus: { type: String, enum: ['unknown', 'working', 'broken'], default: 'unknown', index: true },
  lastCheckedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: Date.now, index: true },
  importHash: { type: String, default: '', index: true },
}, { timestamps: true });

LiveChannelSchema.index({ sourceId: 1, normalizedName: 1 });
LiveChannelSchema.index({ selected: 1, hidden: 1, order: 1 });
LiveChannelSchema.index({ 'catalogs.catalogId': 1, 'catalogs.position': 1 });
LiveChannelSchema.index({ sourceId: 1, 'catalogs.catalogId': 1 });

export default mongoose.models.LiveChannel || mongoose.model('LiveChannel', LiveChannelSchema);
