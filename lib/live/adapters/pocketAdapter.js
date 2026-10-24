import { BaseAdapter } from './base.js';
export class PocketAdapter extends BaseAdapter {
  async parse(text, sourceDef) {
    const { parseM3U } = await import('@/lib/liveTv.js');
    return parseM3U(text, { id: sourceDef.id, label: sourceDef.label, type:'m3u', priority: sourceDef.priority }, { includeAll:true });
  }
}
