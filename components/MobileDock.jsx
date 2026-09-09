'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icons';
import { NAV_ITEMS } from '@/components/navItems';

// The list lives in `components/navItems.js`, shared with the homepage `RailNav`: two hardcoded copies
// is how a section ends up reachable on the TV and missing from the phone.
const DOCK_ITEMS = NAV_ITEMS;

export default function MobileDock() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Main navigation"
      className="mobile-dock fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#06040b]/92 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_35px_rgba(0,0,0,0.8)] backdrop-blur-2xl lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-6">
        {DOCK_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition duration-200 active:scale-90 ${
                active
                  ? 'text-amber-400 drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {active ? (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gradient-to-r from-amber-400 via-rose-500 to-purple-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]" />
              ) : null}
              <Icon name={item.icon} className={`h-5 w-5 transition-transform duration-200 ${active ? 'scale-110' : ''}`} />
              <span className="tracking-tight">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
