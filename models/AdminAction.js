import mongoose from 'mongoose';

/**
 * AdminAction — one document per mutation made from the admin panel.
 *
 * Why this exists: every control in the panel was silent and permanent. `CatalogOverride`
 * kept an `updatedAt` and nothing else, so "why is this title like this?" had no answer and
 * "put it back" had no mechanism. One append-only collection gives both:
 *
 *   before / after   a JSON snapshot of the affected document (or null when it did not exist).
 *                    Undo is then mechanical: write `before` back, or delete when `before` is null.
 *   reversible       false for actions that cannot be undone — a re-scrape, a cache purge, an
 *                    import. Those are still recorded; the UI just refuses to offer an undo
 *                    instead of pretending.
 *   revertedAt       set when an action has been undone, so the history reads correctly and the
 *                    same action cannot be undone twice.
 *
 * The collection is indexed by time (newest first is the only reading order) and by target, so
 * "show me everything that ever touched this row" is one query.
 */
const AdminActionSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now, index: true },
    actor: { type: String, default: '' },          // 'admin' — sessions are single-owner today
    area: { type: String, default: 'catalog', index: true }, // catalog | vault | live | music | stremio | extras | retro | lyrics | system
    action: { type: String, required: true },      // 'catalog.hide', 'vault.visibility', …
    summary: { type: String, default: '' },        // one line for the history list
    target: {
      kind: { type: String, default: '' },         // 'catalog-row' | 'vault-item' | 'channel' | …
      key: { type: String, default: '', index: true },
      label: { type: String, default: '' },        // what a human calls it
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
    targetModel: { type: String, default: '' },    // which model the snapshots belong to (`collection` is reserved by Mongoose)
    // Undoing a *move* (a re-bound key) needs the new copy removed as well as the old one restored,
    // because they are two different documents. Empty for every ordinary edit.
    alsoDelete: {
      targetModel: { type: String, default: '' },
      key: { type: String, default: '' },
    },
    reversible: { type: Boolean, default: true },
    revertedAt: { type: Date, default: null },
  },
  { timestamps: false },
);

AdminActionSchema.index({ at: -1 });

export default mongoose.models.AdminAction || mongoose.model('AdminAction', AdminActionSchema);
