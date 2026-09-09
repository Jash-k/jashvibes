/**
 * One list, two shells.
 *
 * `MobileDock` renders these as the bottom bar below `lg`; `RailNav` renders the same array as the
 * left rail on desktop and on a smart-TV wrapper. They used to be two hardcoded lists, which is how a
 * section quietly stops existing on one of them — a destination you can only reach on one device is a
 * destination you removed on the other.
 *
 * `My List` is deliberately not here. The homepage is the catalogue now, and the rail's seven slots are
 * for the places you go to *find* something; the library is where you go to *resume*, and the focus
 * panel already links to it (`/my-list?tab=history`) whenever there is something half-watched.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'home', accent: 'text-red-400', hint: 'Movies & series' },
  { href: '/live', label: 'Live', icon: 'live', accent: 'text-red-400', hint: 'Live TV and the guide' },
  { href: '/anime', label: 'Anime', emoji: '🌸', accent: 'text-fuchsia-300', hint: 'Animation catalogue' },
  // `short` is what the phone dock prints — eight labels at 10 px will not fit the wider one.
  { href: '/anime/tamil', label: 'Tamil anime', short: 'Tamil', emoji: '🎌', accent: 'text-sky-300', hint: 'Tamil dubs, read from the source' },
  { href: '/music', label: 'Music', icon: 'music', accent: 'text-emerald-300', hint: 'ராக வானம்' },
  { href: '/sports', label: 'Sports', icon: 'trophy', accent: 'text-amber-300', hint: 'Matches, scores, streams' },
  { href: '/classics', label: 'ReTro', icon: 'film', accent: 'text-amber-400', hint: 'Vintage Tamil cinema' },
  // `hard` reloads the document instead of a client navigation: the Stremio page caches its addon
  // manifest, and a soft route change keeps a stale one alive.
  { href: '/stremio?home=1', label: 'Stremio', icon: 'sparkle', accent: 'text-fuchsia-300', hint: 'Your addon sources', hard: true },
];

/** Both shells need the same answer to "is this where I am". */
export function isNavItemActive(item, pathname = '/') {
  const path = String(pathname || '/');
  const target = String(item?.href || '').split('?')[0];
  if (target === '/') return path === '/';
  return path.startsWith(target);
}
