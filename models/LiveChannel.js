import mongoose from 'mongoose';
import { bumpLiveCatalog } from '@/lib/catalogVersion';
import { LIVE_CATALOG_IDS } from '@/lib/liveCatalogs';

const LiveCatalogMembershipSchema = new mongoose.Schema({
  catalogId: { type: String, required: true, enum: LIVE_CATALOG_IDS },
  position: { type: Number, default: 9999, min: 0 },
}, { _id: false });

/*
 * F1 — index hygiene.
 *
 * Ten standalone indexes were dropped: `mappingManaged`, `logicalChannelId`, `format`, `selected`, `favorite`, `hidden`, `order`, `workingStatus`, `lastSeenAt`, `importHash`.
 * Each was either never used as a query filter at all, or was already covered as a
 * prefix of the {selected, hidden, order} compound. They were pure write cost: the
 * hourly sync rewrites every channel in the collection, and every upsert maintained
 * indexes no query ever touched.
 *
 * Kept, because a real query needs them:
 *   channelId (unique upsert key), sourceId, name + normalizedName (the Admin `q`
 *   regex search), category (Admin distinct + filter), profiles (the Live TV read).
 */

const LiveChannelSchema = new mongoose.Schema({
  channelId: { type: String, required: true, unique: true, index: true },
  sourceId: { type: String, required: true, index: true },
  source: { type: String, default: '' },
  tvgId: { type: String, default: '' },
  sourceTvgId: { type: String, default: '' },
  epgOverride: { type: String, default: null },
  mappingManaged: { type: Boolean, default: false },
  // Set an identical nonempty ID only for explicitly mapped same-channel alternatives.
  logicalChannelId: { type: String, default: '' },
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
  format: { type: String, default: 'unknown' },
  playable: { type: Boolean, default: true },
  selected: { type: Boolean, default: false },
  favorite: { type: Boolean, default: false },
  hidden: { type: Boolean, default: false },
  order: { type: Number, default: 9999 },
  profiles: { type: [String], default: ['default'], index: true },
  keyId: { type: String, default: '' },
  key: { type: String, default: '' },
  licenseKey: { type: String, default: '' },
  licenseType: { type: String, default: '' },
  cookie: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  referer: { type: String, default: '' },
  headers: { type: Object, default: {} },
  workingStatus: { type: String, enum: ['unknown', 'working', 'broken'], default: 'unknown' },
  // Health is independent of the desired catalogue. Never erase memberships.
  failStreak: { type: Number, default: 0 },
  autoHidden: { type: Boolean, default: false },
  lastCheckedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: Date.now },
  importHash: { type: String, default: '' },
}, { timestamps: true, optimisticConcurrency: true });

LiveChannelSchema.index({ sourceId: 1, normalizedName: 1 });
LiveChannelSchema.index({ selected: 1, hidden: 1, order: 1 });
LiveChannelSchema.index({ 'catalogs.catalogId': 1, 'catalogs.position': 1 });
LiveChannelSchema.index({ sourceId: 1, 'catalogs.catalogId': 1 });


/* A3 — invalidate the cached Live catalogue on any write to this collection.
 *
 * Every write path (Admin panel, hourly auto-sync, onboarding, import, self-heal)
 * invalidates automatically, so no route has to remember to. `bulkWrite` fires this
 * once per operation, not once per document, so a 2 800-row sync costs one bump.
 */
const INVALIDATING_HOOKS = [
  'save', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate',
  'deleteOne', 'deleteMany', 'findOneAndDelete', 'findOneAndReplace', 'bulkWrite',
];
for (const hook of INVALIDATING_HOOKS) {
  LiveChannelSchema.post(hook, bumpLiveCatalog);
}

export default mongoose.models.LiveChannel || mongoose.model('LiveChannel', LiveChannelSchema);
