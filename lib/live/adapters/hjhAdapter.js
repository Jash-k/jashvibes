/**
 * lib/live/adapters/hjhAdapter.js — HJH worker M3U
 * DASH/HLS with ClearKey kid:key, URLs already contain fresh __hdnea__ via 302.
 */
import { BaseAdapter } from './base.js';

// Reuse existing M3U parser from lib/liveTv.js parseM3U, but adapter keeps isolated import
export class HjhAdapter extends BaseAdapter {
  async parse(text, sourceDef) {
    // Use dynamic import to avoid circular dep during build
    const { parseM3U } = await import('@/lib/liveTv.js');
    return parseM3U(text, { id: sourceDef.id, label: sourceDef.label, type:'m3u', priority: sourceDef.priority }, { includeAll:true });
  }
}
