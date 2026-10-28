'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';

/**
 * LivePlayer — the /live player shell.
 *
 * Adds channel navigation over the resolve flow:
 *   onPrev/onNext  wrap-around zap within the page's current filtered list;
 *                  wired to the player's PageUp/PageDown + media-track keys and
 *                  to the visible edge buttons (mobile/TV discoverability).
 *   liveBrowser    feeds JashPlayer's in-player ChannelDrawer (G key / guide
 *                  button), which survives fullscreen and is D-pad navigable.
 */
export default function LivePlayer({ logical, variantIdx=0, onErrorNeedingFallback, onPrev, onNext, liveBrowser=null, fill=false, onRemoveChannel=null }) {
  const hasZap = typeof onPrev === 'function' && typeof onNext === 'function';
  const variant = logical?.variants?.[variantIdx] || logical?.best;
  const displayName = logical?.displayName || logical?.name || variant?.name || 'Live Channel';
  const [resolved, setResolved] = useState(null);
  const [err, setErr] = useState('');
  // JashPlayer/usePlaybackEngine probe EME/codec capabilities internally — no
  // caps prop exists on the player, so this page does not probe at all.
  const gen = useRef(0);

  const resolve = useCallback(async ()=>{
    if (!variant) return;
    const my = ++gen.current;
    setErr('');
    setResolved(null);
    try{
      const res = await fetch(`/api/live/resolve?channelId=${encodeURIComponent(variant.channelId)}`, { cache:'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error||'Resolve failed');
      if (my!==gen.current) return;
      // Build channel shape for policy. data.cookie carries the fresh __hdnea__
      // token the resolve API captured from an HJH worker 302; workerUrl keeps
      // the original signpost so the policy can refresh an expired token
      // without any Render-side token sweep.
      const channel = {
        id: data.channel.id, channelId: data.channel.id, name: data.channel.name,
        url: data.originUrl, logo: data.channel.logo, category: data.channel.category,
        sourceId: variant.sourceId, source: variant.sourceId, format: data.format,
        keyId: variant.keyId, key: variant.key, licenseKey: variant.licenseKey, licenseType: variant.licenseType,
        cookie: data.cookie || variant.cookie || '',
        userAgent: variant.userAgent, referer: variant.referer, headers: variant.headers||{},
        workerUrl: variant.url,
        forceProxy: Boolean(variant.forceProxy),
      };
      const policy = createLiveTvPolicy(channel, { origin: typeof window!=='undefined'?window.location.origin:'', allowNativeHls:true });
      // JashPlayer runs this policy itself: its resolve() owns Jio token
      // injection, ClearKey/Widevine DRM, header rewriting and the
      // direct -> proxy recovery ladder. The /api/live/resolve call above only
      // guarantees a fresh token and a non-empty URL before the player mounts.
      setResolved({ playUrl: data.playUrl, originUrl: data.originUrl, policy, channel, expiresAt: data.expiresAt, freshness: data.freshness, drm: data.drm });
    }catch(e){
      if (my!==gen.current) return;
      // Auto ladder: if this variant has no URL, try next without showing error first
      if (/no playable url|not found/i.test(e.message) && logical?.variants?.length > variantIdx+1) {
        onErrorNeedingFallback?.(logical, variantIdx);
        return;
      }
      setErr(e.message);
    }
  },[variant, logical, variantIdx, onErrorNeedingFallback]);

  useEffect(()=>{ resolve(); },[resolve]);

  if (!variant) return <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 text-zinc-400">No playable stream for {logical?.displayName || 'this title'} yet. Re-sync its source in Admin → TV → Sources &amp; Sync.</div>;
  if (err) {
    const isNoStream = /no stream|not found|channel not found/i.test(err);
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4">
        <p className="text-sm text-red-200">{isNoStream ? 'No stream available for this title on this source.' : err}</p>
        <p className="text-xs text-zinc-400 mt-2">{logical.variants.length>1 ? `Source ${variantIdx+1}/${logical.variants.length} failed — try next variant below.` : 'Only one source for this title.'}</p>
        <div className="flex gap-2 mt-3">
          {logical.variants.length>1 && <button onClick={()=>onErrorNeedingFallback?.(logical, variantIdx)} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black">Try next source →</button>}
          <button onClick={resolve} className="rounded-full bg-white/10 px-3 py-1 text-xs">Retry</button>
          {onRemoveChannel ? (
            <button onClick={() => onRemoveChannel(logical)} className="rounded-full border border-red-500/50 px-3 py-1 text-xs font-bold text-red-200 hover:bg-red-500/15">🚫 Remove channel</button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500 mt-2">The player automatically tries every available source for this channel. If all of them fail, re-sync in Admin → TV → Sources &amp; Sync.</p>
      </div>
    );
  }
  if (!resolved) return <div className="rounded-xl border border-white/10 bg-black p-6 text-zinc-400">Resolving {variant.sourceLabel}…</div>;

  // Contract mirrors the /watch page and the service-preview player: a policy
  // WITH a resolve() must arrive as `playbackPolicy` — the bare `policy` prop
  // is only a shallow config overlay and never reaches the engine. `source.url` identifies the stream (source key, chrome, stats);
  // the policy resolves the actual playback URL, rewriting to /api/live-proxy
  // when the variant needs server-side headers. A per-channel key remounts the
  // engine cleanly on every channel zap / variant-ladder switch.
  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col gap-2' : 'space-y-2'}>
      {/*
        Mobile/tablet (fill=false): the frame itself owns the 16:9 box instead
        of trusting the player root's aspect class alone. With a definite,
        width-derived height the grid/flex auto row can never stretch the frame
        tall, and overflow:hidden clips any hardware video surface that desyncs
        from its element after a PiP/fullscreen/rotation transition (the Android
        Chrome gray-offset-rectangle glitch). jvp-live-frame promotes the frame
        to its own compositing layer so the clipping actually applies to the
        video surface. Desktop keeps the fill-height chain untouched.
      */}
      <div className={`group/player relative overflow-hidden rounded-2xl border border-white/10 bg-black ${fill ? 'min-h-0 flex-1' : 'aspect-video w-full jvp-live-frame'}`}>
        <JashPlayer
          key={`${resolved.channel.channelId}:${variantIdx}`}
          source={{ url: resolved.originUrl, kind: 'auto', label: resolved.channel.name }}
          playbackPolicy={resolved.policy}
          live
          poster={resolved.channel.logo || ''}
          // 'fill' makes the root h-full/w-full so it occupies the whole black
          // frame instead of leaving a dead 16:9 strip underneath the video.
          // mediaSession makes Android register an active media notification,
          // which keeps audio alive when the tab is minimized and makes the
          // auto-PiP handoff reliable (onPrev/onNext feed the system controls).
          display={{
            title: resolved.channel.name,
            poster: resolved.channel.logo || '',
            aspect: fill ? 'fill' : undefined,
            mediaSession: {
              title: resolved.channel.name,
              artist: 'JaSH Vibes Live',
              artwork: resolved.channel.logo ? [{ src: resolved.channel.logo, sizes: '512x512' }] : [],
              onPrev: hasZap ? () => onPrev() : undefined,
              onNext: hasZap ? () => onNext() : undefined,
            },
          }}
          // Minimizing/hiding Chrome pops the stream into Picture-in-Picture
          // so the live channel keeps playing in the floating window.
          pipOnHide
          onPrev={hasZap ? onPrev : undefined}
          onNext={hasZap ? onNext : undefined}
          liveBrowser={liveBrowser}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>{resolved.channel.name} · {variant.sourceLabel || 'Live'}</span>
        <span className="hidden sm:inline">{hasZap ? 'PageUp/PageDown changes channel · G opens the guide' : ''}</span>
      </div>
    </div>
  );
}
