import MusicShell from '@/components/music/MusicShell';

/*
 * The music section is one client screen (v8.16.0, "Lyric Lounge" rebuild): five views —
 * Home, Library, Playing, Lyrics, Settings — over the same MusicProvider engine and the same
 * /api/music routes. Static shell, client data: a library browse must never be the reason a
 * sleeping free-tier instance wakes up.
 */
export default function MusicPage() {
  return <MusicShell />;
}
