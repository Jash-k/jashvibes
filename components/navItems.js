/**
 * One list, two shells.
 *
 * `MobileDock` renders these as the bottom bar below `lg`; `RailNav` renders the same array as the
 * left rail on desktop and on a smart-TV wrapper. They used to be two hardcoded lists, which is how a
 * section quietly stops existing on one of them — a destination you can only reach on one device is a
 * destination you removed on the other.
 */
export const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: 'home', accent: 'text-red-400', hint: 'Movies & series' },
  { href: '/live', label: 'Live', icon: 'live', accent: 'text-red-400', hint: 'Live TV and the guide' },
  { href: '/music', label: 'Music', icon: 'music', accent: 'text-emerald-300', hint: 'ராக வானம்' },
  { href: '/sports', label: 'Sports', icon: 'trophy', accent: 'text-amber-300', hint: 'Live channels & streams' },
  { href: '/classics', label: 'ReTro', icon: 'film', accent: 'text-amber-400', hint: 'Vintage Tamil cinema' },
  { href: '/my-list', label: 'My List', icon: 'heart', accent: 'text-rose-400', hint: 'Saved & half-watched' },
];
