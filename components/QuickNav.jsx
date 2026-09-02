'use client';

/**
 * QuickNav — slim floating page-switch pill, visible on every page.
 * Sits above the MobileDock on phones (itself hidden on lg+); always on
 * desktop where no bottom nav exists. Dimmed until approach/touch so it never
 * blocks player UIs.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icons';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/stremio', label: 'Stremio', icon: 'film' },
  { href: '/live', label: 'Live', icon: 'tv' },
  { href: '/music', label: 'Music', icon: 'music' },
  { href: '/sports', label: 'Sports', icon: 'trophy' },
  { href: '/my-list', label: 'List', icon: 'heart' },
];

export default function QuickNav() {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Quick page switcher"
      className="fixed bottom-[4.6rem] left-1/2 z-[55] -translate-x-1/2 motion-safe:transition-all lg:bottom-5"
    >
      <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-[#07070d]/70 px-1.5 py-1 opacity-45 shadow-[0_14px_44px_-10px_rgba(0,0,0,0.85)] backdrop-blur-xl transition duration-300 hover:opacity-100 focus-within:opacity-100 sm:gap-1 sm:px-2">
        {NAV_ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={`${item.href}-${item.label}`}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              title={item.label}
              className={`group relative grid h-9 w-9 place-items-center rounded-full transition active:scale-90 sm:h-10 sm:w-auto sm:min-w-10 sm:px-2.5 ${
                active
                  ? 'bg-gradient-to-br from-fuchsia-500/25 to-amber-400/15 text-amber-300 shadow-[inset_0_0_0_1px_rgba(217,70,239,0.4)]'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon name={item.icon} className="h-[18px] w-[18px]" />
              <span className={`hidden text-[10px] font-black uppercase tracking-wider sm:ml-1.5 sm:inline ${active ? '' : 'group-hover:text-white'}`}>
                {item.label}
              </span>
              {active ? <span className="absolute -bottom-0.5 left-1/2 h-0.5 w-4 -translate-x-1/2 rounded-full bg-gradient-to-r from-fuchsia-400 to-amber-300" /> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
