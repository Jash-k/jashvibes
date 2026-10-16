import CatalogOverride from '@/models/CatalogOverride';
import VaultOverride from '@/models/VaultOverride';
import LyricsOverride from '@/models/LyricsOverride';
import StremioAddon from '@/models/StremioAddon';
import VodItem from '@/models/VodItem';
import VodSource from '@/models/VodSource';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import MusicPlaylist from '@/models/MusicPlaylist';
import Setting from '@/models/Setting';

/**
 * The restore map for undo.
 *
 * Every overridable record in this app is a single document keyed by one field, so undo is the
 * same operation everywhere: find the document by its key and write the `before` snapshot back,
 * or delete it when the action created it. This file is the only place that knows which field
 * that is per collection — the audit module stays generic, and a new area becomes undoable by
 * adding one line here.
 *
 * `Setting` is the odd one out on purpose: the Extras registry and the auto-sync configuration
 * live in single settings documents whose *whole value* is the payload, so the snapshot is the
 * value itself and undo rewrites it whole. That is the correct granularity for a list you can
 * reorder — undoing "add website X" must not lose "reorder Y" that happened in the same request.
 */
export const UNDO_TARGETS = {
  CatalogOverride: { Model: CatalogOverride, keyField: 'key' },
  VaultOverride: { Model: VaultOverride, keyField: 'id' },
  LyricsOverride: { Model: LyricsOverride, keyField: 'key' },
  StremioAddon: { Model: StremioAddon, keyField: '_id' },
  VodItem: { Model: VodItem, keyField: '_id' },
  VodSource: { Model: VodSource, keyField: '_id' },
  LiveSource: { Model: LiveSource, keyField: 'sourceId' },
  LiveChannel: { Model: LiveChannel, keyField: 'channelId' },
  MusicPlaylist: { Model: MusicPlaylist, keyField: '_id' },
  Setting: { Model: Setting, keyField: 'key' },
};

export function resolveUndoTarget(collection = '') {
  return UNDO_TARGETS[collection] || null;
}

export const UNDOABLE_COLLECTIONS = Object.keys(UNDO_TARGETS);
