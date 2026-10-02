import { redirect } from 'next/navigation';
export default async function LegacyRetroWatch({ params }) {
  const { id } = await params;
  redirect(`/watch/retro/${encodeURIComponent(id)}?origin=retro`);
}
