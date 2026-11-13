import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getFreshJioCookie, injectJioCookie, resolveHjhWorkerUrl, extractJioCookieFromText } from '@/lib/liveTv';
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
    if (!doc && logicalId) doc = await LiveChannel.findOne({ logicalChannelId: logicalId, hidden: { $ne: true }, url: { $nin: ['', null] } }).lean();
    if (!doc || doc.hidden || !doc.url) return NextResponse.json({ ok: false, error: 'This channel has no playable URL. Re-sync its source in Admin → TV.' }, { status: 404 });

    // Build client channel shape
    let channel = {
      id: doc.channelId, channelId: doc.channelId, sourceId: doc.sourceId, source: doc.source,
      name: doc.customName || doc.name, url: doc.url, logo: doc.logo, category: doc.category,
      format: doc.format, playable: doc.playable, keyId: doc.keyId, key: doc.key,
      licenseKey: doc.licenseKey, licenseType: doc.licenseType, cookie: doc.cookie,
      userAgent: doc.userAgent, referer: doc.referer, headers: doc.headers || {},
    };

    // HJH worker channels: resolve the 302 server-side (safe from any country —
    // the Cloudflare worker is not geo-fenced), capture the fresh signed Jio
    // CDN URL and its __hdnea__ token, and hand both to the player. Media
    // itself stays browser-direct, so no Render bandwidth or 451 risk.
    if (isHjhWorkerChannel(channel)) {
      try {
        const signedUrl = await resolveHjhWorkerUrl(channel.url);
        const token = extractJioCookieFromText(signedUrl);
        if (signedUrl) channel.url = signedUrl;
        if (token) channel.cookie = token;
      } catch {
        /* fall through with the worker URL; the client policy will try */
      }
    } else if (isJioChannel(channel)) {
      // Regular Jio channels still use the rotating shared token sweep.
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
      channel: { ...channel, tvgId: doc.tvgId || '', forceProxy: Boolean(doc.forceProxy) },
      playUrl,
      originUrl: channel.url,
      // Fresh __hdnea__ captured from the HJH worker 302; the client policy
      // re-attaches it to every segment so relative DASH URLs stay signed.
      cookie: channel.cookie || '',
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
