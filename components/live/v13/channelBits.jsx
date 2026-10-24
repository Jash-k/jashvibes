'use client';
import Link from 'next/link';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';
import { SOURCE_REGISTRY } from '@/lib/live/registry';
import { groupCatalogIds } from '@/lib/live/landing';

export { groupCatalogIds };

/** Viewer-friendly source names — internal ids and token/proxy jargon never shown. */
export function friendlySourceLabel(sourceId = '') {
  const def = SOURCE_REGISTRY[sourceId];
  if (def?.label) return def.label;
  if (sourceId === 'manual') return 'Manual';
  if (!sourceId || sourceId === 'all') return 'All Tamil';
  return String(sourceId).replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Compact channel card. `tv` enlarges it for 10-foot viewing. */
export function ChannelCard({ group, active = false, onPick, tv = false, tabIndex = 0 }) {
  const logo = group.logo || group.best?.logo || '';
  return (
    <button
      type="button"
      tabIndex={tabIndex}
      data-ch-card="1"
      onClick={() => onPick?.(group)}
      className={`group relative block w-full overflow-hidden rounded-xl border text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
        active ? 'border-red-500 bg-red-950/25 ring-1 ring-red-500/60' : 'border-white/10 bg-white/[0.04] hover:border-white/25'
      }`}
    >
      <div className={`${tv ? 'aspect-video' : 'aspect-[16/10]'} grid place-items-center overflow-hidden bg-black`}>
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" />
        ) : (
          <span className={tv ? 'text-2xl' : 'text-base'}>📺</span>
        )}
        {active ? <span className="absolute right-1 top-1 rounded bg-red-600 px-1 py-0.5 text-[8px] font-black tracking-wider">LIVE</span> : null}
      </div>
      <div className="px-1.5 py-1.5">
        <p className={`truncate font-bold text-white ${tv ? 'text-sm' : 'text-[11.5px]'}`}>{group.displayName}</p>
        <p className={`truncate text-zinc-400 ${tv ? 'text-xs' : 'text-[9.5px]'}`}>
          {group.variantCount > 1 ? `${group.variantCount} sources` : friendlySourceLabel(group.best?.sourceId)}
        </p>
      </div>
    </button>
  );
}

function NavButton({ active, onClick, children, tv = false }) {
  return (
    <button
      type="button"
      data-nav="1"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg text-left font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
        tv ? 'px-3 py-2.5 text-[15px]' : 'px-2.5 py-2 text-[12.5px]'
      } ${active ? 'bg-red-600/20 text-white shadow-[inset_3px_0_0_0_#e11d2e]' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
    >
      {children}
    </button>
  );
}

/** Desktop/TV vertical catalog rail (Favorites is a virtual, client-only catalog). */
export function CatalogRail({ active, onSelect, counts = {}, favCount = 0, tv = false }) {
  const items = [
    { id: 'all', name: 'All Tamil', icon: '★' },
    { id: 'fav', name: 'Favorites', icon: '♥' },
    ...LIVE_CATALOGS.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
  ];
  return (
    <nav className={tv ? 'space-y-1.5' : 'space-y-0.5'}>
      {items.map((item) => (
        <NavButton key={item.id} active={active === item.id} tv={tv} onClick={() => onSelect(item.id)}>
          <span className="w-4 text-center text-[13px]">{item.icon}</span>
          <span className="truncate">{item.name}</span>
          <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[9.5px] text-zinc-300">
            {item.id === 'fav' ? favCount : counts[item.id] ?? 0}
          </span>
        </NavButton>
      ))}
    </nav>
  );
}

/** Horizontal swipeable chips for phones. */
export function CatalogChips({ active, onSelect, counts = {}, favCount = 0 }) {
  const items = [
    { id: 'all', name: 'All Tamil', icon: '★' },
    { id: 'fav', name: 'Favs', icon: '♥' },
    ...LIVE_CATALOGS.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
  ];
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11.5px] font-bold transition ${
            active === item.id ? 'border-red-600 bg-red-600 text-white' : 'border-white/10 bg-white/[0.04] text-zinc-300'
          }`}
        >
          <span>{item.icon}</span>
          {item.name}
          <span className={`rounded-full px-1 text-[9px] ${active === item.id ? 'bg-white/20' : 'bg-white/10'}`}>
            {item.id === 'fav' ? favCount : counts[item.id] ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}

export function HomeLink({ className = '' }) {
  return (
    <Link href="/" title="Go to homepage"
      className={`grid place-items-center rounded-full border border-white/10 bg-white/[0.04] text-zinc-300 transition hover:border-red-500/60 hover:text-white ${className}`}>
      🏠
    </Link>
  );
}
