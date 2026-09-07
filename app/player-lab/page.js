import PlayerLabClient from './PlayerLabClient';

export const metadata = {
  title: 'Player lab',
  // Internal harness: never indexed, never linked from the app shell.
  robots: { index: false, follow: false },
};

export default function PlayerLabPage() {
  return <PlayerLabClient />;
}
