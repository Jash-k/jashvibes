'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { probeCapabilities } from '@/lib/player/capabilities';

export default function LivePlayerV12({ logical, variantIdx=0, onErrorNeedingFallback }) {
  const displayName = logical?.displayName || logical?.name || variant?.name || 'Live Channel';
  const variant = logical?.variants?.[variantIdx] || logical?.best;
  const [resolved, setResolved] = useState(null);
  const [caps, setCaps] = useState(null);
  const [err, setErr] = useState('');
  useEffect(()=>{ probeCapabilities().then(setCaps).catch(()=>{}); },[]);
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
      // Build channel shape for policy
      const channel = {
        id: data.channel.id, channelId: data.channel.id, name: data.channel.name,
        url: data.originUrl, logo: data.channel.logo, category: data.channel.category,
        sourceId: variant.sourceId, source: variant.sourceId, format: data.format,
        keyId: variant.keyId, key: variant.key, licenseKey: variant.licenseKey, licenseType: variant.licenseType,
        cookie: variant.cookie, userAgent: variant.userAgent, referer: variant.referer, headers: variant.headers||{},
      };
      const policy = createLiveTvPolicy(channel, { origin: typeof window!=='undefined'?window.location.origin:'', allowNativeHls:true });
      // policy expects to resolve via its own resolve() — but we already have playUrl
      // Instead, feed resolved URL directly via JashPlayer source
      setResolved({ playUrl: data.playUrl, originUrl: data.originUrl, policy, channel, expiresAt: data.expiresAt, freshness: data.freshness, drm: data.drm });
    }catch(e){
      if (my!==gen.current) return;
      setErr(e.message);
    }
  },[variant]);

  useEffect(()=>{ resolve(); },[resolve]);

  if (!variant) return <div className="rounded-xl border border-white/10 bg-zinc-950 p-6 text-zinc-400">No playable variant for {logical?.displayName || 'this title'} — URL missing in DB. Re-sync {logical?.variants?.[0]?.sourceLabel || logical?.variants?.[0]?.sourceId || 'its source'} in Admin → TV Service → Sync.</div>;
  if (err) {
    const isNoStream = /no stream|not found|channel not found/i.test(err);
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4">
        <p className="text-sm text-red-200">{isNoStream ? 'No stream available for this title on this source.' : err}</p>
        <p className="text-xs text-zinc-400 mt-2">{logical.variants.length>1 ? `Source ${variantIdx+1}/${logical.variants.length} failed — try next variant below.` : 'Only one source for this title.'}</p>
        <div className="flex gap-2 mt-3">
          {logical.variants.length>1 && <button onClick={()=>onErrorNeedingFallback?.(logical, variantIdx)} className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black">Try next source →</button>}
          <button onClick={resolve} className="rounded-full bg-white/10 px-3 py-1 text-xs">Retry</button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">Tip: HJH freshest (5min) → Jio → Jash Hotstar (proxy) → Pocket. Sync in Admin → TV Service if expired.</p>
      </div>
    );
  }
  if (!resolved || !caps) return <div className="rounded-xl border border-white/10 bg-black p-6 text-zinc-400">Resolving {variant.sourceLabel}…</div>;

  // Use JashPlayer with policy + caps
  return (
    <div className="space-y-2">
      <div className="rounded-2xl overflow-hidden border border-white/10 bg-black">
        <JashPlayer caps={caps} policy={resolved.policy} channel={resolved.channel} />
      </div>
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>{resolved.channel.name} • {variant.sourceLabel} • {variant.format.toUpperCase()} {resolved.freshness?`• token ${resolved.freshness}`:''}</span>
        <span className={resolved.freshness?.includes('expired')?'text-red-400':''}>{variant.needsProxy?'via proxy':'direct'}</span>
      </div>
    </div>
  );
}
