import SportsFeed from '@/components/sports/SportsFeed';

/*
 * `/sports/hub/{source}/{id}` — a match opened at a real address, which is all the URL
 * ever carries. Nothing about the match is encoded in it (the old surface used a ~700
 * character base64 payload, which is what made a shared link show yesterday's score), so
 * the panel opens by asking the feed for the match. The feed card on `/sports` opens the
 * same hub in place; this route is for links, history and the "open in page" button.
 *
 * `id` stays loose (`[id]`, not a numeric catch) because source ids are whatever the
 * provider calls them: `19986`, `WT20-774`, `fancode-610`.
 *
 * `?tab=live|video|info|scorecard` opens a particular panel; an unknown or unavailable
 * one falls back to the first tab the match actually has, which is decided by the data.
 */
const SOURCE = /^(bcci|ipl|icc|fancode)$/;

export default async function SportsHubPage({ params, searchParams }) {
  const { source, id } = await params;
  const query = await searchParams;
  const raw = String(id || '');
  const tab = String(query?.tab || '').slice(0, 12);
  const open = SOURCE.test(String(source || '')) && raw && raw.length <= 64 ? { source: String(source), id: raw, tab } : null;
  return <SportsFeed initialOpen={open} />;
}
