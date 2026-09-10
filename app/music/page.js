import MusicCurtains from '@/components/music/MusicCurtains';

/*
 * The music section is one client screen now (v8.15.0, Light Curtains). Static shell, client data: a library
 * browse must never be the reason a sleeping free-tier instance wakes up.
 */
export default function MusicPage() {
  return <MusicCurtains />;
}
