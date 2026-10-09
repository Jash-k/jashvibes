import { redirect } from 'next/navigation';

/** Existing provider bookmarks stay valid; Extras owns gallery and viewing now. */
export default async function EmbedBrowserPage({ searchParams }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const key of ['site', 'url', 'title']) {
    if (typeof params?.[key] === 'string') query.set(key, params[key]);
  }
  redirect(`/extras${query.size ? `?${query}` : ''}`);
}
