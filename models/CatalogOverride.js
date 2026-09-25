import mongoose from 'mongoose';

/**
 * CatalogOverride — one document per home-catalog row that the owner has
 * touched from the admin panel. One collection powers all three verbs:
 *
 *   hidden  → the row is filtered out of every public catalog read (and
 *             survives every TamilMV re-sync, which a delete cannot).
 *   pinned  → the row floats to the top of the home rails.
 *   title/year/qualityTier → a permanent manual correction for a misparsed
 *             release name, applied at read time.
 *
 * The key is stable across syncs: `type + the RAW scraped release title`
 * (the unparsed forum string), because parsed titles are exactly the thing
 * that can change between scrapes.
 */
const CatalogOverrideSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['movie', 'series'], default: 'movie' },
    rawTitle: { type: String, default: '' },
    title: { type: String, default: '' },
    hidden: { type: Boolean, default: false },
    pinned: { type: Boolean, default: false },
    titleOverride: { type: String, default: '' },
    yearOverride: { type: String, default: '' },
    qualityOverride: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

export default mongoose.models.CatalogOverride ||
  mongoose.model('CatalogOverride', CatalogOverrideSchema);
