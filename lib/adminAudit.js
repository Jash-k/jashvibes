import dbConnect from '@/lib/db';
import AdminAction from '@/models/AdminAction';
import { resolveUndoTarget } from '@/lib/adminModels';

/**
 * adminAudit — record every mutation the panel makes, and undo one.
 *
 * Two rules keep this honest rather than decorative:
 *
 *   1. **Recording never breaks the mutation.** If the audit write fails (Mongo hiccup, a
 *      collection that does not exist yet), the change still succeeded — so the failure is
 *      logged and swallowed. An audit trail that can veto an edit is worse than no trail.
 *   2. **`reversible: false` means it.** Re-scrapes, purges and imports are recorded but the
 *      panel will not offer an undo, because "undo a sync" is not a thing anyone can deliver
 *      truthfully — the upstream list has already moved.
 *
 * Undo is mechanical because the snapshots are the *documents*: restore `before`, or delete the
 * document when `before` is null (i.e. the action created it). No per-action undo code to rot.
 *
 * The one exception is a *move* — an override re-bound from an orphaned key to a live one. There
 * `before` lives under a different key than `after`, so undoing must restore the old document
 * **and** remove the new copy; that is what `alsoDelete` carries. Nothing guesses: an action either
 * has that field or it does not.
 */

/** Actions that cannot be undone, with the reason shown in the UI. */
export const IRREVERSIBLE = {
  'catalog.sync': 'A re-scrape cannot be undone — the upstream list has already changed. Run the sync again to refresh.',
  'catalog.purge': 'The cache was dropped. It rebuilds on the next read, but not to the exact previous bytes.',
  'vault.sync': 'A vault sync cannot be undone.',
  'live.sync': 'A live source sync cannot be undone.',
  'extras.import': 'An import cannot be undone.',
};

/**
 * @param {{ area: string, action: string, summary?: string, target?: { kind?: string, key?: string, label?: string },
 *           before?: object|null, after?: object|null, targetModel?: string, reversible?: boolean, actor?: string }} entry
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>} — ok:false is logged, never thrown
 */
export async function recordAction(entry = {}) {
  try {
    await dbConnect();
    const action = String(entry.action || '').trim();
    if (!action) return { ok: false, error: 'an action needs a name' };
    const reversible = entry.reversible !== undefined ? Boolean(entry.reversible) : !IRREVERSIBLE[action];
    const doc = await AdminAction.create({
      at: new Date(),
      actor: entry.actor || 'admin',
      area: entry.area || 'catalog',
      action,
      summary: entry.summary || '',
      target: {
        kind: entry.target?.kind || '',
        key: entry.target?.key || '',
        label: entry.target?.label || '',
      },
      before: entry.before ?? null,
      after: entry.after ?? null,
      alsoDelete: {
        targetModel: entry.alsoDelete?.targetModel || '',
        key: entry.alsoDelete?.key || '',
      },
      targetModel: entry.targetModel || '',
      reversible,
    });
    return { ok: true, id: String(doc._id) };
  } catch (error) {
    // Never let the trail break the change it is describing.
    console.error('[admin-audit] could not record', entry.action, error.message);
    return { ok: false, error: error.message };
  }
}

/** The history list, newest first, with an optional area/target filter. */
export async function listActions({ area = '', targetKey = '', limit = 60 } = {}) {
  await dbConnect();
  const query = {};
  if (area) query.area = area;
  if (targetKey) query['target.key'] = targetKey;
  const docs = await AdminAction.find(query)
    .sort({ at: -1 })
    .limit(Math.min(Number(limit) || 60, 200))
    .lean()
    .catch(() => []);
  return docs.map((doc) => ({
    id: String(doc._id),
    at: doc.at,
    actor: doc.actor || 'admin',
    area: doc.area,
    action: doc.action,
    summary: doc.summary || '',
    target: doc.target || {},
    reversible: doc.reversible !== false && !doc.revertedAt && Boolean(resolveUndoTarget(doc.targetModel)),
    revertedAt: doc.revertedAt || null,
    // The snapshots stay server-side: the list is a UI payload, not a data export.
    hasBefore: doc.before !== null && doc.before !== undefined,
    hasAfter: doc.after !== null && doc.after !== undefined,
  }));
}

/**
 * Undo one action: write its `before` snapshot back over the document it touched, or delete the
 * document when the action created it. The per-collection key field comes from
 * `lib/adminModels.js`, so this stays one implementation for every tab.
 *
 * Refuses (with a reason) when the action was already undone, was recorded as irreversible, or
 * when the collection has no restore path — never a silent no-op.
 */
export async function undoAction(id) {
  await dbConnect();
  const doc = await AdminAction.findById(id).lean().catch(() => null);
  if (!doc) return { ok: false, error: 'That action is no longer in the history.' };
  if (doc.revertedAt) return { ok: false, error: 'That action was already undone.' };
  if (doc.reversible === false) {
    return { ok: false, error: IRREVERSIBLE[doc.action] || 'That action cannot be undone.' };
  }
  const target = resolveUndoTarget(doc.targetModel);
  if (!target) return { ok: false, error: `No restore path is registered for "${doc.targetModel || 'this record'}".` };

  const filter = restoreFilter(doc, target.keyField);
  if (!filter) return { ok: false, error: 'That action has no target key, so it cannot be restored.' };

  try {
    if (doc.before === null || doc.before === undefined) {
      // The action created the document; undoing it removes it. (`Setting` is never created here —
      // its value is rewritten below — so this branch is for records, not for whole registries.)
      await target.Model.deleteOne(filter);
    } else {
      await target.Model.updateOne(filter, { $set: { ...doc.before } }, { upsert: true });
    }
    // A move left a copy at the new key; undo removes it, or the re-bind would look half-undone.
    if (doc.alsoDelete?.targetModel && doc.alsoDelete?.key) {
      const moved = resolveUndoTarget(doc.alsoDelete.targetModel);
      if (moved) await moved.Model.deleteOne({ [moved.keyField]: doc.alsoDelete.key });
    }
    await AdminAction.updateOne({ _id: doc._id }, { $set: { revertedAt: new Date(), revertedBy: 'undo' } });
    return { ok: true, action: doc.action, summary: doc.summary || '' };
  } catch (error) {
    return { ok: false, error: error.message || 'Undo failed' };
  }
}

/** Pure, so the test can prove the mapping without a database. */
export function restoreFilter(doc, keyField = 'key') {
  const raw = doc?.target?.key;
  if (raw === undefined || raw === null || raw === '') return null;
  if (keyField === '_id') return { _id: raw };
  return { [keyField]: raw };
}

/** The label the history list shows for an action, and whether Undo may be offered. */
export function actionBadge(doc = {}) {
  if (doc.revertedAt) return { label: 'Undone', undoable: false, reason: 'Already undone.' };
  if (doc.reversible === false) return { label: 'Not reversible', undoable: false, reason: IRREVERSIBLE[doc.action] || 'This action cannot be undone.' };
  return { label: 'Undoable', undoable: true, reason: '' };
}
