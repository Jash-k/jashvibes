'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * The env-configured embed providers (`EMBEDS` / `ELABEL` / `EMBED`, see `lib/embedSites.js`).
 *
 * These used to be a row of pills on the homepage, which meant the homepage fetched `/api/embed-sites`
 * every time anyone visited it, for buttons almost nobody presses from there. Rail OS deleted the pills,
 * and this puts them where they belong — next to the addon configuration on /stremio, where "which
 * sources can I play from" is the question being asked. It renders nothing at all when no provider is
 * configured, so a plain install never sees an empty heading.
 */
export default function EmbedSiteLinks() {
  const [sites, setSites] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/embed-sites', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) setSites(Array.isArray(data?.sites) ? data.sites : []);
      })
      .catch(() => {
        if (!cancelled) setSites([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sites.length) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        {loaded ? 'Embed providers' : 'Loading providers…'}
      </span>
      {sites.map((site) => (
        <Link
          key={site.id}
          href={`/embed-browser?site=${encodeURIComponent(site.id)}`}
          className="rounded-full border border-orange-500/25 bg-orange-500/10 px-3.5 py-1.5 text-xs font-black text-orange-100 transition hover:border-orange-400/70 hover:bg-orange-500/20"
          title={site.url}
        >
          {site.label}
        </Link>
      ))}
    </div>
  );
}
