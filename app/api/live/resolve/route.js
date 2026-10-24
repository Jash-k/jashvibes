import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getFreshJioCookie, injectJioCookie } from '@/lib/liveTv';
import { isJioChannel } from '@/lib/jioPlayback';
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
      // fallback: find any variant for logicalId by scanning all with same normalized name
      // logicalId = base|categ ; fetch one
      const all = await LiveChannel.find({}).lean();
      // naive: match displayName part of logicalId
      const base = logicalId.split('|')[0]?.replace(/-/g,' ').trim();
      doc = all.find(d=> String(d.name||'').toLowerCase().includes(base)) || null;
    }
    if (!doc) return NextResponse.json({ ok:false, error:'Channel not found'}, {status:404});

    // Build client channel shape
    let channel = {
      id: doc.channelId, channelId: doc.channelId, sourceId: doc.sourceId, source: doc.source,
      name: doc.customName || doc.name, url: doc.url, logo: doc.logo, category: doc.category,
      format: doc.format, playable: doc.playable, keyId: doc.keyId, key: doc.key,
      licenseKey: doc.licenseKey, licenseType: doc.licenseType, cookie: doc.cookie,
      userAgent: doc.userAgent, referer: doc.referer, headers: doc.headers || {},
    };

    // Inject fresh Jio token if needed (isJioChannel includes __hdnea__ check now)
    if (isJioChannel(channel)) {
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
