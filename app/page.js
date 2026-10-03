import HomeClient from '@/components/home/HomeClient';
import { readCachedHero } from '@/lib/homeHero';

/**
 * The home route is a server component so the hero banner can be part of the first
 * HTML response.
 *
 * Before this, the largest element on the page arrived via HTML → hydration → fetch
 * → state → image request, and *that chain* — not the image bytes — was what the LCP
 * was waiting on. `readCachedHero()` reads the catalogue cache the API would have
 * served anyway (never a scrape, hard time budget, and it returns null on anything
 * unexpected), so the worst case is the page we shipped yesterday.
 *
 * Revalidated once a minute rather than rendered per request:
 *   • `force-dynamic` would put a database read on every visitor's critical path;
 *   • the default (prerender at build) would bake in whatever the database held
 *     during the build — nothing — so the hero would never be server-rendered;
 *   • a one-minute window gives the fast path a cached HTML response *and* a hero
 *     that is actually in the markup. The client fetch revalidates right after
 *     hydration, so a minute-old banner is invisible in practice.
 *
 * Everything below the banner is still client-side, exactly as it was.
 */
export const revalidate = 60;

export default async function Page() {
  const initialHero = await readCachedHero();
  return <HomeClient initialHero={initialHero} />;
}
