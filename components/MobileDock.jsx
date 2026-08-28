'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icons';

const DOCK_ITEMS = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/live', label: 'Live', icon: 'tv' },
  { href: '/music', label: 'Music', icon: 'music' },
  { href: '/sports', label: 'Sports', icon: 'trophy' },
  { href: '/my-list', label: 'My List', icon: 'heart' },
];

// Bottom navigation dock for phones — hidden on lg+ where the top brand strip
// and in-page navigation already provide reachability.
export default function MobileDock() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Main navigation"
      className="mobile-dock fixed inset-x-0 bottom-0 z-[60] border-t border-white/10 bg-[#05050a]/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5">
        {DOCK_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-col items-center gap-1 py-2.5 text-[10px] font-bold transition active:scale-95 ${
                active ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {active ? <span className="absolute top-0 h-0.5 w-9 rounded-full bg-gradient-to-r from-amber-400 via-red-500 to-purple-500" /> : null}
              <Icon name={item.icon} className="h-5 w-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
