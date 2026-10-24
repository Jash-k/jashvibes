'use client';

export function ChannelCard({ logical, isActive, onPick }) {
  const best = logical.best || logical.variants?.[0];
  const variantCount = logical.variantCount ?? logical.variants?.length ?? 1;
  const badge = variantCount > 1 ? `+${variantCount-1}` : '';
  return (
    <button type="button" onClick={()=>onPick?.(logical)}
      className={`group relative rounded-2xl overflow-hidden border text-left transition ${isActive?'border-red-500 bg-red-950/20':'border-white/10 bg-zinc-900 hover:border-white/20'}`}>
      <div className="aspect-[16/9] bg-black flex items-center justify-center overflow-hidden">
        {logical.logo ? <img src={logical.logo} alt="" className="w-full h-full object-contain" loading="lazy"/> : <span className="text-2xl">📺</span>}
        <span className="absolute top-1.5 right-1.5 flex gap-1">
          {logical.sourceIds?.map(id=> <span key={id} className="rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">{id.slice(0,3)}</span>)}
        </span>
      </div>
      <div className="p-2">
        <p className="text-xs font-black leading-tight line-clamp-2 text-white">{logical.displayName}</p>
        <p className="text-[10px] text-zinc-400">{logical.category} {badge? `• ${badge} variants`:''}</p>
      </div>
      {isActive && <span className="absolute inset-0 ring-2 ring-red-500 rounded-2xl pointer-events-none" />}
    </button>
  );
}

export default function ChannelGrid({ logical=[], activeLogicalId, onPick, emptyText='No channels' }) {
  if (!logical.length) return <p className="text-sm text-zinc-400 p-6 border border-white/10 rounded-xl bg-zinc-950">{emptyText}</p>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
      {logical.map(g=> (
        <ChannelCard key={g.logicalId} logical={g} isActive={g.logicalId===activeLogicalId} onPick={onPick} />
      ))}
    </div>
  );
}
