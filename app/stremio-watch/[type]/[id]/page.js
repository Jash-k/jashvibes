import { redirect } from 'next/navigation';
export default async function LegacyStremioWatch({ params, searchParams }) {
  const { type, id } = await params; const q = new URLSearchParams(await searchParams); q.set('origin', 'stremio');
  redirect(`/watch/stremio-${type === 'series' ? 'series' : 'movie'}/${encodeURIComponent(id)}?${q}`);
}
