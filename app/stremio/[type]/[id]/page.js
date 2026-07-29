'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

export default function LegacyStremioWatchRedirect() {
  const params = useParams();
  const searchParams = useSearchParams();
  const type = params?.type || 'movie';
  const id = params?.id || '';
  const query = searchParams?.toString();
  const target = `/stremio-watch/${encodeURIComponent(type)}/${encodeURIComponent(id)}${query ? `?${query}` : '?source=catalog'}`;

  useEffect(() => {
    window.location.replace(target);
  }, [target]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#050012] p-6 text-center text-zinc-100">
      <div className="rounded-3xl border border-fuchsia-400/20 bg-white/[0.04] p-6">
        <p className="text-sm font-bold text-zinc-300">Opening Stremio player...</p>
        <Link href={target} className="mt-4 inline-flex rounded-full border border-fuchsia-300/30 px-4 py-2 text-xs font-black text-fuchsia-100">Continue</Link>
      </div>
    </main>
  );
}
