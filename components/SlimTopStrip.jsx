'use client';

/**
 * SlimTopStrip — a consistent tiny brand strip rendered at the top of pages
 * that don't already carry a slim branded header (Live, Stremio, Stremio-watch,
 * Music, Sports, Classics ship their own). Static (not sticky), ~36px tall:
 * mini logo (tap → home) + small page title.
 */
import { usePathname } from 'next/navigation';
import BrandLogo from '@/components/BrandLogo';

const PAGES_WITH_OWN_BRAND = ['/live', '/stremio', '/music', '/sports', '/classics'];

const TITLE_MAP = [
  { match: /^\/?$/, title: 'Home' },
  { match: /^\/watch\//, title: 'Now Playing' },
  { match: /^\/movies/, title: 'Movies' },
  { match: /^\/my-list/, title: 'My Library' },
  { match: /^\/match/, title: 'Match' },
  { match: /^\/match-center/, title: 'Match Center' },
  { match: /^\/embed-browser/, title: 'Embed Browser' },
];

export default function SlimTopStrip() {
  const pathname = usePathname() || '/';
  if (PAGES_WITH_OWN_BRAND.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const title = TITLE_MAP.find((entry) => entry.match.test(pathname))?.title || 'JaSH ViBeS';

  return (
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/25 px-3 py-1 sm:px-5">
      <BrandLogo size="mini" className="scale-90" />
      <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">{title}</p>
    </div>
  );
}
