import AnimeTamil from '@/components/anime/AnimeTamil';

/*
 * The Tamil anime page is one screen: the source's own list, a sheet per title, and a player that only
 * mounts when a host published a fetchable manifest. All of it lives in `components/anime/AnimeTamil`.
 *
 * No `export const dynamic`: the shell is static and the data is fetched by the client, which is the shape
 * that keeps a sleeping free-tier instance asleep — a catalogue page must not be a reason to wake a server.
 */
export default function AnimeTamilPage() {
  return <AnimeTamil />;
}
