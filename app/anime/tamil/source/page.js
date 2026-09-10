import AnimeTamilSource from '@/components/anime/AnimeTamilSource';
import { baseUrl, openPath, seasonEpisodeFromHref } from '@/lib/animeTamilFeed';

export const dynamic = 'force-dynamic';

/**
 * `/anime/tamil/source?u=/episode/<slug>` — the one page of the source this app frames, on purpose.
 *
 * The URL is validated here, before anything is fetched: `openPath` accepts a path on the configured site
 * and refuses an absolute URL to anywhere else, so `?u=` cannot be pointed at an intranet host. The
 * document itself is sanitized and served by `/api/anime/tamil/page`; this page is the toolbar, the rail
 * and the frame around it.
 */
export default function AnimeTamilSourcePage({ searchParams }) {
  const base = baseUrl();
  const wanted = String(searchParams?.u || '').slice(0, 300);
  const url = openPath(wanted, { base, kind: 'page' });
  const path = url ? url.replace(/^https?:\/\/[^/]+/, '') : '/language/tamil';
  return <AnimeTamilSource path={path} rawBase={base} title={titleFrom(path)} />;
}

function titleFrom(path = '') {
  // Their slugs carry the TMDB id, the season and sometimes the release year. The toolbar above the frame
  // is ours, so it says what the row said: the show, then S1 · E18.
  const slug = decodeURIComponent(String(path).split('/').filter(Boolean).pop() || '');
  const { season, episode } = seasonEpisodeFromHref(`/${slug}/`);
  const name = slug
    .replace(new RegExp(`-${season}x${episode}$`), '')
    .replace(/-\d{4,}$/, '')
    .replace(/-season-\d+$/, '')
    .replace(/-(19|20)\d{2}$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\b(Of|The|And|A|In|On)\b/g, (word, offset) => (offset === 0 ? word : word.toLowerCase()))
    .trim();
  const tag = season && episode ? ` · S${season} · E${episode}` : '';
  return `${name || 'their page'}${tag}`.slice(0, 72);
}
