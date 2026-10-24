'use client';
export default function VariantPicker({ logical, activeVariantIdx=0, onPickVariant }) {
  if (!logical?.variants?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {logical.variants.map((v,idx)=>{
        const isActive = idx===activeVariantIdx;
        const label = `${v.sourceLabel||v.sourceId} · ${String(v.format||'').toUpperCase()}${v.keyId?' 🔐':''}`;
        return (
          <button key={v.channelId||idx} type="button" onClick={()=>onPickVariant?.(idx)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${isActive?'border-red-500 bg-red-600 text-white':'border-white/10 bg-zinc-900 text-zinc-300'}`}>
            {label} {v.needsProxy?'· via proxy':''}
          </button>
        );
      })}
    </div>
  );
}
