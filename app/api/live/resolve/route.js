import { refreshJioPlusChannel } from '@/lib/live/jioPlusAccess';
import { eligibleLiveVariant } from '@/lib/live/health';
import { requireServiceAuth } from '@/lib/serverAuth';
import LiveSource from '@/models/LiveSource';
import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { injectJioCookie, resolveHjhWorkerUrl, extractJioCookieFromText, getJioChannelAccess } from '@/lib/liveTv';
import { isHjhWorkerChannel, isJioChannel, isJioCookieValid, appendJioCookieToUrl } from '@/lib/jioPlayback';
import { buildLiveDrm, buildClearKeys } from '@/lib/player/policy/liveTv';
import { needsProxyForVariant, isGeoSensitive } from '@/lib/live/playback/policy.js';
import { resolutionHealth } from '@/lib/live/playback/resolveHealth';

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

    // Admin previews can inspect candidates; public requests cannot bypass admission.
    let preview = false;
    if (searchParams.get('preview') === '1') { await requireServiceAuth(request); preview = true; }
    if (doc.sourceId !== 'manual') {
      const source = await LiveSource.findOne({sourceId:doc.sourceId, enabled:{$ne:false}, deleted:{$ne:true}}).lean();
      if (!source) return NextResponse.json({ok:false,code:'SOURCE_DISABLED',error:'This source is disabled.'},{status:503});
    }

    // Build client channel shape
    let channel = {
      id: doc.channelId, channelId: doc.channelId, sourceId: doc.sourceId, source: doc.source,
      tvgId: doc.tvgId || '', forceProxy: Boolean(doc.forceProxy),
      name: doc.customName || doc.name, url: doc.url, logo: doc.logo, category: doc.category,
      format: doc.format, playable: doc.playable, keyId: doc.keyId, key: doc.key,
      licenseKey: doc.licenseKey, licenseType: doc.licenseType, cookie: doc.cookie,
      userAgent: doc.userAgent, referer: doc.referer, headers: doc.headers || {},
    };

    // HJH worker channels: resolve the 302 server-side (safe from any country —
    // the Cloudflare worker is not geo-fenced), capture the fresh signed Jio
    // CDN URL and its __hdnea__ token, and hand both to the player. Media
    // itself stays browser-direct, so no Render bandwidth or 451 risk.
    if (channel.sourceId === 'jiotv-plus') {
      try { channel=await refreshJioPlusChannel(channel,{force:searchParams.get('refresh')==='1'}); }
      catch { return NextResponse.json({ok:false,code:'SOURCE_UNAVAILABLE',retryable:true,error:'JioTV+ playlist refresh is unavailable. Try another source.'},{status:503,headers:{'Cache-Control':'no-store'}}); }
    } else if (isHjhWorkerChannel(channel)) {
      try {
        const signedUrl = await resolveHjhWorkerUrl(channel.url);
        const token = extractJioCookieFromText(signedUrl);
        if (signedUrl) channel.url = signedUrl;
        if (token) channel.cookie = token;
      } catch {
        return NextResponse.json({ ok:false, code:'SOURCE_UNAVAILABLE', retryable:true, error:'The stream Worker is unavailable. Try another source.' }, {status:503, headers:{'Cache-Control':'no-store'}});
      }
    } else if (isJioChannel(channel)) {
      // Regular Jio channels still use the rotating shared token sweep.
      try {
        const access = await getJioChannelAccess(channel);
        if (access.playbackUrl) channel.url = access.playbackUrl;
        if (access.cookie) {
          channel = { ...channel, cookie: access.cookie };
          const injected = injectJioCookie([channel], access.cookie);
          if (injected[0]) channel = injected[0];
        }
      } catch {}
    }

    // Replace a stale URL token as well as the Cookie field before checking
    // readiness; otherwise the browser may still send the old query token.
    if (isJioChannel(channel) && isJioCookieValid(channel.cookie)) channel.url = appendJioCookieToUrl(channel.url, channel.cookie);
    const currentDoc={...doc,...channel,playbackHealth:doc.playbackHealth};
    if (!preview && !eligibleLiveVariant(currentDoc)) return NextResponse.json({ok:false,code:'VALIDATION_REQUIRED',error:'This stream needs a current playback validation in Admin → TV.'},{status:503,headers:{'Cache-Control':'no-store'}});
    const health = resolutionHealth(channel);
    if (!health.ok) return NextResponse.json({ok:false,code:health.code,error:health.error,retryable:true}, {status:503,headers:{'Cache-Control':'no-store'}});
    const drm = buildLiveDrm(channel);
    const clearKeys = buildClearKeys(channel);
    const needsProxy = needsProxyForVariant(channel);
    const geo = isGeoSensitive(channel);
    const expiresAt = health.expiresAt;

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
