'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icons';
import { NAV_ITEMS, isNavItemActive } from '@/components/navItems';

/**
 * RailNav — the desktop/TV half of the homepage navigation.
 *
 * A vertical rail instead of a header row, because the app is used on a living-room screen as well as
 * a laptop: six fixed targets, no text smaller than 11px, a visible white ring on whatever has focus,
 * and nothing that needs a hover state to be understood. Below `lg` it is not rendered at all — the
 * `MobileDock` is already the bottom tab bar for the same six destinations, so a phone never gets two
 * navs and this never gets a hidden duplicate list.
 */
export default function RailNav({ onOpenSearch }) {
  const pathname = usePathname() || '/';

  return (
    <nav
      aria-label="Main navigation"
      className="jv-rail fixed inset-y-0 left-0 z-40 hidden w-[78px] flex-col border-r border-white/10 bg-[#07060a]/95 py-4 backdrop-blur-xl lg:flex xl:w-[188px]"
    >
      <div className="jv-rail-brand px-3 pb-4 xl:px-4">
        <img
          src="/brand/logo.png"
          alt="JaSH ViBeS"
          className="mx-auto h-9 w-9 rounded-full object-contain xl:mx-0"
          loading="eager"
          decoding="async"
          width="36"
          height="36"
        />
        <span className="jash-vibes-logo mt-2 hidden text-center text-[15px] leading-tight tracking-tight xl:block">
          JaSH ViBeS
        </span>
      </div>

      <ul className="jv-rail-list flex flex-1 flex-col gap-1.5 px-2 xl:gap-2 xl:px-2.5">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={item.hard ? (event) => { event.preventDefault(); window.location.assign(item.href); } : undefined}
                aria-current={active ? 'page' : undefined}
                title={`${item.label} — ${item.hint}`}
                className={`jv-rail-item${active ? ' jv-rail-item-active' : ''}`}
              >
                <span className={`grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] ${item.accent || ''}`}>
                  {item.emoji ? (
                    <span className="text-[17px] leading-none" aria-hidden="true">{item.emoji}</span>
                  ) : (
                    <Icon name={item.icon} className="h-[18px] w-[18px]" />
                  )}
                </span>
                <span className="jv-rail-label">{item.label}</span>
                {active ? <span className="jv-rail-bar" aria-hidden="true" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-col gap-1.5 border-t border-white/10 px-2 pt-3 xl:px-2.5">
        {onOpenSearch ? (
          <button type="button" onClick={onOpenSearch} className="jv-rail-item" title="Search the catalog">
            <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300">
              <Icon name="search" className="h-[18px] w-[18px]" />
            </span>
            <span className="jv-rail-label">Search</span>
          </button>
        ) : null}
      </div>
    </nav>
  );
}
