'use client';
import { SOURCE_REGISTRY } from '@/lib/live/registry';

export default function SourceTabs({ active='all', counts={}, onChange }) {
  const sources = [
    { id:'all', label:'All Tamil', icon:'★' },
    ...Object.values(SOURCE_REGISTRY).map(s=> ({ id:s.id, label:s.label, icon: s.group==='jio'?'📡':'📺' })),
  ];
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
      {sources.map(s=>{
        const c = counts[s.id] ?? counts['all'] ?? 0;
        const isActive = active===s.id;
        return (
          <button key={s.id} type="button" onClick={()=>onChange?.(s.id)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-black flex items-center gap-1.5 ${isActive?'border-red-500 bg-red-600 text-white':'border-white/10 bg-white/[0.04] text-zinc-300'}`}>
            <span>{s.icon}</span>{s.label}<span className={`rounded-full px-1.5 text-[10px] ${isActive?'bg-white/20':'bg-white/10'}`}>{s.id==='all'?counts['all']||0:c}</span>
          </button>
        );
      })}
    </div>
  );
}
