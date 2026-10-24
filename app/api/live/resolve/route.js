import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getFreshJioCookie, injectJioCookie } from '@/lib/liveTv';
import { isHjhWorkerChannel, isJioChannel } from '@/lib/jioPlayback';
import { buildLiveDrm, buildClearKeys } from '@/lib/player/policy/liveTv';
import { needsProxyForVariant, isGeoSensitive } from '@/lib/live/playback/policy.js';
import { readTokenExpiry } from '@/lib/player/streamClassifier';
import { readHdneaExpiry } from '@/lib/live/tokens/hdnea.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/live/resolve?channelId=xxx&logicalId=xxx
 * Returns playable URL with fresh token injected + DRM + proxy hint + expiresAt
 * Used by player before each play to ensure token not expired.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const channelId = String(searchParams.get('channelId')||'').trim();
    const logicalId = String(searchParams.get('logicalId')||'').trim();
    if (!channelId && !logicalId) return NextResponse.json({ ok:false, error:'channelId or logicalId required'}, {status:400});

    await dbConnect();
    let doc = null;
    if (channelId) doc = await LiveChannel.findOne({ channelId }).lean();
    if (!doc && logicalId) {
      const all = await LiveChannel.find({}).lean();
      const rawBase = String(logicalId.split('|')[0]||'').trim().toLowerCase().replace(/-/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
      const rawCat = String(logicalId.split('|')[1]||'').trim().toLowerCase();
      doc = all.find(d=> {
        const nNorm = String(d.normalizedName||d.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
        const cNorm = String(d.category||'').toLowerCase();
        return nNorm.includes(rawBase) || rawBase.includes(nNorm) ;
      }) || null;
      if (doc && rawCat && !String(doc.category||'').toLowerCase().includes(rawCat)) {
        // category mismatch but same base still ok
      }
    }
    if (!doc) return NextResponse.json({ ok:false, error:'No playable URL was resolved for this title.', hint:'Sync the source that carries this title in Admin → TV Service → Sync (Jash Live / Tamil FTA may be empty).'}, {status:404});
    // If this variant has empty URL (stale doc from blob HTML), ladder to another variant with same base name that has URL
    if (!doc.url || !String(doc.url).trim()) {
      const all = await LiveChannel.find({}).lean();
      const nNorm = String(doc.normalizedName||doc.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const alt = all.find(d=> d.channelId !== doc.channelId && String(d.normalizedName||d.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() === nNorm && d.url && String(d.url).trim());
      if (alt) doc = alt;
      else {
        // Try any same display base
        const fallback = all.find(d=> d.url && String(d.name||'').toLowerCase().includes(String(doc.name||'').toLowerCase().split(' ')[0]))
        if (fallback && fallback.url) doc = fallback;
        else return NextResponse.json({ ok:false, error:`No playable URL was resolved for "${doc.name}" — URL missing in DB. Re-sync ${doc.sourceId||'its source'} in Admin → TV Service.`, hint:'URL empty — source parse stored no URL', candidates: all.filter(d=> String(d.normalizedName||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() === nNorm).map(d=>({sourceId:d.sourceId, hasUrl:!!d.url})) }, {status:404});
      }
    }

    // Build client channel shape
    let channel = {
      id: doc.channelId, channelId: doc.channelId, sourceId: doc.sourceId, source: doc.source,
      name: doc.customName || doc.name, url: doc.url, logo: doc.logo, category: doc.category,
      format: doc.format, playable: doc.playable, keyId: doc.keyId, key: doc.key,
      licenseKey: doc.licenseKey, licenseType: doc.licenseType, cookie: doc.cookie,
      userAgent: doc.userAgent, referer: doc.referer, headers: doc.headers || {},
    };

    // Inject fresh Jio token if needed. HJH worker URLs are self-tokenizing
    // (their 302 already carries a fresh __hdnea__), so the token sweep must
    // not block or rewrite them.
    if (isJioChannel(channel) && !isHjhWorkerChannel(channel)) {
      try {
        const cookie = await getFreshJioCookie();
        if (cookie) {
          const injected = injectJioCookie([channel], cookie);
          if (injected[0]) channel = injected[0];
        }
      } catch {}
    }

    const drm = buildLiveDrm(channel);
    const clearKeys = buildClearKeys(channel);
    const needsProxy = needsProxyForVariant(channel);
    const geo = isGeoSensitive(channel);
    const expiresAt = readTokenExpiry(channel.url, channel.cookie, channel.userAgent, channel.referer) || readHdneaExpiry(channel.url, channel.cookie) || null;

    // Build proxy URL if needed
    let playUrl = channel.url;
    if (needsProxy) {
      // Hotstar/Yupp needs server proxy for Cookie/Origin
      const params = new URLSearchParams({ u: playUrl });
      if (channel.cookie) params.set('ck', channel.cookie);
      if (channel.referer) params.set('ref', channel.referer);
      if (channel.userAgent) params.set('ua', channel.userAgent);
      if (Object.keys(channel.headers||{}).length) params.set('hd', JSON.stringify(channel.headers));
      playUrl = `/api/live-proxy?${params.toString()}`;
    }

    return NextResponse.json({
      ok:true,
      channel: { id: channel.id, name: channel.name, logo: channel.logo, category: channel.category, sourceId: channel.sourceId, source: channel.source },
      playUrl,
      originUrl: channel.url,
      drm, clearKeys,
      format: channel.format,
      needsProxy, geoSensitive: geo,
      expiresAt,
      freshness: expiresAt ? (expiresAt - Date.now() > 0 ? `${Math.floor((expiresAt-Date.now())/60000)}m left` : 'expired') : 'no expiry',
    }, { headers:{'Cache-Control':'no-store'}});

  } catch (e) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
