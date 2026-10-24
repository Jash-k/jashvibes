import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import { getDefaultLiveSources } from '@/lib/liveTv';
import { deduplicateChannels, isDummyVariant } from '@/lib/live/pipeline/deduplicate.js';
import { policyForLogicalChannel } from '@/lib/live/playback/policy.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/channels?tamilOnly=1&source=all
 * Returns deduplicated logical channels (one card per base-name) with fallback ladder.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceFilter = String(searchParams.get('source')||'all').toLowerCase();
    const tamilOnly = ['1','true','yes'].includes(String(searchParams.get('tamilOnly')||'').toLowerCase());
    const includeUnplayable = false;

    await dbConnect();
    // Ensure sources seeded so admin shows them
    const defaults = getDefaultLiveSources({ includePocket:true });
    // For channels, use DB LiveChannel docs (synced via /api/live-service/sync)
    const query = {};
    if (sourceFilter !== 'all') query.sourceId = sourceFilter;

    const docs = await LiveChannel.find(query).lean().catch(()=>[]);
    if (!docs.length) {
      return NextResponse.json({ ok:true, logical:[], flat:[], groups:0, totalVariants:0, sources: defaults.map(s=>({id:s.id,label:s.label,url:s.url,type:s.type})), deduplicated:true }, { headers:{'Cache-Control':'no-store'}});
    }

    // Convert docs → flat channel shape used by deduplicate
    const flat = docs.map(d=>({
      channelId: d.channelId || d._id?.toString(),
      id: d.channelId,
      name: d.customName || d.name,
      originalName: d.name,
      logo: d.customLogo || d.logo,
      category: d.category || 'Live',
      language: d.language || '',
      url: d.url,
      format: d.format || 'unknown',
      playable: includeUnplayable ? true : (d.playable !== false),
      keyId: d.keyId||'',
      key: d.key||'',
      licenseKey: d.licenseKey||'',
      licenseType: d.licenseType||'',
      cookie: d.cookie||'',
      userAgent: d.userAgent||'',
      referer: d.referer||'',
      headers: d.headers||{},
      sourceId: d.sourceId,
      source: d.source,
      tvgId: d.tvgId||'',
      priority: d.priority ?? 99,
    })).filter(ch => {
      if (!ch.playable) return false;
      if (isDummyVariant(ch)) return false;
      if (tamilOnly) {
        const hay = `${ch.name} ${ch.category} ${ch.language}`.toLowerCase();
        if (!hay.includes('tamil')) return false;
      }
      return true;
    });

    const logical = deduplicateChannels(flat).map(policyForLogicalChannel);

    return NextResponse.json({
      ok:true,
      deduplicated:true,
      groups: logical.length,
      totalVariants: flat.length,
      logical,
      // keep flat for backward compat
      flat: logical.flatMap(g=> g.variants.map(v=> ({...v, logicalId:g.logicalId, displayName:g.displayName}))),
      sources: defaults,
    }, { headers:{'Cache-Control':'no-store'}});

  } catch (e) {
    return NextResponse.json({ ok:false, error: e.message }, { status:500, headers:{'Cache-Control':'no-store'}});
  }
}
