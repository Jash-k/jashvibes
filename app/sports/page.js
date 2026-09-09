import SportsFeed from '@/components/sports/SportsFeed';

/*
 * The sports page is one screen: a feed of matches, each of which opens its own hub
 * in place. All of it lives in `components/sports/SportsFeed`; this file exists so the
 * route has a server component (and so the hub route can pass an `initialOpen` without
 * a client-side URL parse).
 *
 * No `export const dynamic`: the shell is static and the data is fetched by the client,
 * which is the whole point of the design — a Render free instance never wakes for a
 * scoreboard, and the service worker can still serve the shell offline.
 */
export default function SportsPage() {
  return <SportsFeed />;
}
