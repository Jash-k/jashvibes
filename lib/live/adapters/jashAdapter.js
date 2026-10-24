/**
 * lib/live/adapters/jashAdapter.js — Jash Live M3U (triplet variants)
 * Heavy lifting moved to deduplicate pipeline; adapter just parses.
 */
import { BaseAdapter } from './base.js';

export class JashAdapter extends BaseAdapter {
  async parse(text, sourceDef) {
    const { parseM3U } = await import('@/lib/liveTv.js');
    const chans = parseM3U(text, { id: sourceDef.id, label: sourceDef.label, type:'m3u', priority: sourceDef.priority }, { includeAll:true });
    // Keep all variants; dummy null:null will be dropped in deduplicate step
    // Attach baseName hint for grouping
    for (const ch of chans) {
      ch.baseName = String(ch.name||'').replace(/\s*\[.*?\]\s*$/,'').trim();
      ch.trustTamil = true;
    }
    return chans;
  }
}
