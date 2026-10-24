'use client';
import { friendlySourceLabel } from './channelBits';

/** Phone slide-up channel list so the player never gets pushed off-screen. */
export default function MobileSheet({ open, title = 'Channels', groups = [], activeId, onPick, onClose }) {
  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/60" onClick={onClose} aria-hidden />
      <div className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[72%] flex-col rounded-t-3xl border-t border-white/10 bg-[#111116] px-4 pb-6 pt-3">
        <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-zinc-600" />
        <div className="mb-2 flex items-center">
          <h4 className="text-sm font-black">{title} <span className="font-bold text-zinc-500">· {groups.length}</span></h4>
          <button type="button" onClick={onClose} className="ml-auto grid h-8 w-8 place-items-center rounded-full text-zinc-400 hover:bg-white/10">✕</button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto [scrollbar-width:thin]">
          {groups.map((group) => (
            <button key={group.logicalId} type="button" onClick={() => { onPick(group); onClose(); }}
              className={`flex w-full items-center gap-3 rounded-xl border p-2 text-left ${group.logicalId === activeId ? 'border-red-500/70 bg-red-500/10' : 'border-white/10'}`}>
              <span className="grid h-9 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-black">
                {group.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={group.logo} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                ) : <span className="text-xs">📺</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{group.displayName}</span>
                <span className="block truncate text-[10.5px] text-zinc-400">
                  {group.variantCount > 1 ? `${group.variantCount} sources` : friendlySourceLabel(group.best?.sourceId)}
                </span>
              </span>
              <span className="text-red-400">{group.logicalId === activeId ? '▶' : '›'}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
