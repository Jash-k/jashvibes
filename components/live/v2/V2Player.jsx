'use client';
import { useEffect, useRef, useState } from 'react';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createV2Policy } from '@/lib/live/v2/policy';

/**
 * V2Player — the PlugX-style fast path for one V2 channel record.
 *
 * One resolve call returns manifest + harvested token + ClearKey together,
 * so playback starts without the V1 worker-redirect hop. The frame markup
 * mirrors components/live/Player.jsx exactly, including the Android surface
 * hardening (aspect-video + jvp-live-frame) and the desktop fill chain.
 */
export default function V2Player({ channel, fill = false, onPrev = null, onNext = null }) {
  const [resolved, setResolved] = useState(null);
  const [err, setErr] = useState('');
  const gen = useRef(0);

  const hasZap = typeof onPrev === 'function' && typeof onNext === 'function';

  useEffect(() => {
    if (!channel?.id) return undefined;
    const my = ++gen.current;
    setErr('');
    setResolved(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/live/v2/resolve?id=${encodeURIComponent(channel.id)}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data?.error || 'V2 resolve failed');
        if (cancelled || my !== gen.current) return;
        setResolved(data);
      } catch (e) {
        if (cancelled || my !== gen.current) return;
        setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [channel?.id]);

  if (!channel) {
    return <div className="grid h-full place-items-center rounded-2xl border border-white/10 bg-zinc-950 text-sm text-zinc-400">Pick a channel to start watching</div>;
  }
  if (err) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4">
        <p className="text-sm text-red-200">{err}</p>
        <p className="mt-2 text-xs text-zinc-400">The token harvest may be refreshing — wait a moment and reselect the channel.</p>
      </div>
    );
  }
  if (!resolved) {
    return <div className="rounded-xl border border-white/10 bg-black p-6 text-zinc-400">Resolving {channel.name}…</div>;
  }

  const policy = createV2Policy(channel, resolved);

  return (
    <div className={fill ? 'flex h-full min-h-0 flex-col gap-2' : 'space-y-2'}>
      <div className={`group/player relative overflow-hidden rounded-2xl border border-white/10 bg-black ${fill ? 'min-h-0 flex-1' : 'aspect-video w-full jvp-live-frame'}`}>
        <JashPlayer
          key={`v2:${channel.id}`}
          source={{ url: resolved.originUrl, kind: 'auto', label: channel.name }}
          playbackPolicy={policy}
          live
          poster={channel.logo || ''}
          display={{
            title: channel.name,
            poster: channel.logo || '',
            aspect: fill ? 'fill' : undefined,
            mediaSession: {
              title: channel.name,
              artist: 'JaSH Vibes Live V2',
              artwork: channel.logo ? [{ src: channel.logo, sizes: '512x512' }] : [],
              onPrev: hasZap ? () => onPrev() : undefined,
              onNext: hasZap ? () => onNext() : undefined,
            },
          }}
          pipOnHide
          onPrev={hasZap ? onPrev : undefined}
          onNext={hasZap ? onNext : undefined}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>{channel.name} · Jio V2{resolved.tokenSource ? ` · ${resolved.tokenSource}` : ''}</span>
        <span className="hidden sm:inline">{hasZap ? 'PageUp/PageDown changes channel' : ''}</span>
      </div>
    </div>
  );
}
